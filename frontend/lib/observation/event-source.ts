import type { ObservationEvent } from "./event";

/**
 * EventSource — the storage-agnostic seam (locked architectural constraint #2).
 *
 * Analytics depend ONLY on this interface and the ObservationEvent contract, never
 * on a concrete storage format. JsonlEventSource is the v1 implementation; DuckDB /
 * PostgreSQL / Redis Streams / OpenTelemetry sources can be added later WITHOUT
 * changing any aggregator (the whole point of the abstraction).
 *
 * Contract: specs/002-ai-observability-platform/contracts/event-source.md
 */

export interface EventReadResult {
  /** Normalized + deduplicated events in deterministic order (timestamp, then event_id). */
  events: ObservationEvent[];
  /** Malformed/invalid source records skipped (never silently dropped — FR-003/SC-011). */
  skipped: number;
  /** Records collapsed by deduplication (FR-004/SC-003). */
  duplicates: number;
  /** False when the source is absent/empty (cold start, not an error). */
  present: boolean;
  /** Human-facing identifier of where events came from. */
  source: string;
}

export interface EventSource {
  /** Read all currently-available events, normalized + deduped, stably ordered. */
  read(): Promise<EventReadResult>;
  /** Cheap freshness probe so callers can avoid a full re-read when nothing changed. */
  fingerprint(): Promise<string>;
  /** Human-facing identifier (path, DSN label) for meta/debug. */
  describe(): string;
}

/** Deterministic order: timestamp ascending, then event_id — required for replay reproducibility. */
export function sortEvents(events: ObservationEvent[]): ObservationEvent[] {
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (ta !== tb) return ta - tb;
    return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
  });
}

/** Collapse events sharing an event_id; report how many were removed. */
export function dedupeEvents(events: ObservationEvent[]): {
  events: ObservationEvent[];
  duplicates: number;
} {
  const seen = new Map<string, ObservationEvent>();
  let duplicates = 0;
  for (const e of events) {
    if (seen.has(e.event_id)) {
      duplicates++;
      continue;
    }
    seen.set(e.event_id, e);
  }
  return { events: [...seen.values()], duplicates };
}

/**
 * In-memory EventSource — storage-agnostic, no filesystem. Used for replay/migration
 * verification and offline tests: proves analytics are identical across sinks (SC-014).
 */
export class InMemoryEventSource implements EventSource {
  constructor(
    private readonly source: ObservationEvent[],
    private readonly label = "memory",
  ) {}

  async read(): Promise<EventReadResult> {
    const { events, duplicates } = dedupeEvents(this.source);
    const ordered = sortEvents(events);
    return {
      events: ordered,
      skipped: 0,
      duplicates,
      present: ordered.length > 0,
      source: this.label,
    };
  }

  async fingerprint(): Promise<string> {
    return `memory:${this.source.length}`;
  }

  describe(): string {
    return this.label;
  }
}
