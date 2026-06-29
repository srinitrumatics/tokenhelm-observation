import "server-only";
import type { EventSource } from "./event-source";
import { JsonlEventSource } from "./jsonl-source";

/**
 * EventSource selector (T059). Chooses the storage binding from EVENT_SOURCE:
 *   - "jsonl"  (default) → JsonlEventSource, the append-only usage_log.jsonl
 *   - "duckdb"           → DuckDbEventSource, the columnar engine for large datasets
 *
 * Every API route depends ONLY on the EventSource interface via this factory, so the
 * storage backend is swappable with an env var and ZERO analytics changes (constraint #2).
 * The DuckDB module is imported lazily so the default path never loads the native addon.
 */
export function getEventSource(): EventSource {
  const kind = (process.env.EVENT_SOURCE ?? "jsonl").toLowerCase();
  if (kind === "duckdb") {
    // Lazy require keeps the native binding out of the default (JSONL) code path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DuckDbEventSource } = require("./db-source") as typeof import("./db-source");
    return new DuckDbEventSource();
  }
  return new JsonlEventSource();
}
