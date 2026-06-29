import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import {
  computeAgentLeaderboard,
  computeAgentDetail,
  computeAgentFlags,
  type AgentStats,
} from "../analytics/agents";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T030 — Agent analytics (US3). FR-018–FR-019 + reconciliation (constraint #5):
 *   Σ root rolled cost   + unattributed == global cost
 *   Σ root rolled tokens + unattributed == global tokens
 *   per agent: rolled cost == own + Σ child rolled cost
 *
 * Fixture (agent-events.jsonl), all USD:
 *   coordinator (root): a1 0.0030, a2 0.0030  → own 0.0060 / 480 tok
 *   ├ planner:   a3 0.0020 / 150
 *   ├ weather:   a4 0.0025 (tool), a5 0.0010 (error) → 0.0035 / 330, fail 0.5
 *   └ summarizer:a6 0.0040 / 500
 *   unattributed: a7 0.0015 / 100 (missing)
 *   global = 0.0170 / 1560 tok / 7 calls
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function loadAgents() {
  return (await new JsonlEventSource(fixture("agent-events.jsonl")).read()).events;
}

const byKey = (agents: AgentStats[], k: string) => agents.find((a) => a.key === k)!;

describe("agent leaderboard", () => {
  it("ranks agents by rolled cost and computes own metrics", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    expect(lb.agents[0].key).toBe("coordinator"); // highest rolled cost
    const weather = byKey(lb.agents, "weather");
    expect(weather.calls).toBe(2);
    expect(weather.failureRate).toBeCloseTo(0.5);
    expect(weather.toolInvocations).toBe(1);
    expect(weather.tools[0].name).toBe("weather_tool");
  });

  it("derives hierarchy (parent/children/depth) from parent_agent edges", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    expect(lb.roots).toEqual(["coordinator"]);
    const coord = byKey(lb.agents, "coordinator");
    expect(coord.children.sort()).toEqual(["planner", "summarizer", "weather"]);
    expect(coord.childAgentCount).toBe(3);
    expect(byKey(lb.agents, "weather").parent).toBe("coordinator");
    expect(byKey(lb.agents, "weather").depth).toBe(1);
    expect(lb.maxDepth).toBe(1);
  });

  it("puts agent-less events in an explicit unattributed bucket", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    expect(lb.agents.some((a) => a.key === "unknown")).toBe(false);
    expect(lb.unattributed).not.toBeNull();
    expect(lb.unattributed!.cost).toBe("0.0015");
    expect(lb.unattributed!.totalTokens).toBe(100);
  });
});

describe("agent reconciliation (constraint #5)", () => {
  it("Σ root rolled cost + unattributed == global cost", async () => {
    const events = await loadAgents();
    const lb = computeAgentLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    const roots = lb.agents
      .filter((a) => lb.roots.includes(a.key))
      .map((a) => ({ cost: a.rolledCost }));
    const groups = [...roots, ...(lb.unattributed ? [{ cost: lb.unattributed.cost }] : [])];
    assertReconciles(groups, global, "Σ root rolled + unattributed == global cost");
    expect(global).toBe("0.017");
  });

  it("Σ root rolled tokens + unattributed == global tokens", async () => {
    const events = await loadAgents();
    const lb = computeAgentLeaderboard(events);
    const globalTokens = computeSummary(events).totalTokens;
    const roots = lb.agents
      .filter((a) => lb.roots.includes(a.key))
      .map((a) => ({ totalTokens: a.rolledTotalTokens }));
    const groups = [...roots, ...(lb.unattributed ? [{ totalTokens: lb.unattributed.totalTokens }] : [])];
    assertTokensReconcile(groups, globalTokens, "Σ root rolled + unattributed == global tokens");
    expect(globalTokens).toBe(1560);
  });

  it("per agent: rolled cost == own cost + Σ child rolled cost", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    const coord = byKey(lb.agents, "coordinator");
    const childRolled = coord.children
      .map((c) => byKey(lb.agents, c).rolledCost)
      .reduce((acc, c) => acc.plus(new Decimal(c)), new Decimal(0));
    const expected = new Decimal(coord.cost).plus(childRolled);
    expect(new Decimal(coord.rolledCost).equals(expected)).toBe(true);
    expect(coord.rolledCost).toBe("0.0155");
  });
});

describe("execution tree", () => {
  it("builds an agent forest with tool leaves", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    expect(lb.tree).toHaveLength(1);
    const root = lb.tree[0];
    expect(root.key).toBe("coordinator");
    expect(root.type).toBe("agent");
    const weatherNode = root.children.find((n) => n.key === "weather")!;
    expect(weatherNode.type).toBe("agent");
    const toolLeaf = weatherNode.children.find((n) => n.type === "tool");
    expect(toolLeaf?.key).toBe("weather_tool");
    expect(toolLeaf?.calls).toBe(1); // invocations
  });
});

describe("agent detail", () => {
  it("returns parent, children, executions, trend, attribution", async () => {
    const detail = computeAgentDetail(await loadAgents(), "weather");
    expect(detail.parent).toBe("coordinator");
    expect(detail.recentExecutions).toHaveLength(2);
    expect(detail.attribution.complete).toBe(2);
    expect(detail.trend.length).toBeGreaterThan(0);
  });
});

describe("agent recommendation flags (foundation)", () => {
  it("flags expensive agents, high token usage, and high failure rate", async () => {
    const lb = computeAgentLeaderboard(await loadAgents());
    const flags = computeAgentFlags(lb);
    const byType = (t: string) => flags.filter((f) => f.type === t).map((f) => f.agent);
    expect(byType("expensive")).toContain("coordinator");
    expect(byType("high-failure-rate")).toContain("weather");
    expect(byType("high-token-usage")).toContain("summarizer");
    // depth (1) and fan-out (3) are below thresholds → not flagged here
    expect(flags.some((f) => f.type === "deep-hierarchy")).toBe(false);
    expect(flags.some((f) => f.type === "excessive-fan-out")).toBe(false);
  });
});
