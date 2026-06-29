import { describe, it, expect } from "vitest";
import { computeSummary, computeTrend, computeBreakdown } from "../aggregate";
import type { UsageRecord } from "../schema";

/**
 * SC-004: the analytics must handle ~10,000 records quickly. The UI render budget is
 * 3 s end-to-end; here we assert the pure aggregation pipeline (the part that scales
 * with record count) stays well under that so it is never the bottleneck.
 */
function makeRecords(n: number): UsageRecord[] {
  const base = Date.parse("2026-06-01T00:00:00+00:00");
  const models = ["gemini-3-flash-preview", "model-b", "model-c"];
  const out: UsageRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      provider: i % 5 === 0 ? "openai" : "gemini",
      model: models[i % models.length],
      input_tokens: 100 + (i % 50),
      output_tokens: 10 + (i % 20),
      total_tokens: 130 + (i % 60),
      latency: 0,
      cost: "0.0001234",
      timestamp: new Date(base + i * 60_000).toISOString(),
      usage_complete: true,
      priced: i % 7 !== 0, // ~1 in 7 unpriced
      currency: "USD",
    });
  }
  return out;
}

describe("aggregation performance (SC-004)", () => {
  it("aggregates 10,000 records well under the render budget", () => {
    const records = makeRecords(10_000);
    const start = performance.now();
    const summary = computeSummary(records);
    computeTrend(records);
    computeBreakdown(records, "model");
    computeBreakdown(records, "provider");
    const elapsed = performance.now() - start;

    expect(summary.callCount).toBe(10_000);
    expect(summary.totalTokens).toBeGreaterThan(0);
    // Generous ceiling; the full pipeline should complete in tens of ms.
    expect(elapsed).toBeLessThan(1000);
  });
});
