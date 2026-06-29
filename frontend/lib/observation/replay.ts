import {
  InMemoryEventSource,
  type EventReadResult,
  type EventSource,
} from "./event-source";

/**
 * Replay — a first-class capability (constraint #4). Because every analytics view
 * is a pure, deterministic function of ObservationEvent[], "replay" is simply
 * re-reading the immutable source and recomputing. No AI application rerun is ever
 * required to rebuild derived analytics (FR-031).
 *
 * Determinism is guaranteed by the EventSource's stable ordering (sortEvents) and
 * the absence of wall-clock/randomness in aggregation — so replaying an unchanged
 * source yields byte-identical analytics, and migrating to another sink leaves all
 * analytics unchanged (SC-014).
 */

/** Re-derive the immutable event stream from a source (the replay entrypoint). */
export async function replay(source: EventSource): Promise<EventReadResult> {
  return source.read();
}

/**
 * Migrate: copy an EventSource's events into a fresh in-memory sink, modelling a
 * storage backend swap (e.g. JSONL → DuckDB). Aggregating over the result MUST equal
 * aggregating over the original — the proof that storage is independent of analytics.
 */
export async function migrate(from: EventSource, label = "migrated"): Promise<InMemoryEventSource> {
  const { events } = await from.read();
  return new InMemoryEventSource(events, label);
}
