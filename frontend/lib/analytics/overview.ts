import Decimal from "decimal.js";
import { isPriced, type ObservationEvent } from "../observation/event";

/**
 * Overview analytics (US1) — executive KPIs + cost analytics, computed purely over
 * ObservationEvent[]. Framework-agnostic and offline-testable (Constitution IV).
 *
 * Money rule (SC-001, Constitution V): cost is summed with decimal.js from the
 * original strings, NEVER floats, so totals reconcile to the raw events exactly.
 * Only priced events contribute to cost; unpriced events still count tokens/calls.
 *
 * Honesty rule (constraint, refines FR-029): the summary distinguishes events we
 * counted but could not attribute (`unattributedCalls`) from absence of data — the
 * dashboard never folds "missing attribution" into a named entity or hides it.
 */

export type CostByCurrency = Record<string, string>;

export interface OverviewSummary {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costByCurrency: CostByCurrency;
  pricedCount: number;
  unpricedCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  failureRate: number;
  attributedCalls: number;
  unattributedCalls: number;
  // Distinct-entity counts for the KPI strip.
  promptCount: number;
  agentCount: number;
  workflowCount: number;
  modelCount: number;
  providerCount: number;
  sessionCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface CostGroup {
  key: string;
  callCount: number;
  totalTokens: number;
  cost: string; // dominant-currency decimal string
  costByCurrency: CostByCurrency;
  costShare: number;
  tokenShare: number;
}

export interface TrendPoint {
  bucket: string;
  cost: string;
  totalTokens: number;
  callCount: number;
}

export interface Overview {
  summary: OverviewSummary;
  costByDay: TrendPoint[];
  byModel: CostGroup[];
  byProvider: CostGroup[];
}

function addCost(acc: Map<string, Decimal>, e: ObservationEvent): void {
  if (!isPriced(e)) return;
  const prev = acc.get(e.currency) ?? new Decimal(0);
  acc.set(e.currency, prev.plus(new Decimal(e.cost)));
}

function toCostByCurrency(acc: Map<string, Decimal>): CostByCurrency {
  const out: CostByCurrency = {};
  for (const [cur, val] of acc) out[cur] = val.toString();
  return out;
}

/** The currency carrying the largest cost total — used for single-value shares. */
export function dominantCurrency(costs: CostByCurrency): string | null {
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

/** Inclusive date-range filter (FR-012). Null bound = open. */
export function filterByRange(
  events: ObservationEvent[],
  from: string | null,
  to: string | null,
): ObservationEvent[] {
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  return events.filter((e) => {
    const t = Date.parse(e.timestamp);
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });
}

export function computeSummary(events: ObservationEvent[]): OverviewSummary {
  const cost = new Map<string, Decimal>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let attributedCalls = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  const prompts = new Set<string>();
  const agents = new Set<string>();
  const workflows = new Set<string>();
  const models = new Set<string>();
  const providers = new Set<string>();
  const sessions = new Set<string>();

  for (const e of events) {
    inputTokens += e.input_tokens;
    outputTokens += e.output_tokens;
    totalTokens += e.total_tokens;
    if (isPriced(e)) pricedCount++;
    else unpricedCount++;
    if (e.status === "error") failureCount++;
    else successCount++;
    if (e.attribution_status === "complete") attributedCalls++;
    addCost(cost, e);

    if (e.attribution_status === "complete") prompts.add(e.prompt);
    if (e.attribution_status === "complete") agents.add(e.agent);
    if (e.workflow_id) workflows.add(e.workflow_id);
    models.add(e.model);
    providers.add(e.provider);
    if (e.session_id && e.session_id !== "unknown") sessions.add(e.session_id);

    const t = Date.parse(e.timestamp);
    if (firstTimestamp === null || t < Date.parse(firstTimestamp)) firstTimestamp = e.timestamp;
    if (lastTimestamp === null || t > Date.parse(lastTimestamp)) lastTimestamp = e.timestamp;
  }

  const callCount = events.length;
  return {
    callCount,
    inputTokens,
    outputTokens,
    totalTokens,
    costByCurrency: toCostByCurrency(cost),
    pricedCount,
    unpricedCount,
    successCount,
    failureCount,
    successRate: callCount > 0 ? successCount / callCount : 0,
    failureRate: callCount > 0 ? failureCount / callCount : 0,
    attributedCalls,
    unattributedCalls: callCount - attributedCalls,
    promptCount: prompts.size,
    agentCount: agents.size,
    workflowCount: workflows.size,
    modelCount: models.size,
    providerCount: providers.size,
    sessionCount: sessions.size,
    firstTimestamp,
    lastTimestamp,
  };
}

/** Group cost/tokens/calls by an event field, with share-of-whole. */
export function computeCostGroups(
  events: ObservationEvent[],
  keyOf: (e: ObservationEvent) => string,
): CostGroup[] {
  const overall = computeSummary(events);
  const domCur = dominantCurrency(overall.costByCurrency);
  const overallCost = domCur ? new Decimal(overall.costByCurrency[domCur]) : new Decimal(0);

  const buckets = new Map<
    string,
    { callCount: number; totalTokens: number; cost: Map<string, Decimal> }
  >();

  for (const e of events) {
    const key = keyOf(e);
    let b = buckets.get(key);
    if (!b) {
      b = { callCount: 0, totalTokens: 0, cost: new Map() };
      buckets.set(key, b);
    }
    b.callCount++;
    b.totalTokens += e.total_tokens;
    addCost(b.cost, e);
  }

  const groups: CostGroup[] = [];
  for (const [key, b] of buckets) {
    const costByCurrency = toCostByCurrency(b.cost);
    const groupCost = domCur && costByCurrency[domCur] ? new Decimal(costByCurrency[domCur]) : new Decimal(0);
    groups.push({
      key,
      callCount: b.callCount,
      totalTokens: b.totalTokens,
      cost: groupCost.toString(),
      costByCurrency,
      costShare: overallCost.greaterThan(0) ? groupCost.div(overallCost).toNumber() : 0,
      tokenShare: overall.totalTokens > 0 ? b.totalTokens / overall.totalTokens : 0,
    });
  }
  // Highest cost first, then tokens as a tie-break.
  groups.sort((a, b) => {
    const d = new Decimal(b.cost).minus(new Decimal(a.cost));
    if (!d.isZero()) return d.greaterThan(0) ? 1 : -1;
    return b.totalTokens - a.totalTokens;
  });
  return groups;
}

export function dayBucket(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Cost/tokens/calls per UTC day, chronologically ordered. */
export function computeCostByDay(events: ObservationEvent[]): TrendPoint[] {
  const domCur = dominantCurrency(computeSummary(events).costByCurrency);
  const buckets = new Map<string, { cost: Map<string, Decimal>; totalTokens: number; callCount: number }>();

  for (const e of events) {
    const key = dayBucket(e.timestamp);
    let b = buckets.get(key);
    if (!b) {
      b = { cost: new Map(), totalTokens: 0, callCount: 0 };
      buckets.set(key, b);
    }
    b.totalTokens += e.total_tokens;
    b.callCount++;
    addCost(b.cost, e);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, b]) => {
      const costByCurrency = toCostByCurrency(b.cost);
      const cost = domCur && costByCurrency[domCur] ? costByCurrency[domCur] : "0";
      return { bucket, cost, totalTokens: b.totalTokens, callCount: b.callCount };
    });
}

/** The full overview view model consumed by the API/dashboard. */
export function computeOverview(events: ObservationEvent[]): Overview {
  return {
    summary: computeSummary(events),
    costByDay: computeCostByDay(events),
    byModel: computeCostGroups(events, (e) => e.model),
    byProvider: computeCostGroups(events, (e) => e.provider),
  };
}
