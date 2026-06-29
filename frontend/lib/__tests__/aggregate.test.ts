import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeSummary } from "../aggregate";
import type { UsageRecord } from "../schema";

function rec(partial: Partial<UsageRecord>): UsageRecord {
  return {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    latency: 0,
    cost: "0.001",
    timestamp: "2026-06-26T10:00:00+00:00",
    usage_complete: true,
    priced: true,
    currency: "USD",
    ...partial,
  };
}

// The 7 real sample records — totals verified by hand: USD 0.0040280, 7958 total tokens.
const SAMPLE: UsageRecord[] = [
  rec({ input_tokens: 1200, output_tokens: 80, total_tokens: 1280, cost: "0.000800" }),
  rec({ input_tokens: 1500, output_tokens: 140, total_tokens: 1640, cost: "0.001100" }),
  rec({ input_tokens: 272, output_tokens: 42, total_tokens: 405, cost: "0.0002410" }),
  rec({ input_tokens: 383, output_tokens: 76, total_tokens: 1398, cost: "0.0003815" }),
  rec({ input_tokens: 465, output_tokens: 22, total_tokens: 762, cost: "0.0002875" }),
  rec({ input_tokens: 509, output_tokens: 198, total_tokens: 2068, cost: "0.0007495" }),
  rec({ input_tokens: 272, output_tokens: 133, total_tokens: 405, cost: "0.0004685" }),
];

describe("computeSummary", () => {
  it("totals equal a manual sum with zero discrepancy (SC-002)", () => {
    const s = computeSummary(SAMPLE);
    expect(s.callCount).toBe(7);
    expect(s.inputTokens).toBe(4601);
    expect(s.outputTokens).toBe(691);
    expect(s.totalTokens).toBe(7958);
    // Exact decimal equality, not float-approx.
    expect(new Decimal(s.costByCurrency.USD).equals(new Decimal("0.0040280"))).toBe(true);
  });

  it("excludes unpriced records from cost but counts their tokens (FR-004)", () => {
    const records = [
      rec({ cost: "0.10", total_tokens: 100, priced: true }),
      rec({ cost: "0.99", total_tokens: 50, priced: false }),
    ];
    const s = computeSummary(records);
    expect(s.callCount).toBe(2);
    expect(s.totalTokens).toBe(150); // both counted
    expect(s.pricedCount).toBe(1);
    expect(s.unpricedCount).toBe(1);
    expect(new Decimal(s.costByCurrency.USD).equals(new Decimal("0.10"))).toBe(true); // only priced
  });

  it("uses stored total_tokens as-is even when > input + output (FR-010)", () => {
    const s = computeSummary([
      rec({ input_tokens: 272, output_tokens: 42, total_tokens: 405 }),
    ]);
    expect(s.totalTokens).toBe(405); // not recomputed to 314
  });

  it("keeps cost separated per currency (FR-011)", () => {
    const s = computeSummary([
      rec({ cost: "1.00", currency: "USD" }),
      rec({ cost: "2.00", currency: "EUR" }),
    ]);
    expect(new Decimal(s.costByCurrency.USD).equals(new Decimal("1.00"))).toBe(true);
    expect(new Decimal(s.costByCurrency.EUR).equals(new Decimal("2.00"))).toBe(true);
  });

  it("handles an empty record set", () => {
    const s = computeSummary([], 0);
    expect(s.callCount).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.costByCurrency).toEqual({});
    expect(s.firstTimestamp).toBeNull();
  });

  it("carries the skippedLines count through", () => {
    const s = computeSummary(SAMPLE, 3);
    expect(s.skippedLines).toBe(3);
  });
});
