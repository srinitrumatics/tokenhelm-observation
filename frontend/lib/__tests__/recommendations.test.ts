import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { InMemoryEventSource } from "../observation/event-source";
import { migrate, replay } from "../observation/replay";
import { computeRecommendations, findRecommendation } from "../analytics/recommendations";

/**
 * T053 — Recommendation engine (US6). Recommendations are a CONSUMER of the validated
 * analytics flags. The contract under test:
 *   - every recommendation references ≥1 existing ObservationEvent (evidence),
 *   - generation is deterministic, and
 *   - replay over the same events reproduces identical recommendations.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function load(name: string) {
  return (await new JsonlEventSource(fixture(name)).read()).events;
}

const CATEGORIES = new Set([
  "Cost Optimization",
  "Prompt Optimization",
  "Workflow Optimization",
  "Agent Optimization",
  "Reliability",
  "Performance",
  "Model Selection",
]);

describe("recommendation engine", () => {
  it("generates recommendations from existing analytics flags", async () => {
    const recs = computeRecommendations(await load("workflow-events.jsonl"));
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(CATEGORIES.has(r.category)).toBe(true);
      expect(["low", "medium", "high", "critical"]).toContain(r.severity);
      expect(r.suggested_action.length).toBeGreaterThan(0);
    }
  });

  it("every recommendation references ≥1 existing ObservationEvent", async () => {
    const events = await load("workflow-events.jsonl");
    const ids = new Set(events.map((e) => e.event_id));
    const recs = computeRecommendations(events);
    for (const r of recs) {
      expect(r.related_event_ids.length).toBeGreaterThanOrEqual(1);
      for (const id of r.related_event_ids) expect(ids.has(id)).toBe(true);
      // created_at is data-derived (a real event timestamp), never wall-clock.
      const timestamps = new Set(events.map((e) => e.timestamp));
      expect(r.created_at === null || timestamps.has(r.created_at)).toBe(true);
    }
  });

  it("is deterministic — identical output on repeated runs", async () => {
    const events = await load("workflow-events.jsonl");
    const a = JSON.stringify(computeRecommendations(events));
    const b = JSON.stringify(computeRecommendations(events));
    expect(a).toBe(b);
  });

  it("replay produces identical recommendations", async () => {
    const events = await load("workflow-events.jsonl");
    const live = computeRecommendations(events);
    // Round-trip the events through a fresh sink (migrate) then replay and recompute.
    const migrated = await migrate(new InMemoryEventSource(events, "orig"));
    const replayed = computeRecommendations((await replay(migrated)).events);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });

  it("looks up a single recommendation by id", async () => {
    const events = await load("workflow-events.jsonl");
    const recs = computeRecommendations(events);
    const found = findRecommendation(events, recs[0].recommendation_id);
    expect(found).toEqual(recs[0]);
    expect(findRecommendation(events, "rec:nope")).toBeNull();
  });
});
