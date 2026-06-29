import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { JsonlEventSource } from "../observation/jsonl-source";
import { InMemoryEventSource } from "../observation/event-source";
import { migrate, replay } from "../observation/replay";
import { computeSummary } from "../analytics/overview";
import { computePromptLeaderboard } from "../analytics/prompts";
import { computeAgentLeaderboard } from "../analytics/agents";
import { computeWorkflowLeaderboard } from "../analytics/workflows";
import { computeModelAnalytics } from "../analytics/models";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T063 — Consolidated reconciliation invariants (locked constraint #5).
 *
 * One shared fixture, ALL FIVE identities asserted decimal-exact for BOTH cost and
 * tokens. Because every analytics module partitions all events into named groups + an
 * explicit "unattributed" bucket, these identities hold *by construction*; this test is
 * the single gate that proves it across prompts, agents, workflows, models, providers.
 *
 * reconcile-events.jsonl (all USD) → global 0.0170 / 1560 tokens / 7 calls:
 *   providers : gemini 0.0135/1230 ; openai 0.0035/330
 *   models    : flash 0.0095/730 ; pro 0.0040/500 ; gpt-x 0.0035/330
 *   workflows : wf-alpha 0.0085/720 ; wf-beta 0.0070/740 ; unattributed 0.0015/100
 *   agents    : coordinator(root) rolled 0.0155/1460 ; unattributed 0.0015/100
 *   prompts   : route/plan/weather/summary attributed ; unattributed 0.0015/100
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function load() {
  return (await new JsonlEventSource(fixture("reconcile-events.jsonl")).read()).events;
}

describe("consolidated reconciliation (constraint #5)", () => {
  it("global totals are the decimal-exact reference", async () => {
    const summary = computeSummary(await load());
    expect(summary.costByCurrency.USD).toBe("0.017");
    expect(summary.totalTokens).toBe(1560);
    expect(summary.callCount).toBe(7);
  });

  it("Σ prompt cost + unattributed == global cost (and tokens)", async () => {
    const events = await load();
    const lb = computePromptLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;
    const costGroups = [
      ...lb.prompts.map((p) => ({ cost: p.cost })),
      ...(lb.unattributed ? [{ cost: lb.unattributed.cost }] : []),
    ];
    const tokenGroups = [
      ...lb.prompts.map((p) => ({ totalTokens: p.totalTokens })),
      ...(lb.unattributed ? [{ totalTokens: lb.unattributed.totalTokens }] : []),
    ];
    assertReconciles(costGroups, global, "Σ prompt + unattributed == global cost");
    assertTokensReconcile(tokenGroups, globalTokens, "Σ prompt + unattributed == global tokens");
  });

  it("Σ agent root rollups + unattributed == global cost (and tokens)", async () => {
    const events = await load();
    const lb = computeAgentLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;
    const roots = lb.agents.filter((a) => lb.roots.includes(a.key));
    const costGroups = [
      ...roots.map((a) => ({ cost: a.rolledCost })),
      ...(lb.unattributed ? [{ cost: lb.unattributed.cost }] : []),
    ];
    const tokenGroups = [
      ...roots.map((a) => ({ totalTokens: a.rolledTotalTokens })),
      ...(lb.unattributed ? [{ totalTokens: lb.unattributed.totalTokens }] : []),
    ];
    assertReconciles(costGroups, global, "Σ agent rollups + unattributed == global cost");
    assertTokensReconcile(tokenGroups, globalTokens, "Σ agent rollups + unattributed == global tokens");

    // Parent/child invariant: rolled == own + Σ child rolled.
    const coord = lb.agents.find((a) => a.key === "coordinator")!;
    const childRolled = coord.children
      .map((c) => lb.agents.find((a) => a.key === c)!.rolledCost)
      .reduce((acc, c) => acc.plus(new Decimal(c)), new Decimal(0));
    expect(new Decimal(coord.rolledCost).equals(new Decimal(coord.cost).plus(childRolled))).toBe(true);
  });

  it("Σ workflow cost + unattributed == global cost (and tokens)", async () => {
    const events = await load();
    const lb = computeWorkflowLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;
    const costGroups = [
      ...lb.workflows.map((w) => ({ cost: w.totalCost })),
      ...(lb.unattributed ? [{ cost: lb.unattributed.totalCost }] : []),
    ];
    const tokenGroups = [
      ...lb.workflows.map((w) => ({ totalTokens: w.totalTokens })),
      ...(lb.unattributed ? [{ totalTokens: lb.unattributed.totalTokens }] : []),
    ];
    assertReconciles(costGroups, global, "Σ workflow + unattributed == global cost");
    assertTokensReconcile(tokenGroups, globalTokens, "Σ workflow + unattributed == global tokens");
  });

  it("Σ model cost == global and Σ provider cost == global (and tokens)", async () => {
    const events = await load();
    const a = computeModelAnalytics(events);
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;
    assertReconciles(a.models, global, "Σ model == global cost");
    assertReconciles(a.providers, global, "Σ provider == global cost");
    assertTokensReconcile(a.models, globalTokens, "Σ model == global tokens");
    assertTokensReconcile(a.providers, globalTokens, "Σ provider == global tokens");
  });

  it("all five identities survive a storage migration + replay", async () => {
    const events = await load();
    const replayed = (await replay(await migrate(new InMemoryEventSource(events, "orig")))).events;
    const global = computeSummary(replayed).costByCurrency.USD;

    const prompts = computePromptLeaderboard(replayed);
    const agents = computeAgentLeaderboard(replayed);
    const workflows = computeWorkflowLeaderboard(replayed);
    const ma = computeModelAnalytics(replayed);

    assertReconciles(
      [...prompts.prompts.map((p) => ({ cost: p.cost })), ...(prompts.unattributed ? [{ cost: prompts.unattributed.cost }] : [])],
      global, "prompts (post-migrate)");
    assertReconciles(
      [...agents.agents.filter((a) => agents.roots.includes(a.key)).map((a) => ({ cost: a.rolledCost })), ...(agents.unattributed ? [{ cost: agents.unattributed.cost }] : [])],
      global, "agents (post-migrate)");
    assertReconciles(
      [...workflows.workflows.map((w) => ({ cost: w.totalCost })), ...(workflows.unattributed ? [{ cost: workflows.unattributed.totalCost }] : [])],
      global, "workflows (post-migrate)");
    assertReconciles(ma.models, global, "models (post-migrate)");
    assertReconciles(ma.providers, global, "providers (post-migrate)");
  });
});
