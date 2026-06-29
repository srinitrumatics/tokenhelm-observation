import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import {
  computeSessionExplorer,
  computeSession,
  type SessionSummary,
} from "../analytics/sessions";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T035 — Session analytics / Session Explorer (US4). Reconstruction, dual
 * reconciliation, chronological order, replay identity, analytics, and the OTel-style
 * span model.
 *
 * Fixture (session-events.jsonl), all USD:
 *   s1 (2026-06-20): e1 0.0030, e2 0.0025 (tool), e3 0.0010 → 0.0065 / 540 / 10s
 *   s2 (2026-06-21): e4 0.0040, e5 0.0080, e6 0.0060        → 0.0180 / 1530 / 120s
 *   unattributed:    e7 0.0015 / 100 (missing)
 *   global = 0.0260 / 2170 / 7 calls
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function loadSessions() {
  return (await new JsonlEventSource(fixture("session-events.jsonl")).read()).events;
}

const allGroups = (ex: { sessions: SessionSummary[]; unattributed: SessionSummary | null }) => [
  ...ex.sessions,
  ...(ex.unattributed ? [ex.unattributed] : []),
];

describe("session explorer", () => {
  it("groups events into attributed sessions + an explicit unattributed bucket", async () => {
    const ex = computeSessionExplorer(await loadSessions());
    expect(ex.sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s2"]);
    expect(ex.unattributed).not.toBeNull();
    expect(ex.unattributed!.eventCount).toBe(1);
  });

  it("builds session detail: ids, duration, cost, tokens, models, agents, tools", async () => {
    const ex = computeSessionExplorer(await loadSessions());
    const s1 = ex.sessions.find((s) => s.sessionId === "s1")!;
    expect(s1.workflowIds).toEqual(["w1"]);
    expect(s1.requestIds).toEqual(["req-a"]);
    expect(s1.durationMs).toBe(10_000);
    expect(s1.cost).toBe("0.0065");
    expect(s1.totalTokens).toBe(540);
    expect(s1.agents.sort()).toEqual(["coordinator", "weather"]);
    expect(s1.tools).toEqual(["weather_tool"]);
    expect(s1.attributionCompleteness).toBe(1);
  });
});

describe("session reconciliation (constraint #5)", () => {
  it("Σ session cost (incl. unattributed) == global cost", async () => {
    const events = await loadSessions();
    const ex = computeSessionExplorer(events);
    const global = computeSummary(events).costByCurrency.USD;
    assertReconciles(allGroups(ex), global, "Σ session == global cost");
    expect(global).toBe("0.026");
  });

  it("Σ session tokens (incl. unattributed) == global tokens", async () => {
    const events = await loadSessions();
    const ex = computeSessionExplorer(events);
    const globalTokens = computeSummary(events).totalTokens;
    assertTokensReconcile(allGroups(ex), globalTokens, "Σ session == global tokens");
    expect(globalTokens).toBe(2170);
  });

  it("session total == Σ its constituent events", async () => {
    const session = computeSession(await loadSessions(), "s1");
    const traceCost = session.trace.reduce((acc, t) => acc.plus(new Decimal(t.cost)), new Decimal(0));
    const traceTokens = session.trace.reduce((acc, t) => acc + t.totalTokens, 0);
    expect(new Decimal(session.summary.cost).equals(traceCost)).toBe(true);
    expect(session.summary.totalTokens).toBe(traceTokens);
  });
});

describe("session reconstruction", () => {
  it("orders the trace chronologically", async () => {
    const session = computeSession(await loadSessions(), "s2");
    const ts = session.trace.map((t) => Date.parse(t.timestamp));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(session.trace.map((t) => t.event_id)).toEqual(["e4", "e5", "e6"]);
  });

  it("frames the timeline from User Request to Final Response", async () => {
    const session = computeSession(await loadSessions(), "s1");
    expect(session.timeline[0].kind).toBe("request");
    expect(session.timeline[session.timeline.length - 1].kind).toBe("response");
    // middle steps are the events in order
    expect(session.timeline.filter((n) => n.kind === "step").map((n) => n.eventId)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("exposes the raw immutable ObservationEvent on each trace step (JSON inspector)", async () => {
    const session = computeSession(await loadSessions(), "s1");
    expect(session.trace[0].raw.event_id).toBe("e1");
    expect(session.trace[1].eventType).toBe("tool_call"); // e2 has a tool
  });

  it("derives an OTel-style span tree (future-ready)", async () => {
    const session = computeSession(await loadSessions(), "s1");
    const e1 = session.trace.find((t) => t.event_id === "e1")!;
    const e2 = session.trace.find((t) => t.event_id === "e2")!;
    expect(e1.parentSpanId).toBeNull(); // root (coordinator)
    expect(e2.parentSpanId).toBe("e1"); // weather's parent_agent=coordinator → e1's span
  });

  it("replay produces an identical session reconstruction", async () => {
    const events = await loadSessions();
    expect(computeSession(events, "s1")).toEqual(computeSession(events, "s1"));
  });
});

describe("session analytics (§6)", () => {
  it("reports longest, most expensive, highest-token, and averages", async () => {
    const ex = computeSessionExplorer(await loadSessions());
    const a = ex.analytics;
    expect(a.sessionCount).toBe(2);
    expect(a.longestSession?.sessionId).toBe("s2"); // 120s
    expect(a.mostExpensiveSession?.sessionId).toBe("s2"); // 0.0180
    expect(a.highestTokenSession?.sessionId).toBe("s2"); // 1530
    expect(a.averageDurationMs).toBe((10_000 + 120_000) / 2);
    expect(a.averageEventsPerSession).toBe(3);
  });
});
