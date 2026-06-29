import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { InMemoryEventSource } from "../observation/event-source";
import { replay, migrate } from "../observation/replay";
import { computeOverview } from "../analytics/overview";

/**
 * T015 — EventSource + replay. Dedup (SC-003), skip-and-count (SC-011), deterministic
 * order, cold start, replay determinism + sink-swap equivalence (SC-014/FR-031).
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

describe("JsonlEventSource", () => {
  it("normalizes, skips malformed, and dedupes on the mixed fixture", async () => {
    const src = new JsonlEventSource(fixture("mixed-events.jsonl"));
    const r = await src.read();
    // m1, m1(dup), not-json(skip), record-without-model(skip), m2
    expect(r.present).toBe(true);
    expect(r.events).toHaveLength(2); // m1, m2 after dedup
    expect(r.skipped).toBe(2); // not-json + missing-model
    expect(r.duplicates).toBe(1); // the repeated m1
  });

  it("returns events in deterministic (timestamp, event_id) order", async () => {
    const src = new JsonlEventSource(fixture("canonical-events.jsonl"));
    const r = await src.read();
    const times = r.events.map((e) => Date.parse(e.timestamp));
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it("cold start: a missing file is present:false, not an error", async () => {
    const src = new JsonlEventSource(fixture("does-not-exist.jsonl"));
    const r = await src.read();
    expect(r.present).toBe(false);
    expect(r.events).toHaveLength(0);
  });

  it("caches by fingerprint: repeated reads return the same result object", async () => {
    const src = new JsonlEventSource(fixture("canonical-events.jsonl"));
    const a = await src.read();
    const b = await src.read();
    expect(b).toBe(a); // same cached instance (no re-read when unchanged)
  });
});

describe("replay & sink migration (FR-031 / SC-014)", () => {
  it("replaying an unchanged source yields identical analytics", async () => {
    const src = new JsonlEventSource(fixture("canonical-events.jsonl"));
    const first = await replay(src);
    const second = await replay(src);
    expect(computeOverview(second.events)).toEqual(computeOverview(first.events));
  });

  it("migrating to an in-memory sink leaves all analytics unchanged", async () => {
    const jsonl = new JsonlEventSource(fixture("canonical-events.jsonl"));
    const original = await jsonl.read();
    const migrated = await migrate(jsonl);
    const fromMigrated = await migrated.read();
    expect(computeOverview(fromMigrated.events)).toEqual(computeOverview(original.events));
  });

  it("InMemoryEventSource dedupes and orders like any other source", async () => {
    const jsonl = new JsonlEventSource(fixture("canonical-events.jsonl"));
    const { events } = await jsonl.read();
    // Feed duplicates in; the source must collapse them.
    const mem = new InMemoryEventSource([...events, ...events]);
    const r = await mem.read();
    expect(r.events).toHaveLength(events.length);
    expect(r.duplicates).toBe(events.length);
  });
});
