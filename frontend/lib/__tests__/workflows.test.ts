import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import {
  computeWorkflowLeaderboard,
  computeWorkflowDetail,
  computeWorkflowFlags,
} from "../analytics/workflows";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T040 — Workflow analytics (US5). FR-020 + reconciliation (constraint #5).
 * Fixture (workflow-events.jsonl), all USD/gemini:
 *   wf-a: 0.0020 / 240 / 2s            wf-b: 0.0305 / 1410 / 150s (multi-model)
 *   wf-c: 0.0030 / 360 / 6 tool calls, 3 errors    unattributed: 0.0015 / 100
 *   global = 0.0370 / 2110
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function load() {
  return (await new JsonlEventSource(fixture("workflow-events.jsonl")).read()).events;
}

const allGroups = (lb: { workflows: { totalCost: string; totalTokens: number }[]; unattributed: { totalCost: string; totalTokens: number } | null }) => [
  ...lb.workflows.map((w) => ({ cost: w.totalCost, totalTokens: w.totalTokens })),
  ...(lb.unattributed ? [{ cost: lb.unattributed.totalCost, totalTokens: lb.unattributed.totalTokens }] : []),
];

describe("workflow leaderboard", () => {
  it("ranks workflows by cost with execution metrics", async () => {
    const lb = computeWorkflowLeaderboard(await load());
    expect(lb.workflows[0].key).toBe("wf-b");
    const wfc = lb.workflows.find((w) => w.key === "wf-c")!;
    expect(wfc.failureRate).toBeCloseTo(3 / 6);
    expect(wfc.avgToolCalls).toBe(6);
    expect(wfc.executions).toBe(1);
  });

  it("buckets workflow-less events as unattributed", async () => {
    const lb = computeWorkflowLeaderboard(await load());
    expect(lb.unattributed?.totalCost).toBe("0.0015");
  });
});

describe("workflow reconciliation (constraint #5)", () => {
  it("Σ workflow cost + unattributed == global cost", async () => {
    const events = await load();
    const lb = computeWorkflowLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    assertReconciles(allGroups(lb), global, "Σ workflow + unattributed == global cost");
    expect(global).toBe("0.037");
  });

  it("Σ workflow tokens + unattributed == global tokens", async () => {
    const events = await load();
    const lb = computeWorkflowLeaderboard(events);
    const globalTokens = computeSummary(events).totalTokens;
    assertTokensReconcile(allGroups(lb), globalTokens, "Σ workflow + unattributed == global tokens");
    expect(globalTokens).toBe(2110);
  });

  it("workflow total == Σ its constituent events", async () => {
    const events = await load();
    const detail = computeWorkflowDetail(events, "wf-b");
    const traceCost = detail.trace.reduce((a, t) => a.plus(new Decimal(t.cost)), new Decimal(0));
    expect(new Decimal(detail.stats.totalCost).equals(traceCost)).toBe(true);
    expect(detail.stats.totalTokens).toBe(detail.trace.reduce((a, t) => a + t.totalTokens, 0));
  });
});

describe("workflow detail", () => {
  it("reconstructs the execution graph from ObservationEvent edges", async () => {
    const detail = computeWorkflowDetail(await load(), "wf-b");
    expect(detail.graph[0].key).toBe("coordinator");
    expect(detail.graph[0].children.map((c) => c.key).sort()).toEqual(["analyzer", "cheap"]);
    expect(detail.modelUsage.map((m) => m.key).sort()).toEqual(["gemini-3-flash-preview", "gemini-3-pro"]);
  });
});

describe("workflow recommendation flags (foundation)", () => {
  it("flags expensive, long-running, high-failure, tool fan-out, concentration, single-provider", async () => {
    const events = await load();
    const lb = computeWorkflowLeaderboard(events);
    const flags = computeWorkflowFlags(lb, events);
    const byType = (t: string) => flags.filter((f) => f.type === t).map((f) => f.workflow);
    expect(byType("expensive")).toContain("wf-b");
    expect(byType("long-running")).toContain("wf-b");
    expect(byType("high-failure")).toContain("wf-c");
    expect(byType("excessive-tool-fan-out")).toContain("wf-c");
    expect(byType("high-model-cost-concentration")).toContain("wf-b");
    expect(byType("single-provider-dependency").sort()).toEqual(["wf-a", "wf-b", "wf-c"]);
  });
});
