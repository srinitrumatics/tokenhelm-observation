# Contract: EventSource (storage-sink interface)

The `EventSource` is the seam that makes storage independent from analytics (FR-007a, research D2).
The aggregation engine depends **only** on this interface and the `ObservationEvent` contract — never
on a concrete storage format. Swapping implementations (JSONL → DuckDB → PostgreSQL → Redis Streams →
OpenTelemetry) requires **zero** changes to `lib/analytics/**`.

## Interface (TypeScript shape)

```text
interface EventSource {
  // Read all currently-available events, normalized + deduplicated, in a stable order.
  read(): Promise<EventReadResult>;

  // Cheap freshness probe (e.g. file size+mtime, DB max(timestamp)/count) so the API
  // can refresh within SC-007 without a full re-read when nothing changed.
  fingerprint(): Promise<string>;

  // Human-facing identifier of where events came from (path, DSN label) for meta/debug.
  describe(): string;
}

interface EventReadResult {
  events: ObservationEvent[];   // normalized + deduped (by event_id, content-hash fallback)
  skipped: number;              // malformed/invalid source records skipped (never silently dropped)
  duplicates: number;           // records collapsed by deduplication
  present: boolean;             // false when the source is absent/empty (cold start, not an error)
  source: string;               // == describe()
}
```

## Behavioral contract (all implementations MUST honor)

1. **Read-only** — `read()` MUST NOT mutate, reorder, or delete the underlying store (Constitution III).
2. **Normalize** — every yielded item conforms to `observation-event.schema.json`; legacy/partial
   records are normalized (defaults + `attribution_status`) by `normalize()` (research D3).
3. **Skip-and-count** — malformed/invalid source records are skipped and counted in `skipped`, never
   abort the read (FR-003, SC-011).
4. **Deduplicate** — identical events (same `event_id`, or content-hash for legacy) appear once;
   the collapse count is reported in `duplicates` (FR-004, SC-003).
5. **Cold start** — an absent/empty source returns `present:false` with empty events, not an error.
6. **Deterministic order** — `read()` returns events in a stable order (timestamp, then `event_id`)
   so replay is byte-reproducible (SC-014, FR-031).

## v1 implementation

`JsonlEventSource(logPath = USAGE_LOG_PATH)` — server-only. Reads the append-only `usage_log.jsonl`,
caches normalized events keyed by `fingerprint()` (size+mtime), and on change reads only the appended
tail. Satisfies local-first scale and the <2s/<5s targets (research D6).

## Scale implementations (future, same interface)

`DbEventSource` (DuckDB/SQLite/PostgreSQL) — required to satisfy SC-009 (10M events) and SC-010 (100
concurrent) without analytics changes. Not built in this phase; the interface guarantees it can be
added later transparently.

## Replay & migration (FR-031)

- **Replay**: run any aggregator over `source.read().events` again → identical analytics (pure
  function, deterministic order).
- **Migration**: stream `A.read().events` into sink `B`; assert aggregates over `A` and `B` are equal
  before switching the active source.
