// Scale benchmark for the EventSource layer (T059, SC-009: 10M events).
//
//   node scripts/bench.mjs [N]      # default 200_000; pass 10000000 for the full target
//
// Generates N synthetic canonical events, then compares two strategies over the SAME data:
//   1. JSONL v1 path  — read the whole file, JSON.parse every line, aggregate in JS.
//   2. DuckDB path    — push the GROUP BY into SQL (json_extract on the stored doc).
//
// The point is NOT that JSONL is unusable, but that the DuckDB sink answers an aggregate
// over millions of rows with columnar, multi-threaded SQL while the analytics layer above
// stays unchanged. Numbers are printed with a linear extrapolation to 10M.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const N = Number(process.argv[2] ?? process.env.BENCH_N ?? 200_000);
const TABLE = "observation_events";
const PROVIDERS = ["gemini", "openai", "anthropic"];
const MODELS = ["gemini-3-flash-preview", "gemini-3-pro", "gpt-x", "claude-x"];

const tmp = path.join(os.tmpdir(), `obs-bench-${process.pid}-${Date.now()}`);
const jsonlPath = `${tmp}.jsonl`;
const dbPath = `${tmp}.duckdb`;

function ms(t) {
  return `${t.toFixed(0)} ms`;
}
function per10M(t, n) {
  return `${((t / n) * 10_000_000 / 1000).toFixed(1)} s`;
}

async function generate() {
  const start = Date.now();
  const chunks = [];
  for (let i = 0; i < N; i++) {
    const provider = PROVIDERS[i % PROVIDERS.length];
    const model = MODELS[i % MODELS.length];
    const day = 10 + (i % 20);
    chunks.push(JSON.stringify({
      event_id: `e${i}`,
      timestamp: `2026-06-${String(day).padStart(2, "0")}T10:00:00+00:00`,
      provider, model,
      request_id: `r${i}`, session_id: `s${i % 1000}`, workflow_id: `wf-${i % 50}`,
      agent: `agent-${i % 25}`, parent_agent: i % 3 === 0 ? null : `agent-${i % 5}`,
      prompt: `prompt-${i % 40}`,
      input_tokens: 100, output_tokens: 40, total_tokens: 140,
      latency_ms: 100 + (i % 500), cost: "0.0010", currency: "USD",
      status: i % 17 === 0 ? "error" : "success", attribution_status: "complete",
      metadata: { priced: true },
    }));
    if (chunks.length >= 50_000) {
      await fs.appendFile(jsonlPath, chunks.join("\n") + "\n");
      chunks.length = 0;
    }
  }
  if (chunks.length) await fs.appendFile(jsonlPath, chunks.join("\n") + "\n");
  return Date.now() - start;
}

async function benchJsonl() {
  const start = Date.now();
  const raw = await fs.readFile(jsonlPath, "utf8");
  const byProvider = new Map();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    const acc = byProvider.get(e.provider) ?? { calls: 0, tokens: 0 };
    acc.calls++; acc.tokens += e.total_tokens;
    byProvider.set(e.provider, acc);
  }
  return { elapsed: Date.now() - start, groups: byProvider.size };
}

async function benchDuckDb() {
  // Ingest (normalize-once-at-write).
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  await conn.run(`CREATE TABLE ${TABLE} (event_id VARCHAR, timestamp VARCHAR, doc VARCHAR)`);
  const ingestStart = Date.now();
  // Bulk-load straight from the JSONL file using DuckDB's reader, then keep the doc text.
  await conn.run(`
    INSERT INTO ${TABLE}
    SELECT json_extract_string(j, '$.event_id'), json_extract_string(j, '$.timestamp'), j
    FROM (SELECT unnest(string_split(content, chr(10))) AS j
          FROM read_text('${jsonlPath.replace(/\\/g, "/")}'))
    WHERE length(trim(j)) > 0
  `);
  const ingestMs = Date.now() - ingestStart;

  // Aggregate pushed into SQL.
  const queryStart = Date.now();
  const res = await conn.run(`
    SELECT json_extract_string(doc, '$.provider') AS provider,
           count(*) AS calls, sum(CAST(json_extract_string(doc, '$.total_tokens') AS BIGINT)) AS tokens
    FROM ${TABLE} GROUP BY 1 ORDER BY calls DESC
  `);
  const rows = await res.getRowObjects();
  const queryMs = Date.now() - queryStart;

  conn.closeSync?.();
  instance.closeSync?.();
  return { ingestMs, queryMs, groups: rows.length };
}

async function main() {
  console.log(`Benchmarking ${N.toLocaleString()} events…\n`);
  const genMs = await generate();
  const size = (await fs.stat(jsonlPath)).size;
  console.log(`Generated JSONL: ${(size / 1e6).toFixed(1)} MB in ${ms(genMs)}\n`);

  const jsonl = await benchJsonl();
  console.log(`JSONL v1 (read+parse+aggregate in JS):`);
  console.log(`  ${ms(jsonl.elapsed)}  → ~${per10M(jsonl.elapsed, N)} at 10M  (${jsonl.groups} provider groups)\n`);

  const duck = await benchDuckDb();
  console.log(`DuckDB sink:`);
  console.log(`  ingest : ${ms(duck.ingestMs)}  → ~${per10M(duck.ingestMs, N)} at 10M`);
  console.log(`  GROUP BY in SQL : ${ms(duck.queryMs)}  → ~${per10M(duck.queryMs, N)} at 10M  (${duck.groups} groups)\n`);

  console.log("Takeaway: the analytics layer is unchanged; DuckDB pushes aggregation into");
  console.log("columnar SQL, the path to 2s-at-10M dashboards (a future AggregatingEventSource).");

  await fs.rm(jsonlPath, { force: true }).catch(() => {});
  await fs.rm(dbPath, { force: true }).catch(() => {});
}

main().catch((err) => {
  console.error("Benchmark failed:", err.message);
  process.exit(1);
});
