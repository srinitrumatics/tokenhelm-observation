import Decimal from "decimal.js";
import type {
  UsageRecord,
  UsageSummary,
  CostByCurrency,
  DimensionBreakdown,
  BreakdownDimension,
  BreakdownGroup,
  TrendPoint,
} from "./schema";
import { UNKNOWN_AGENT } from "./schema";

/**
 * Pure aggregation over UsageRecord[]. Framework-agnostic so it can be unit-tested
 * offline with no network or credentials (Constitution IV — Offline Verifiability).
 *
 * Money rule: cost is summed with decimal.js from the original strings — NEVER with
 * IEEE-754 floats — so totals match a manual sum exactly (SC-002). Only records with
 * `priced === true` contribute to cost; unpriced records still count tokens/calls
 * (FR-004, Constitution V — Pricing Transparency). Stored `total_tokens` is used as
 * recorded and never recomputed (FR-010).
 */

/** Add a priced record's cost into a per-currency Decimal accumulator. */
function addCost(acc: Map<string, Decimal>, rec: UsageRecord): void {
  if (!rec.priced) return;
  const cur = rec.currency;
  const prev = acc.get(cur) ?? new Decimal(0);
  acc.set(cur, prev.plus(new Decimal(rec.cost)));
}

function toCostByCurrency(acc: Map<string, Decimal>): CostByCurrency {
  const out: CostByCurrency = {};
  for (const [cur, val] of acc) out[cur] = val.toString();
  return out;
}

export function computeSummary(
  records: UsageRecord[],
  skippedLines = 0,
): UsageSummary {
  const cost = new Map<string, Decimal>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const rec of records) {
    inputTokens += rec.input_tokens;
    outputTokens += rec.output_tokens;
    totalTokens += rec.total_tokens;
    if (rec.priced) pricedCount++;
    else unpricedCount++;
    addCost(cost, rec);

    const t = Date.parse(rec.timestamp);
    if (firstTimestamp === null || t < Date.parse(firstTimestamp)) {
      firstTimestamp = rec.timestamp;
    }
    if (lastTimestamp === null || t > Date.parse(lastTimestamp)) {
      lastTimestamp = rec.timestamp;
    }
  }

  return {
    callCount: records.length,
    inputTokens,
    outputTokens,
    totalTokens,
    costByCurrency: toCostByCurrency(cost),
    pricedCount,
    unpricedCount,
    skippedLines,
    firstTimestamp,
    lastTimestamp,
  };
}

/** Inclusive date-range filter applied client-side (FR-005). Null bound = open. */
export function filterByRange(
  records: UsageRecord[],
  from: string | null,
  to: string | null,
): UsageRecord[] {
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  return records.filter((r) => {
    const t = Date.parse(r.timestamp);
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });
}

/** The currency carrying the largest cost total — used for single-value shares. */
function dominantCurrency(costs: CostByCurrency): string | null {
  let best: string | null = null;
  let bestVal = new Decimal(-1);
  for (const [cur, val] of Object.entries(costs)) {
    const d = new Decimal(val);
    if (d.greaterThan(bestVal)) {
      bestVal = d;
      best = cur;
    }
  }
  return best;
}

/** The grouping key for a record on a given dimension; agent falls back to "unknown". */
function dimensionKey(rec: UsageRecord, dimension: BreakdownDimension): string {
  if (dimension === "agent") return rec.agent ?? UNKNOWN_AGENT;
  return rec[dimension];
}

/** Group records by an attribute with per-group totals and share-of-whole (FR-006). */
export function computeBreakdown(
  records: UsageRecord[],
  dimension: BreakdownDimension,
): DimensionBreakdown {
  const overall = computeSummary(records);
  const domCur = dominantCurrency(overall.costByCurrency);
  const overallCost = domCur ? new Decimal(overall.costByCurrency[domCur]) : new Decimal(0);

  const buckets = new Map<
    string,
    { callCount: number; totalTokens: number; cost: Map<string, Decimal> }
  >();

  for (const rec of records) {
    const key = dimensionKey(rec, dimension);
    let b = buckets.get(key);
    if (!b) {
      b = { callCount: 0, totalTokens: 0, cost: new Map() };
      buckets.set(key, b);
    }
    b.callCount++;
    b.totalTokens += rec.total_tokens;
    addCost(b.cost, rec);
  }

  const groups: BreakdownGroup[] = [];
  for (const [key, b] of buckets) {
    const costByCurrency = toCostByCurrency(b.cost);
    const groupCost = domCur && costByCurrency[domCur] ? new Decimal(costByCurrency[domCur]) : new Decimal(0);
    groups.push({
      key,
      callCount: b.callCount,
      totalTokens: b.totalTokens,
      costByCurrency,
      tokenShare: overall.totalTokens > 0 ? b.totalTokens / overall.totalTokens : 0,
      costShare: overallCost.greaterThan(0) ? groupCost.div(overallCost).toNumber() : 0,
    });
  }

  // Highest token usage first.
  groups.sort((a, b) => b.totalTokens - a.totalTokens);
  return { dimension, groups };
}

export type BucketGranularity = "hour" | "day";

/** Pick hour vs day buckets from the time span so the chart stays readable. */
export function chooseBucketGranularity(
  firstTimestamp: string | null,
  lastTimestamp: string | null,
): BucketGranularity {
  if (!firstTimestamp || !lastTimestamp) return "hour";
  const spanMs = Date.parse(lastTimestamp) - Date.parse(firstTimestamp);
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  return spanMs > TWO_DAYS ? "day" : "hour";
}

function bucketKey(iso: string, granularity: BucketGranularity): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (granularity === "day") return `${y}-${m}-${day}`;
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:00`;
}

/** Time-bucketed series for the trend chart, chronologically ordered (FR-005). */
export function computeTrend(
  records: UsageRecord[],
  granularity?: BucketGranularity,
): TrendPoint[] {
  const summary = computeSummary(records);
  const gran =
    granularity ?? chooseBucketGranularity(summary.firstTimestamp, summary.lastTimestamp);

  const buckets = new Map<
    string,
    { cost: Map<string, Decimal>; totalTokens: number; callCount: number }
  >();

  for (const rec of records) {
    const key = bucketKey(rec.timestamp, gran);
    let b = buckets.get(key);
    if (!b) {
      b = { cost: new Map(), totalTokens: 0, callCount: 0 };
      buckets.set(key, b);
    }
    b.totalTokens += rec.total_tokens;
    b.callCount++;
    addCost(b.cost, rec);
  }

  const domCur = dominantCurrency(summary.costByCurrency);
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, b]) => {
      const costByCurrency = toCostByCurrency(b.cost);
      const cost = domCur && costByCurrency[domCur] ? costByCurrency[domCur] : "0";
      return { bucket, cost, totalTokens: b.totalTokens, callCount: b.callCount };
    });
}
