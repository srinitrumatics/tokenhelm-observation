import "server-only";
import { promises as fs } from "node:fs";
import {
  dedupeEvents,
  sortEvents,
  type EventReadResult,
  type EventSource,
} from "./event-source";
import { normalize } from "./normalize";

/**
 * PostgresEventSource — the connector-ecosystem EventSource (v1.4, constraint #2).
 *
 * It implements the SAME `EventSource` interface as JsonlEventSource / DuckDbEventSource, so
 * NO aggregator changes when you switch storage. Canonical events live one-per-row in a table
 * `observation_events(event_id text, "timestamp" text, doc text)` where `doc` is the full
 * canonical JSON — `read()` parses each `doc`, runs the SAME `normalize()`, dedupes, and sorts,
 * so the event stream (and therefore every analytic + reconciliation) is byte-identical across
 * sinks (SC-014). This mirrors the DuckDB `(event_id, timestamp, doc)` layout exactly.
 *
 * The `pg` driver is imported LAZILY (only when a real connection is opened), so importing this
 * file never loads it and the default JSONL path is unaffected. A pre-built pool can be INJECTED
 * (constructor `pool`) — production passes a DSN; tests pass an in-memory `pg-mem` pool, keeping
 * the conformance test offline with no Docker/server (same spirit as the embedded DuckDB test).
 *
 * READ-ONLY (Constitution III): `read()`/`fingerprint()` only SELECT. Writing is the separate,
 * explicitly-named `ingestJsonlToPostgres()` — never part of a read.
 */

export const OBSERVATION_TABLE = "observation_events";

/** The minimal slice of a `pg` Pool this source needs (so tests can inject `pg-mem`). */
export interface PgPool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
}

export interface PostgresEventSourceOptions {
  /** Connection string; falls back to PG_DSN. Ignored when `pool` is injected. */
  dsn?: string;
  table?: string;
  /** Inject a pre-built pool (tests / a shared app pool). When set, this source never ends it. */
  pool?: PgPool;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(table: string): string {
  if (!IDENT_RE.test(table)) throw new Error(`unsafe table identifier: ${table}`);
  return table;
}

export class PostgresEventSource implements EventSource {
  private readonly dsn?: string;
  private readonly table: string;
  private readonly injectedPool?: PgPool;

  constructor(options: PostgresEventSourceOptions | string = {}) {
    const opts = typeof options === "string" ? { dsn: options } : options;
    this.dsn = opts.dsn;
    this.table = assertIdent(opts.table ?? OBSERVATION_TABLE);
    this.injectedPool = opts.pool;
  }

  describe(): string {
    if (this.injectedPool) return "postgres:injected";
    const dsn = this.dsn ?? process.env.PG_DSN;
    return `postgres:${dsn ? safeLabel(dsn) : "configured"}`;
  }

  async fingerprint(): Promise<string> {
    const { pool, release } = await this.acquire();
    try {
      // Cheap probe: row count + latest timestamp. Missing table ⇒ cold start ("absent").
      const r = await pool.query(
        `SELECT count(*) AS n, coalesce(max("timestamp"), '') AS hi FROM ${this.table}`,
      );
      const n = Number(r.rows[0]?.["n"] ?? 0);
      const hi = String(r.rows[0]?.["hi"] ?? "");
      return n === 0 ? "absent" : `${n}:${hi}`;
    } catch (err) {
      if (isUndefinedTable(err)) return "absent";
      throw err;
    } finally {
      await release();
    }
  }

  async read(): Promise<EventReadResult> {
    if ((await this.fingerprint()) === "absent") {
      return { events: [], skipped: 0, duplicates: 0, present: false, source: this.describe() };
    }

    const { pool, release } = await this.acquire();
    try {
      const res = await pool.query(`SELECT doc FROM ${this.table}`); // READ-ONLY
      const normalized = [];
      let skipped = 0;
      for (const row of res.rows) {
        let parsed: unknown;
        try {
          parsed = typeof row["doc"] === "string" ? JSON.parse(row["doc"] as string) : row["doc"];
        } catch {
          skipped++; // one bad row never aborts the read
          continue;
        }
        const ev = normalize(parsed);
        if (ev) normalized.push(ev);
        else skipped++;
      }
      const { events, duplicates } = dedupeEvents(normalized);
      return { events: sortEvents(events), skipped, duplicates, present: true, source: this.describe() };
    } finally {
      await release();
    }
  }

  /** Get a pool + a release fn. Injected pools are never ended here (the caller owns them). */
  private async acquire(): Promise<{ pool: PgPool; release: () => Promise<void> }> {
    if (this.injectedPool) return { pool: this.injectedPool, release: async () => {} };
    const dsn = this.dsn ?? resolveDsn();
    const pool = await openPool(dsn);
    return { pool, release: async () => void (await pool.end()) };
  }
}

/** Resolve the DSN from PG_DSN — no insecure default; fail fast if unset. */
export function resolveDsn(): string {
  const dsn = process.env.PG_DSN;
  if (!dsn) throw new Error("PostgresEventSource requires PG_DSN (or an injected pool)");
  return dsn;
}

function safeLabel(dsn: string): string {
  try {
    const u = new URL(dsn);
    return `${u.host}${u.pathname}`; // host + db name, never user/password
  } catch {
    return "configured";
  }
}

function isUndefinedTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  // 42P01 = undefined_table (node-pg). pg-mem reports it in the message.
  return e?.code === "42P01" || /relation .* does not exist|no such table|table .* does not exist/i.test(e?.message ?? "");
}

// --- pg plumbing (lazy driver import) ---------------------------------------

async function openPool(dsn: string): Promise<PgPool> {
  const pg = (await import("pg")) as unknown as { Pool: new (cfg: unknown) => PgPool };
  return new pg.Pool({ connectionString: dsn, max: 1 });
}

/**
 * Ingest canonical events from a JSONL log into a Postgres table — the normalize-once-at-write
 * model (mirrors `ingestJsonlToDuckDb`). `target` is a DSN string (a transient pool is created
 * and closed) or an injected pool (left open). Returns rows written. Kept SEPARATE from `read()`
 * so the read path stays strictly read-only.
 */
export async function ingestJsonlToPostgres(
  jsonlPath: string,
  target: PgPool | string,
  table: string = OBSERVATION_TABLE,
): Promise<number> {
  assertIdent(table);
  // A DSN gets a transient pool we close; an injected pool is left open for the caller.
  const transient = typeof target === "string" ? await openPool(target) : null;
  const pool = transient ?? (target as PgPool);
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (event_id TEXT, "timestamp" TEXT, doc TEXT)`);
    const raw = await fs.readFile(jsonlPath, "utf8");
    let written = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: { event_id?: unknown; timestamp?: unknown };
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // skip malformed at ingest; read() also tolerates
      }
      await pool.query(`INSERT INTO ${table} (event_id, "timestamp", doc) VALUES ($1, $2, $3)`, [
        String(obj.event_id ?? ""),
        String(obj.timestamp ?? ""),
        trimmed,
      ]);
      written++;
    }
    return written;
  } finally {
    if (transient) await transient.end();
  }
}
