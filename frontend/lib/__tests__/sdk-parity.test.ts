import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
 * Cross-LANGUAGE protocol-parity gate (v1.2 — TypeScript/Node Observation SDK).
 *
 * sdk-emitted-events.typescript.jsonl is produced by the TypeScript SDK
 * (`sdk/typescript/examples/generateFixture.ts`); sdk-emitted-events.jsonl by the Python SDK.
 * This test proves two things at once:
 *
 *   1. PARITY — the two SDKs emit field-for-field identical ObservationEvents; the ONLY
 *      difference is `metadata.sdk` (the producer's self-identification). That is the
 *      definition of "protocol parity, not feature parity": the Observation Protocol is
 *      language-independent.
 *   2. IDENTICAL ANALYTICS — the platform consumes the TS-emitted events UNCHANGED: every
 *      line normalizes (0 skipped) and all five reconciliation identities hold decimal-exact
 *      (global 0.017 / 1560), exactly as for the Python fixture and the in-platform emitter.
 *
 * Regenerate the TS fixture with `npm run gen:fixture` in sdk/typescript if the SDK changes.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PY_FIXTURE = path.join(FIXTURES, "sdk-emitted-events.jsonl");
const TS_FIXTURE = path.join(FIXTURES, "sdk-emitted-events.typescript.jsonl");

function rawEvents(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function loadTs() {
  return new JsonlEventSource(TS_FIXTURE).read();
}

describe("Observation Protocol parity: Python SDK ≡ TypeScript SDK", () => {
  it("emits field-for-field identical events — only metadata.sdk differs", () => {
    const py = rawEvents(PY_FIXTURE);
    const ts = rawEvents(TS_FIXTURE);
    expect(ts.length).toBe(py.length);

    // The producer stamps are the only allowed difference.
    expect((py[0].metadata as Record<string, unknown>).sdk).toBe("observation-sdk-python");
    expect((ts[0].metadata as Record<string, unknown>).sdk).toBe("observation-sdk-typescript");

    const stripSdk = (e: Record<string, unknown>) => {
      const { metadata, ...rest } = e;
      const { sdk: _sdk, ...metaRest } = (metadata as Record<string, unknown>);
      return { ...rest, metadata: metaRest };
    };

    py.forEach((pyEvent, i) => {
      // Deep-equal modulo the producer stamp (0.0 vs 0 in latency_ms collapse under JSON.parse).
      expect(stripSdk(ts[i])).toEqual(stripSdk(pyEvent));
    });
  });
});

describe("TypeScript SDK → platform (identical analytics)", () => {
  it("every TS-emitted line normalizes — nothing skipped", async () => {
    const res = await loadTs();
    expect(res.present).toBe(true);
    expect(res.skipped).toBe(0);
    expect(res.events.length).toBe(7);
  });

  it("global totals match the reference scenario", async () => {
    const summary = computeSummary((await loadTs()).events);
    expect(summary.costByCurrency.USD).toBe("0.017");
    expect(summary.totalTokens).toBe(1560);
    expect(summary.callCount).toBe(7);
  });

  it("all five reconciliation identities hold over TS-emitted events", async () => {
    const events = (await loadTs()).events;
    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;

    const prompts = computePromptLeaderboard(events);
    assertReconciles(
      [...prompts.prompts.map((p) => ({ cost: p.cost })), ...(prompts.unattributed ? [{ cost: prompts.unattributed.cost }] : [])],
      global, "Σ prompt + unattributed (TS SDK)");

    const agents = computeAgentLeaderboard(events);
    assertReconciles(
      [...agents.agents.filter((a) => agents.roots.includes(a.key)).map((a) => ({ cost: a.rolledCost })), ...(agents.unattributed ? [{ cost: agents.unattributed.cost }] : [])],
      global, "Σ agent rollups + unattributed (TS SDK)");

    const workflows = computeWorkflowLeaderboard(events);
    assertReconciles(
      [...workflows.workflows.map((w) => ({ cost: w.totalCost })), ...(workflows.unattributed ? [{ cost: workflows.unattributed.totalCost }] : [])],
      global, "Σ workflow + unattributed (TS SDK)");

    const ma = computeModelAnalytics(events);
    assertReconciles(ma.models, global, "Σ model (TS SDK)");
    assertReconciles(ma.providers, global, "Σ provider (TS SDK)");
    assertTokensReconcile(ma.models, globalTokens, "Σ model tokens (TS SDK)");
  });

  it("derives the agent hierarchy and unattributed bucket from TS attribution", async () => {
    const events = (await loadTs()).events;
    const agents = computeAgentLeaderboard(events);
    expect(agents.roots).toEqual(["coordinator"]);
    const coord = agents.agents.find((a) => a.key === "coordinator")!;
    expect(coord.children.sort()).toEqual(["planner", "summarizer", "weather"]);
    expect(agents.unattributed?.cost).toBe("0.0015");
  });
});
