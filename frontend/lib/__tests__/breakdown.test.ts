import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { computeBreakdown } from "../aggregate";
import type { UsageRecord } from "../schema";

function rec(
  model: string,
  provider: string,
  total_tokens: number,
  cost: string,
  currency = "USD",
  priced = true,
  agent?: string,
): UsageRecord {
  return {
    provider,
    model,
    input_tokens: 1,
    output_tokens: 1,
    total_tokens,
    latency: 0,
    cost,
    timestamp: "2026-06-27T00:00:00+00:00",
    usage_complete: true,
    priced,
    currency,
    agent,
  };
}

describe("computeBreakdown", () => {
  const records = [
    rec("model-a", "gemini", 100, "0.010"),
    rec("model-a", "gemini", 100, "0.010"),
    rec("model-b", "openai", 200, "0.020"),
  ];

  it("groups per model with correct totals and shares (FR-006)", () => {
    const b = computeBreakdown(records, "model");
    expect(b.dimension).toBe("model");
    // sorted by tokens desc: model-b (200) then model-a (200 total)
    const byKey = Object.fromEntries(b.groups.map((g) => [g.key, g]));
    expect(byKey["model-a"].callCount).toBe(2);
    expect(byKey["model-a"].totalTokens).toBe(200);
    expect(new Decimal(byKey["model-a"].costByCurrency.USD).equals(new Decimal("0.020"))).toBe(true);
    // total tokens = 400; model-a share = 0.5
    expect(byKey["model-a"].tokenShare).toBeCloseTo(0.5, 10);
    // total cost = 0.040; model-a cost share = 0.020/0.040 = 0.5
    expect(byKey["model-a"].costShare).toBeCloseTo(0.5, 10);
  });

  it("groups per provider", () => {
    const b = computeBreakdown(records, "provider");
    const keys = b.groups.map((g) => g.key).sort();
    expect(keys).toEqual(["gemini", "openai"]);
  });

  it("keeps cost separated per currency within a group (FR-011)", () => {
    const multi = [
      rec("model-a", "gemini", 100, "1.00", "USD"),
      rec("model-a", "gemini", 100, "2.00", "EUR"),
    ];
    const b = computeBreakdown(multi, "model");
    const g = b.groups.find((x) => x.key === "model-a")!;
    expect(new Decimal(g.costByCurrency.USD).equals(new Decimal("1.00"))).toBe(true);
    expect(new Decimal(g.costByCurrency.EUR).equals(new Decimal("2.00"))).toBe(true);
  });

  it("groups per agent and attributes tokens/cost to each (which agent consumed usage)", () => {
    const agentRecords = [
      rec("gemini-3-flash-preview", "gemini", 100, "0.010", "USD", true, "coordinator"),
      rec("gemini-3-flash-preview", "gemini", 300, "0.030", "USD", true, "sales_agent"),
    ];
    const b = computeBreakdown(agentRecords, "agent");
    expect(b.dimension).toBe("agent");
    const byKey = Object.fromEntries(b.groups.map((g) => [g.key, g]));
    expect(Object.keys(byKey).sort()).toEqual(["coordinator", "sales_agent"]);
    expect(byKey["sales_agent"].totalTokens).toBe(300);
    expect(new Decimal(byKey["coordinator"].costByCurrency.USD).equals(new Decimal("0.010"))).toBe(
      true,
    );
  });

  it("attributes records without an agent field to 'unknown' (legacy records)", () => {
    const legacy = [
      rec("gemini-3-flash-preview", "gemini", 100, "0.010"), // no agent
      rec("gemini-3-flash-preview", "gemini", 100, "0.010", "USD", true, "coordinator"),
    ];
    const b = computeBreakdown(legacy, "agent");
    const keys = b.groups.map((g) => g.key).sort();
    expect(keys).toEqual(["coordinator", "unknown"]);
  });

  it("excludes unpriced cost but counts tokens in the group", () => {
    const mix = [
      rec("model-a", "gemini", 100, "0.50", "USD", true),
      rec("model-a", "gemini", 100, "9.99", "USD", false),
    ];
    const b = computeBreakdown(mix, "model");
    const g = b.groups[0];
    expect(g.totalTokens).toBe(200);
    expect(new Decimal(g.costByCurrency.USD).equals(new Decimal("0.50"))).toBe(true);
  });
});
