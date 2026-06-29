import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  computeTrend,
  filterByRange,
  computeSummary,
  chooseBucketGranularity,
} from "../aggregate";
import type { UsageRecord } from "../schema";

function rec(timestamp: string, total_tokens: number, cost: string): UsageRecord {
  return {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    input_tokens: 1,
    output_tokens: 1,
    total_tokens,
    latency: 0,
    cost,
    timestamp,
    usage_complete: true,
    priced: true,
    currency: "USD",
  };
}

const MULTI_DAY: UsageRecord[] = [
  rec("2026-06-24T10:00:00+00:00", 100, "0.001"),
  rec("2026-06-25T11:00:00+00:00", 200, "0.002"),
  rec("2026-06-27T12:00:00+00:00", 300, "0.003"),
];

describe("chooseBucketGranularity", () => {
  it("uses day buckets for spans over two days", () => {
    expect(chooseBucketGranularity("2026-06-24T00:00:00Z", "2026-06-27T00:00:00Z")).toBe("day");
  });
  it("uses hour buckets for short spans", () => {
    expect(chooseBucketGranularity("2026-06-27T00:00:00Z", "2026-06-27T05:00:00Z")).toBe("hour");
  });
});

describe("computeTrend", () => {
  it("produces chronologically ordered buckets", () => {
    const points = computeTrend(MULTI_DAY, "day");
    expect(points.map((p) => p.bucket)).toEqual([
      "2026-06-24",
      "2026-06-25",
      "2026-06-27",
    ]);
    expect(points[0].totalTokens).toBe(100);
  });
});

describe("filterByRange", () => {
  it("narrows both the record set and the recomputed summary (FR-005)", () => {
    const scoped = filterByRange(
      MULTI_DAY,
      "2026-06-25T00:00:00+00:00",
      "2026-06-26T00:00:00+00:00",
    );
    expect(scoped).toHaveLength(1);
    const s = computeSummary(scoped);
    expect(s.totalTokens).toBe(200);
    expect(new Decimal(s.costByCurrency.USD).equals(new Decimal("0.002"))).toBe(true);
  });

  it("treats null bounds as open", () => {
    expect(filterByRange(MULTI_DAY, null, null)).toHaveLength(3);
  });
});
