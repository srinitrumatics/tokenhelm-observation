import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { InMemoryEventSource } from "../observation/event-source";
import { migrate, replay } from "../observation/replay";
import { computeAlerts } from "../analytics/alerts";
import { createAlertStore } from "../alert-state";

/**
 * T054 — Alert engine + lifecycle (US6). Behaviours under test:
 *   - the anomaly fixture produces the expected alerts,
 *   - every alert references ≥1 existing ObservationEvent,
 *   - acknowledge/resolve change ONLY alert lifecycle state,
 *   - ObservationEvents remain immutable across lifecycle actions, and
 *   - alert generation is deterministic / replay-stable.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function load(name: string) {
  return (await new JsonlEventSource(fixture(name)).read()).events;
}

describe("alert engine — anomaly fixture", () => {
  it("produces the expected alert types", async () => {
    const alerts = computeAlerts(await load("anomaly-events.jsonl"));
    const rules = new Set(alerts.map((a) => a.rule_id));
    expect(rules.has("cost-spike")).toBe(true);
    expect(rules.has("token-spike")).toBe(true);
    expect(rules.has("model-degradation")).toBe(true);
    expect(rules.has("provider-degradation")).toBe(true);
    expect(rules.has("failure-spike")).toBe(true);
    expect(rules.has("prompt-regression")).toBe(true);
    expect(rules.has("workflow-regression")).toBe(true);
  });

  it("reports the observed spike values", async () => {
    const alerts = computeAlerts(await load("anomaly-events.jsonl"));
    const cost = alerts.find((a) => a.rule_id === "cost-spike")!;
    expect(cost.observed_value).toBeCloseTo(0.05, 6); // 0.0200 + 3×0.0100
    const token = alerts.find((a) => a.rule_id === "token-spike")!;
    expect(token.observed_value).toBe(1320); // 120 + 3×400
    const prov = alerts.find((a) => a.rule_id === "provider-degradation")!;
    expect(prov.entity_id).toBe("openai");
    expect(prov.observed_value).toBeCloseTo(1.0);
  });

  it("every alert references ≥1 existing ObservationEvent", async () => {
    const events = await load("anomaly-events.jsonl");
    const ids = new Set(events.map((e) => e.event_id));
    for (const a of computeAlerts(events)) {
      expect(a.related_event_ids.length).toBeGreaterThanOrEqual(1);
      for (const id of a.related_event_ids) expect(ids.has(id)).toBe(true);
      expect(a.status).toBe("active");
    }
  });

  it("is deterministic and replay-stable", async () => {
    const events = await load("anomaly-events.jsonl");
    const live = JSON.stringify(computeAlerts(events));
    expect(JSON.stringify(computeAlerts(events))).toBe(live);
    const migrated = await migrate(new InMemoryEventSource(events, "orig"));
    expect(JSON.stringify(computeAlerts((await replay(migrated)).events))).toBe(live);
  });
});

describe("alert lifecycle — never mutates ObservationEvents", () => {
  it("acknowledgement changes only alert state", async () => {
    const events = await load("anomaly-events.jsonl");
    const before = JSON.parse(JSON.stringify(events));
    const alerts = computeAlerts(events);
    const target = alerts[0];

    const store = createAlertStore();
    store.acknowledge(target.alert_id, "2026-06-22T00:00:00+00:00");
    const merged = store.apply(alerts);

    const updated = merged.find((a) => a.alert_id === target.alert_id)!;
    expect(updated.status).toBe("acknowledged");
    expect(updated.acknowledged_at).toBe("2026-06-22T00:00:00+00:00");

    // Only the target alert changed status; all others untouched.
    for (const a of merged) {
      if (a.alert_id !== target.alert_id) expect(a.status).toBe("active");
    }
    // ObservationEvents are byte-identical (immutable).
    expect(events).toEqual(before);
  });

  it("resolution changes only alert state", async () => {
    const events = await load("anomaly-events.jsonl");
    const before = JSON.parse(JSON.stringify(events));
    const alerts = computeAlerts(events);
    const target = alerts[0];

    const store = createAlertStore();
    store.resolve(target.alert_id, "2026-06-22T01:00:00+00:00");
    const merged = store.apply(alerts);

    const updated = merged.find((a) => a.alert_id === target.alert_id)!;
    expect(updated.status).toBe("resolved");
    expect(updated.resolved_at).toBe("2026-06-22T01:00:00+00:00");
    expect(events).toEqual(before);
  });

  it("only the merged copy changes — the computed alerts array is untouched", async () => {
    const events = await load("anomaly-events.jsonl");
    const alerts = computeAlerts(events);
    const snapshot = JSON.parse(JSON.stringify(alerts));
    const store = createAlertStore();
    store.acknowledge(alerts[0].alert_id, "2026-06-22T00:00:00+00:00");
    store.apply(alerts);
    expect(alerts).toEqual(snapshot); // apply() returns a new array; inputs unchanged
  });
});
