import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import {
  computePromptLeaderboard,
  computePromptDetail,
  computePromptVersions,
  computePromptFlags,
} from "../analytics/prompts";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * T025 — Prompt analytics (US2). FR-013–FR-017 + the dual reconciliation identities
 * (constraint #5): Σ prompt cost + unattributed == global cost, and the same for
 * tokens. Fixture (prompt-events.jsonl), all USD:
 *   summarizer: p1 0.0100, p2 0.0100 (v1), p3 0.0040 (v2)  → 0.0240 / 2900 tok
 *   chatty:     p4 0.0020 (out-heavy)                       → 0.0020 / 500 tok
 *   bloated:    p5 0.0050 (in 2000 / out 50)                → 0.0050 / 2050 tok
 *   unattributed: p6 0.0030 (missing)                       → 0.0030 / 360 tok
 *   global = 0.0340 / 5810 tok / 6 calls
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function loadPrompts() {
  return (await new JsonlEventSource(fixture("prompt-events.jsonl")).read()).events;
}

describe("prompt leaderboard", () => {
  it("ranks attributed prompts by cost with correct per-prompt stats", async () => {
    const lb = computePromptLeaderboard(await loadPrompts());
    expect(lb.prompts.map((p) => p.key)).toEqual(["summarizer", "bloated", "chatty"]);

    const summarizer = lb.prompts[0];
    expect(summarizer.calls).toBe(3);
    expect(summarizer.cost).toBe("0.024"); // decimal.js trims trailing zeros
    expect(summarizer.totalTokens).toBe(2900);
    expect(summarizer.versions.sort()).toEqual(["v1", "v2"]);
  });

  it("exposes future-ready PromptOps fields", async () => {
    const lb = computePromptLeaderboard(await loadPrompts());
    const summarizer = lb.prompts.find((p) => p.key === "summarizer")!;
    expect(summarizer.firstSeen).toBe("2026-06-20T10:00:00+00:00");
    expect(summarizer.lastSeen).toBe("2026-06-21T09:00:00+00:00");
    expect(summarizer.dominantModel).toBe("gemini-3-flash-preview");
    expect(summarizer.dominantProvider).toBe("gemini");
    expect(summarizer.averageCostPerCall).toBe("0.008"); // 0.024 / 3
    expect(summarizer.averageTokensPerCall).toBeCloseTo(2900 / 3);
    expect(summarizer.attributionCompleteness).toBe(1); // all complete
  });

  it("computes output/input and input/output ratios", async () => {
    const lb = computePromptLeaderboard(await loadPrompts());
    const chatty = lb.prompts.find((p) => p.key === "chatty")!;
    expect(chatty.outputInputRatio).toBeCloseTo(400 / 100); // generative
    const bloated = lb.prompts.find((p) => p.key === "bloated")!;
    expect(bloated.inputOutputRatio).toBeCloseTo(2000 / 50); // heavy prompt
  });

  it("groups unattributed events explicitly (never folded into a named prompt)", async () => {
    const lb = computePromptLeaderboard(await loadPrompts());
    expect(lb.prompts.some((p) => p.key === "unknown")).toBe(false);
    expect(lb.unattributed).not.toBeNull();
    expect(lb.unattributed!.cost).toBe("0.003");
    expect(lb.unattributed!.totalTokens).toBe(360);
  });
});

describe("prompt reconciliation (constraint #5)", () => {
  it("Σ prompt cost + unattributed == global cost", async () => {
    const events = await loadPrompts();
    const lb = computePromptLeaderboard(events);
    const global = computeSummary(events).costByCurrency.USD;
    const groups = [...lb.prompts, ...(lb.unattributed ? [lb.unattributed] : [])];
    assertReconciles(groups, global, "Σ prompt + unattributed == global cost");
    expect(global).toBe("0.034");
  });

  it("Σ prompt tokens + unattributed == global tokens", async () => {
    const events = await loadPrompts();
    const lb = computePromptLeaderboard(events);
    const globalTokens = computeSummary(events).totalTokens;
    const groups = [...lb.prompts, ...(lb.unattributed ? [lb.unattributed] : [])];
    assertTokensReconcile(groups, globalTokens, "Σ prompt + unattributed == global tokens");
    expect(globalTokens).toBe(5810);
  });
});

describe("prompt versions", () => {
  it("splits a prompt into versions for comparison", async () => {
    const versions = computePromptVersions(await loadPrompts(), "summarizer");
    expect(versions.map((v) => v.version)).toEqual(["v1", "v2"]);
    const v1 = versions.find((v) => v.version === "v1")!;
    expect(v1.calls).toBe(2);
    expect(v1.cost).toBe("0.02");
    const v2 = versions.find((v) => v.version === "v2")!;
    expect(v2.outputInputRatio).toBeCloseTo(200 / 500); // v2 improved generativity
  });

  it("handles legacy/unversioned prompts gracefully", async () => {
    const versions = computePromptVersions(await loadPrompts(), "chatty");
    expect(versions.map((v) => v.version)).toEqual(["unversioned"]);
  });
});

describe("prompt detail", () => {
  it("builds timeline, recent executions, trend, and attribution counts", async () => {
    const detail = computePromptDetail(await loadPrompts(), "summarizer");
    expect(detail.stats.calls).toBe(3);
    expect(detail.recentExecutions).toHaveLength(3);
    // recent executions are newest-first
    const ts = detail.recentExecutions.map((r) => Date.parse(r.timestamp));
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
    expect(detail.attribution.complete).toBe(3);
    expect(detail.trend.length).toBeGreaterThan(0);
    expect(detail.versions).toHaveLength(2);
  });
});

describe("prompt recommendation flags (foundation)", () => {
  it("flags expensive prompts, high input/output ratios, and high token usage", async () => {
    const lb = computePromptLeaderboard(await loadPrompts());
    const flags = computePromptFlags(lb);
    const byType = (t: string) => flags.filter((f) => f.type === t).map((f) => f.prompt);

    expect(byType("expensive")).toContain("summarizer"); // 0.0240 > 2× median (0.0050)
    expect(byType("high-input-output-ratio")).toContain("bloated"); // 40 >= 10
    expect(byType("high-token-usage")).toContain("bloated"); // 2050 > 2× median
  });

  it("returns no flags for an empty leaderboard", () => {
    const flags = computePromptFlags({
      prompts: [],
      unattributed: null,
      globalCost: {},
      globalTokens: 0,
      globalCalls: 0,
    });
    expect(flags).toEqual([]);
  });
});
