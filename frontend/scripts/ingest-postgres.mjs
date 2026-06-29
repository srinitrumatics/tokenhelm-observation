// Ingest an append-only usage_log.jsonl into a Postgres table for the connector-ecosystem
// EventSource (v1.4). Normalize-once-at-write: each canonical line is stored as
// observation_events(event_id, "timestamp", doc). Run, then point the app at it with
// EVENT_SOURCE=postgres and PG_DSN=<dsn>.
//
//   node scripts/ingest-postgres.mjs [jsonlPath] [dsn]
//   USAGE_LOG_PATH / PG_DSN env vars are honored as defaults.
//
// Uses a single transaction + parameterized INSERTs so it scales to millions of rows and is
// injection-safe. READ-ONLY analytics never write — only this explicit ingest does.

import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";

const TABLE = "observation_events";

const jsonlPath = path.resolve(process.argv[2] ?? process.env.USAGE_LOG_PATH ?? "../usage_log.jsonl");
const dsn = process.argv[3] ?? process.env.PG_DSN;

if (!dsn) {
  console.error("Set PG_DSN (or pass a DSN arg): postgres://user:pass@host:5432/db");
  process.exit(1);
}

async function main() {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (event_id TEXT, "timestamp" TEXT, doc TEXT)`);

  const started = Date.now();
  await client.query("BEGIN");
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
    await client.query(`INSERT INTO ${TABLE} (event_id, "timestamp", doc) VALUES ($1, $2, $3)`, [
      String(obj.event_id ?? ""),
      String(obj.timestamp ?? ""),
      line,
    ]);
    written++;
  }
  await client.query("COMMIT");
  const elapsed = Date.now() - started;

  const countRes = await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
  const total = Number(countRes.rows[0].n);
  await client.end();

  console.log(`Ingested ${written} rows (${skipped} skipped) from ${jsonlPath}`);
  console.log(`Table ${TABLE} now holds ${total} rows`);
  console.log(`Write time: ${elapsed} ms (${Math.round((written / elapsed) * 1000)} rows/s)`);
  console.log(`Use it:  EVENT_SOURCE=postgres PG_DSN=<dsn> npm run start`);
}

main().catch((err) => {
  console.error("Ingest failed:", err.message);
  process.exit(1);
});
