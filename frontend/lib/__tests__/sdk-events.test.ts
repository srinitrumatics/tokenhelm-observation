import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import { computePromptLeaderboard } from "../analytics/prompts";
import { computeAgentLeaderboard } from "../analytics/agents";
import { computeWorkflowLeaderboard } from "../analytics/workflows";
import { computeModelAnalytics } from "../analytics/models";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * Cross-stack gate for the Observation SDK (v1.1 Epic 1 / ADR 0002).
 *
 * sdk-emitted-events.jsonl is produced by the Python SDK
 * (`sdk/python/examples/generate_fixture.py`). This test proves the platform consumes
 * SDK-produced events UNCHANGED: every line normalizes (0 skipped) and all five
 * reconciliation identities hold decimal-exact — identical analytics to the in-platform
 * emitter (global 0.017 / 1560). Regenerate the fixture with that script if the SDK changes.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function load() {
  return new JsonlEventSource(path.join(FIXTURES, "sdk-emitted-events.jsonl")).read();
}

describe("Observation SDK → platform (identical analytics)", () => {
  it("every SDK-emitted line normalizes — nothing skipped", async () => {
    const res = await load();
    expect(res.present).toBe(true);
    expect(res.skipped).toBe(0);
    expect(res.events.length).toBe(7);
  });

  it("global totals match the reference scenario", async () => {
    const summary = computeSummary((await load()).events);
    expect(summary.costByCurrency.USD).toBe("0.017");
    expect(summary.totalTokens).toBe(1560);
    expect(summary.callCount).toBe(7);
  });

  it("all five reconciliation identities hold over SDK-emitted events", async () => {
    const events = (await load()).events;
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;

    const prompts = computePromptLeaderboard(events);
    assertReconciles(
      [...prompts.prompts.map((p) => ({ cost: p.cost })), ...(prompts.unattributed ? [{ cost: prompts.unattributed.cost }] : [])],
      global, "Σ prompt + unattributed (SDK)");

    const agents = computeAgentLeaderboard(events);
    assertReconciles(
      [...agents.agents.filter((a) => agents.roots.includes(a.key)).map((a) => ({ cost: a.rolledCost })), ...(agents.unattributed ? [{ cost: agents.unattributed.cost }] : [])],
      global, "Σ agent rollups + unattributed (SDK)");

    const workflows = computeWorkflowLeaderboard(events);
    assertReconciles(
      [...workflows.workflows.map((w) => ({ cost: w.totalCost })), ...(workflows.unattributed ? [{ cost: workflows.unattributed.totalCost }] : [])],
      global, "Σ workflow + unattributed (SDK)");

    const ma = computeModelAnalytics(events);
    assertReconciles(ma.models, global, "Σ model (SDK)");
    assertReconciles(ma.providers, global, "Σ provider (SDK)");
    assertTokensReconcile(ma.models, globalTokens, "Σ model tokens (SDK)");
  });

  it("derives the agent hierarchy and unattributed bucket from SDK attribution", async () => {
    const events = (await load()).events;
    const agents = computeAgentLeaderboard(events);
    expect(agents.roots).toEqual(["coordinator"]);
    const coord = agents.agents.find((a) => a.key === "coordinator")!;
    expect(coord.children.sort()).toEqual(["planner", "summarizer", "weather"]);
    // sdk-c7 had no attribution → explicit unattributed bucket.
    expect(agents.unattributed?.cost).toBe("0.0015");
  });
});
