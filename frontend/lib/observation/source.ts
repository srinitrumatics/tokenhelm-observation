import "server-only";
import type { EventSource } from "./event-source";
import { JsonlEventSource } from "./jsonl-source";

/**
 * EventSource selector (T059). Chooses the storage binding from EVENT_SOURCE:
 *   - "jsonl"   (default) → JsonlEventSource, the append-only usage_log.jsonl
 *   - "duckdb"            → DuckDbEventSource, the columnar engine for large datasets
 *   - "postgres"          → PostgresEventSource, the connector-ecosystem SQL backend (v1.4)
 *
 * Every API route depends ONLY on the EventSource interface via this factory, so the
 * storage backend is swappable with an env var and ZERO analytics changes (constraint #2).
 * Each backend's driver is imported lazily so the default path never loads it.
 */
export function getEventSource(): EventSource {
  const kind = (process.env.EVENT_SOURCE ?? "jsonl").toLowerCase();
  if (kind === "duckdb") {
    // Lazy require keeps the native binding out of the default (JSONL) code path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DuckDbEventSource } = require("./db-source") as typeof import("./db-source");
    return new DuckDbEventSource();
  }
  if (kind === "postgres") {
    // Lazy require keeps the pg driver out of the default (JSONL) code path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostgresEventSource } = require("./pg-source") as typeof import("./pg-source");
    return new PostgresEventSource();
  }
  return new JsonlEventSource();
}
