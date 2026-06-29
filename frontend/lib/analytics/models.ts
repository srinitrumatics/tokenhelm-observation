import Decimal from "decimal.js";
import { isPriced, type ObservationEvent } from "../observation/event";
import { computeCostByDay, dominantCurrency, type CostByCurrency, type TrendPoint } from "./overview";

/**
 * Model & Provider analytics (US5). Pure, decimal-precise, replayable.
 *
 * Every event has a model and a provider, so there is no "unattributed" bucket here:
 *   Σ model cost    == global cost      Σ provider cost   == global cost
 *   Σ model tokens  == global tokens    Σ provider tokens == global tokens
 * These hold by construction and are asserted as tests (constraint #5).
 */

export interface ModelStats {
  key: string;
  calls: number;
  costByCurrency: CostByCurrency;
  cost: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageCostPerCall: string;
  avgLatencyMs: number;
  successRate: number;
  failureRate: number;
  costShare: number;
  tokenShare: number;
  providers: string[];
}

export interface ProviderStats {
  key: string;
  calls: number;
  costByCurrency: CostByCurrency;
  cost: string;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  failureRate: number;
  costShare: number;
  tokenShare: number;
  models: string[];
}

interface Accum {
  cost: Map<string, Decimal>;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencySum: number;
  errors: number;
  related: Set<string>;
}

function newAccum(): Accum {
  return {
    cost: new Map(),
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencySum: 0,
    errors: 0,
    related: new Set(),
  };
}

function accumulate(a: Accum, e: ObservationEvent, related: string): void {
  a.calls++;
  a.inputTokens += e.input_tokens;
  a.outputTokens += e.output_tokens;
  a.totalTokens += e.total_tokens;
  a.latencySum += e.latency_ms;
  if (e.status === "error") a.errors++;
  if (isPriced(e)) a.cost.set(e.currency, (a.cost.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
  a.related.add(related);
}

function costMap(a: Accum): { costByCurrency: CostByCurrency; dom: Decimal } {
  const costByCurrency: CostByCurrency = {};
  for (const [cur, val] of a.cost) costByCurrency[cur] = val.toString();
  const cur = dominantCurrency(costByCurrency);
  return { costByCurrency, dom: cur ? new Decimal(costByCurrency[cur]) : new Decimal(0) };
}

export interface ModelAnalytics {
  models: ModelStats[];
  providers: ProviderStats[];
  globalCost: CostByCurrency;
  globalTokens: number;
  globalCalls: number;
}

export function computeModelAnalytics(events: ObservationEvent[]): ModelAnalytics {
  const models = new Map<string, Accum>();
  const providers = new Map<string, Accum>();
  const globalAcc = new Map<string, Decimal>();
  let globalTokens = 0;

  for (const e of events) {
    globalTokens += e.total_tokens;
    if (isPriced(e)) globalAcc.set(e.currency, (globalAcc.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
    accumulate(models.get(e.model) ?? models.set(e.model, newAccum()).get(e.model)!, e, e.provider);
    accumulate(providers.get(e.provider) ?? providers.set(e.provider, newAccum()).get(e.provider)!, e, e.model);
  }

  const globalCost: CostByCurrency = {};
  for (const [cur, val] of globalAcc) globalCost[cur] = val.toString();
  const globalDom = new Decimal(globalCost[dominantCurrency(globalCost) ?? ""] ?? "0");

  const modelStats: ModelStats[] = [...models.entries()].map(([key, a]) => {
    const { costByCurrency, dom } = costMap(a);
    return {
      key,
      calls: a.calls,
      costByCurrency,
      cost: dom.toString(),
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      totalTokens: a.totalTokens,
      averageCostPerCall: a.calls > 0 ? dom.div(a.calls).toString() : "0",
      avgLatencyMs: a.calls > 0 ? a.latencySum / a.calls : 0,
      successRate: a.calls > 0 ? (a.calls - a.errors) / a.calls : 0,
      failureRate: a.calls > 0 ? a.errors / a.calls : 0,
      costShare: globalDom.greaterThan(0) ? dom.div(globalDom).toNumber() : 0,
      tokenShare: globalTokens > 0 ? a.totalTokens / globalTokens : 0,
      providers: [...a.related],
    };
  });

  const providerStats: ProviderStats[] = [...providers.entries()].map(([key, a]) => {
    const { costByCurrency, dom } = costMap(a);
    return {
      key,
      calls: a.calls,
      costByCurrency,
      cost: dom.toString(),
      totalTokens: a.totalTokens,
      avgLatencyMs: a.calls > 0 ? a.latencySum / a.calls : 0,
      successRate: a.calls > 0 ? (a.calls - a.errors) / a.calls : 0,
      failureRate: a.calls > 0 ? a.errors / a.calls : 0,
      costShare: globalDom.greaterThan(0) ? dom.div(globalDom).toNumber() : 0,
      tokenShare: globalTokens > 0 ? a.totalTokens / globalTokens : 0,
      models: [...a.related],
    };
  });

  const byCost = <T extends { cost: string; totalTokens: number }>(a: T, b: T) => {
    const d = new Decimal(b.cost).minus(new Decimal(a.cost));
    return !d.isZero() ? (d.greaterThan(0) ? 1 : -1) : b.totalTokens - a.totalTokens;
  };
  modelStats.sort(byCost);
  providerStats.sort(byCost);

  return { models: modelStats, providers: providerStats, globalCost, globalTokens, globalCalls: events.length };
}

/** Cost / usage / token trend for a single model (or provider) over time. */
export function computeModelTrend(
  events: ObservationEvent[],
  opts: { model?: string; provider?: string },
): TrendPoint[] {
  const scoped = events.filter(
    (e) => (opts.model ? e.model === opts.model : true) && (opts.provider ? e.provider === opts.provider : true),
  );
  return computeCostByDay(scoped);
}
