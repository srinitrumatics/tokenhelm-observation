import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import { computeModelAnalytics, computeModelTrend } from "../analytics/models";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T042 — Model & Provider analytics (US5). FR-023 + reconciliation (constraint #5):
 * Σ model cost == global; Σ provider cost == global; Σ model/provider tokens == global.
 *
 * Fixture (model-events.jsonl), all USD:
 *   gemini-3-flash-preview: m1 0.0010, m2 0.0015 → 0.0025 / 300
 *   gemini-3-pro:           m3 0.0050           → 0.0050 / 280
 *   gpt-x (openai):         m4 0.0030, m5 0.0008(err) → 0.0038 / 270, fail 0.5
 *   providers: gemini 0.0075 / 580 ; openai 0.0038 / 270
 *   global = 0.0113 / 850
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function load() {
  return (await new JsonlEventSource(fixture("model-events.jsonl")).read()).events;
}

describe("model & provider analytics", () => {
  it("computes per-model metrics ranked by cost", async () => {
    const a = computeModelAnalytics(await load());
    expect(a.models.map((m) => m.key)).toEqual(["gemini-3-pro", "gpt-x", "gemini-3-flash-preview"]);
    const gpt = a.models.find((m) => m.key === "gpt-x")!;
    expect(gpt.failureRate).toBeCloseTo(0.5);
    expect(gpt.avgLatencyMs).toBeCloseTo((400 + 150) / 2);
    expect(gpt.averageCostPerCall).toBe("0.0019"); // 0.0038 / 2
  });

  it("computes per-provider metrics with side-by-side comparison data", async () => {
    const a = computeModelAnalytics(await load());
    expect(a.providers.map((p) => p.key)).toEqual(["gemini", "openai"]);
    const gemini = a.providers.find((p) => p.key === "gemini")!;
    expect(gemini.cost).toBe("0.0075");
    expect(gemini.totalTokens).toBe(580);
    expect(gemini.models.sort()).toEqual(["gemini-3-flash-preview", "gemini-3-pro"]);
    expect(a.providers.find((p) => p.key === "openai")!.failureRate).toBeCloseTo(0.5);
  });
});

describe("model/provider reconciliation (constraint #5)", () => {
  it("Σ model cost == global and Σ provider cost == global", async () => {
    const events = await load();
    const a = computeModelAnalytics(events);
    const global = computeSummary(events).costByCurrency.USD;
    assertReconciles(a.models, global, "Σ model == global cost");
    assertReconciles(a.providers, global, "Σ provider == global cost");
    expect(global).toBe("0.0113");
  });

  it("Σ model tokens == global and Σ provider tokens == global", async () => {
    const events = await load();
    const a = computeModelAnalytics(events);
    const globalTokens = computeSummary(events).totalTokens;
    assertTokensReconcile(a.models, globalTokens, "Σ model == global tokens");
    assertTokensReconcile(a.providers, globalTokens, "Σ provider == global tokens");
    expect(globalTokens).toBe(850);
  });
});

describe("model trend", () => {
  it("produces a cost/usage/token trend for a single model", async () => {
    const trend = computeModelTrend(await load(), { model: "gemini-3-flash-preview" });
    expect(trend.length).toBeGreaterThan(0);
    expect(trend.every((p) => typeof p.cost === "string")).toBe(true);
  });
});
