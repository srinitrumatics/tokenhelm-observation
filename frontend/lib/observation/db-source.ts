import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  dedupeEvents,
  sortEvents,
  type EventReadResult,
  type EventSource,
} from "./event-source";
import { normalize } from "./normalize";

/**
 * DuckDbEventSource — the scale-oriented EventSource (T059, constraint #2).
 *
 * It implements the SAME `EventSource` interface as JsonlEventSource, so NO aggregator
 * changes when you switch storage (the whole point of the abstraction). The canonical
 * ObservationEvents live in a DuckDB table `observation_events(event_id, timestamp, doc)`
 * where `doc` is the full canonical JSON — analytics read `doc`, parse, and normalize
 * exactly as the JSONL path does, so results are byte-identical across sinks (SC-014).
 *
 * Why DuckDB: a columnar, multi-threaded, embedded engine that ingests 10M+ rows and
 * supports time-range / entity push-down at the storage layer (SC-009). This v1 returns
 * the full event set through the interface; a future aggregating extension can push GROUP
 * BY into SQL for the 2s-at-10M dashboard target WITHOUT touching the analytics layer.
 *
 * The native `@duckdb/node-api` module is imported LAZILY (only on read()), so importing
 * this file never loads a native addon, and the default JSONL path is unaffected.
 */

export const OBSERVATION_TABLE = "observation_events";

export class DuckDbEventSource implements EventSource {
  private readonly dbPath: string;
  private readonly table: string;

  constructor(dbPath: string = resolveDbPath(), table: string = OBSERVATION_TABLE) {
    this.dbPath = dbPath;
    this.table = table;
  }

  describe(): string {
    return `duckdb:${this.dbPath}`;
  }

  async fingerprint(): Promise<string> {
    if (this.dbPath === ":memory:") return "memory";
    try {
      const st = await fs.stat(this.dbPath);
      return `${st.size}:${st.mtimeMs}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw err;
    }
  }

  async read(): Promise<EventReadResult> {
    if ((await this.fingerprint()) === "absent") {
      return { events: [], skipped: 0, duplicates: 0, present: false, source: this.describe() };
    }

    const handle = await openConnection(this.dbPath);
    const { conn } = handle;
    try {
      // Cold DB (table not created yet) → cold start, not an error.
      const exists = await tableExists(conn, this.table);
      if (!exists) {
        return { events: [], skipped: 0, duplicates: 0, present: false, source: this.describe() };
      }

      const result = await conn.run(`SELECT doc FROM ${this.table}`);
      const rows = (await result.getRowObjects()) as Array<{ doc: string }>;

      const normalized = [];
      let skipped = 0;
      for (const row of rows) {
        let parsed: unknown;
        try {
          parsed = typeof row.doc === "string" ? JSON.parse(row.doc) : row.doc;
        } catch {
          skipped++;
          continue;
        }
        const ev = normalize(parsed);
        if (ev) normalized.push(ev);
        else skipped++;
      }

      const { events, duplicates } = dedupeEvents(normalized);
      return { events: sortEvents(events), skipped, duplicates, present: true, source: this.describe() };
    } finally {
      closeConnection(handle);
    }
  }
}

/** Resolve the DuckDB path from DUCKDB_PATH (default ../usage.duckdb). */
export function resolveDbPath(): string {
  const configured = process.env.DUCKDB_PATH ?? "../usage.duckdb";
  if (configured === ":memory:") return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

// --- DuckDB plumbing (lazy native import) ------------------------------------

// The native binding is loaded on demand so this module is import-safe everywhere.
type DuckConn = {
  run: (sql: string) => Promise<{ getRowObjects: () => Promise<unknown[]> }>;
  closeSync?: () => void;
};
type DuckInstance = { closeSync?: () => void };
interface DuckHandle {
  conn: DuckConn;
  instance: DuckInstance;
}

async function openConnection(dbPath: string): Promise<DuckHandle> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = (await DuckDBInstance.create(dbPath)) as unknown as DuckInstance & {
    connect: () => Promise<DuckConn>;
  };
  const conn = await instance.connect();
  return { conn, instance };
}

/** Release both the connection and the instance so the DB file lock is freed (Windows). */
function closeConnection(handle: DuckHandle): void {
  handle.conn.closeSync?.();
  handle.instance.closeSync?.();
}

async function tableExists(conn: DuckConn, table: string): Promise<boolean> {
  const r = await conn.run(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${table.replace(/'/g, "''")}'`,
  );
  const rows = (await r.getRowObjects()) as Array<{ n: number | bigint }>;
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Ingest canonical events from a JSONL log into a DuckDB table — the normalize-once-at-
 * write model. Used by the ingest script and tests. Returns rows written.
 */
export async function ingestJsonlToDuckDb(
  jsonlPath: string,
  dbPath: string,
  table: string = OBSERVATION_TABLE,
): Promise<number> {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const handle = await openConnection(dbPath);
  const { conn } = handle;
  await conn.run(`CREATE TABLE IF NOT EXISTS ${table} (event_id VARCHAR, timestamp VARCHAR, doc VARCHAR)`);

  let written = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { event_id?: string; timestamp?: string } | null = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed at ingest; read() also tolerates
    }
    const eid = (obj?.event_id ?? "").replace(/'/g, "''");
    const ts = (obj?.timestamp ?? "").replace(/'/g, "''");
    const doc = trimmed.replace(/'/g, "''");
    await conn.run(`INSERT INTO ${table} VALUES ('${eid}', '${ts}', '${doc}')`);
    written++;
  }
  closeConnection(handle);
  return written;
}
