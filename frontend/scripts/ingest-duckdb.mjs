// Ingest an append-only usage_log.jsonl into a DuckDB table for the scale-oriented
// EventSource (T059). Normalize-once-at-write: each canonical line is stored as
// observation_events(event_id, timestamp, doc). Run, then point the app at it with
// EVENT_SOURCE=duckdb and DUCKDB_PATH=<db>.
//
//   node scripts/ingest-duckdb.mjs [jsonlPath] [dbPath]
//   USAGE_LOG_PATH / DUCKDB_PATH env vars are honored as defaults.
//
// Uses a prepared statement + a single transaction so it scales to millions of rows.

import { promises as fs } from "node:fs";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const TABLE = "observation_events";

const jsonlPath = path.resolve(process.argv[2] ?? process.env.USAGE_LOG_PATH ?? "../usage_log.jsonl");
const dbPath = path.resolve(process.argv[3] ?? process.env.DUCKDB_PATH ?? "../usage.duckdb");

async function main() {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  await conn.run(`CREATE TABLE IF NOT EXISTS ${TABLE} (event_id VARCHAR, timestamp VARCHAR, doc VARCHAR)`);

  const started = Date.now();
  await conn.run("BEGIN TRANSACTION");
  const prepared = await conn.prepare(`INSERT INTO ${TABLE} VALUES ($1, $2, $3)`);
  let written = 0;
  let skipped = 0;
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    prepared.bindVarchar(1, String(obj.event_id ?? ""));
    prepared.bindVarchar(2, String(obj.timestamp ?? ""));
    prepared.bindVarchar(3, line);
    await prepared.run();
    written++;
  }
  await conn.run("COMMIT");
  const elapsed = Date.now() - started;

  const countRes = await conn.run(`SELECT count(*) AS n FROM ${TABLE}`);
  const total = Number((await countRes.getRowObjects())[0].n);

  conn.closeSync?.();
  instance.closeSync?.();

  console.log(`Ingested ${written} rows (${skipped} skipped) from ${jsonlPath}`);
  console.log(`Table ${TABLE} now holds ${total} rows in ${dbPath}`);
  console.log(`Write time: ${elapsed} ms (${Math.round((written / elapsed) * 1000)} rows/s)`);
  console.log(`Use it:  EVENT_SOURCE=duckdb DUCKDB_PATH=${dbPath} npm run start`);
}

main().catch((err) => {
  console.error("Ingest failed:", err.message);
  process.exit(1);
});
