import Decimal from "decimal.js";
import { isPriced, UNATTRIBUTED, type ObservationEvent } from "../observation/event";
import {
  computeCostByDay,
  dominantCurrency,
  type CostByCurrency,
  type TrendPoint,
} from "./overview";

/**
 * Prompt analytics / PromptOps (US2). Pure, decimal-precise, offline-testable.
 *
 * Every event belongs to exactly one prompt group: its `prompt` when
 * attribution_status === "complete", otherwise the explicit `unattributed` bucket.
 * Because the groups partition ALL events, the reconciliation identities hold by
 * construction and are asserted as tests (constraint #5):
 *   Σ prompt cost   + unattributed cost   == global cost
 *   Σ prompt tokens + unattributed tokens == global tokens
 */

const UNVERSIONED = "unversioned";

export interface PromptStats {
  key: string; // prompt name, or UNATTRIBUTED
  attributed: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costByCurrency: CostByCurrency;
  cost: string; // dominant-currency decimal string
  avgLatencyMs: number;
  outputInputRatio: number; // output / input (higher = more generative)
  inputOutputRatio: number; // input / output (higher = heavier prompt vs. output)
  avgTokensPerCall: number;
  costShare: number;
  tokenShare: number;
  promptHashes: string[];
  versions: string[];
  agents: string[];
  models: string[];
  providers: string[];
  environments: string[];
  // Future-ready PromptOps fields (reserved for historical analysis):
  firstSeen: string | null;
  lastSeen: string | null;
  dominantModel: string | null;
  dominantProvider: string | null;
  averageCostPerCall: string; // dominant-currency decimal string
  averageTokensPerCall: number; // alias of avgTokensPerCall, explicit for the contract
  attributionCompleteness: number; // 0..1, share of the group's events that are "complete"
}

export interface PromptLeaderboard {
  prompts: PromptStats[]; // attributed prompts, ranked by cost desc
  unattributed: PromptStats | null;
  globalCost: CostByCurrency;
  globalTokens: number;
  globalCalls: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Key with the highest call count in a counter map (null for empty). */
function dominantKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

function buildStats(key: string, attributed: boolean, events: ObservationEvent[]): PromptStats {
  const cost = new Map<string, Decimal>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let latencySum = 0;
  let completeCount = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  const promptHashes = new Set<string>();
  const versions = new Set<string>();
  const agents = new Set<string>();
  const models = new Set<string>();
  const providers = new Set<string>();
  const environments = new Set<string>();
  const modelCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();

  for (const e of events) {
    inputTokens += e.input_tokens;
    outputTokens += e.output_tokens;
    totalTokens += e.total_tokens;
    latencySum += e.latency_ms;
    if (e.attribution_status === "complete") completeCount++;
    if (isPriced(e)) {
      const prev = cost.get(e.currency) ?? new Decimal(0);
      cost.set(e.currency, prev.plus(new Decimal(e.cost)));
    }
    if (e.prompt_hash) promptHashes.add(e.prompt_hash);
    versions.add(e.prompt_version ?? UNVERSIONED);
    agents.add(e.agent);
    models.add(e.model);
    providers.add(e.provider);
    modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + 1);
    providerCounts.set(e.provider, (providerCounts.get(e.provider) ?? 0) + 1);
    if (e.environment) environments.add(e.environment);
    const t = Date.parse(e.timestamp);
    if (firstSeen === null || t < Date.parse(firstSeen)) firstSeen = e.timestamp;
    if (lastSeen === null || t > Date.parse(lastSeen)) lastSeen = e.timestamp;
  }

  const costByCurrency: CostByCurrency = {};
  for (const [cur, val] of cost) costByCurrency[cur] = val.toString();
  const domCur = dominantCurrency(costByCurrency);
  const domCost = domCur && costByCurrency[domCur] ? new Decimal(costByCurrency[domCur]) : new Decimal(0);
  const calls = events.length;
  const avgTokensPerCall = calls > 0 ? totalTokens / calls : 0;

  return {
    key,
    attributed,
    calls,
    inputTokens,
    outputTokens,
    totalTokens,
    costByCurrency,
    cost: domCost.toString(),
    avgLatencyMs: calls > 0 ? latencySum / calls : 0,
    outputInputRatio: ratio(outputTokens, inputTokens),
    inputOutputRatio: ratio(inputTokens, outputTokens),
    avgTokensPerCall,
    costShare: 0, // filled in by computeLeaderboard against the global total
    tokenShare: 0,
    promptHashes: [...promptHashes],
    versions: [...versions],
    agents: [...agents],
    models: [...models],
    providers: [...providers],
    environments: [...environments],
    firstSeen,
    lastSeen,
    dominantModel: dominantKey(modelCounts),
    dominantProvider: dominantKey(providerCounts),
    averageCostPerCall: calls > 0 ? domCost.div(calls).toString() : "0",
    averageTokensPerCall: avgTokensPerCall,
    attributionCompleteness: calls > 0 ? completeCount / calls : 0,
  };
}

/** Group key for an event: its prompt when fully attributed, else "unattributed". */
function promptKey(e: ObservationEvent): string {
  return e.attribution_status === "complete" ? e.prompt : UNATTRIBUTED;
}

export function computePromptLeaderboard(events: ObservationEvent[]): PromptLeaderboard {
  const groups = new Map<string, ObservationEvent[]>();
  for (const e of events) {
    const key = promptKey(e);
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  // Global totals for share calculations (priced cost only; all tokens).
  const globalCostMap = new Map<string, Decimal>();
  let globalTokens = 0;
  for (const e of events) {
    globalTokens += e.total_tokens;
    if (isPriced(e)) {
      const prev = globalCostMap.get(e.currency) ?? new Decimal(0);
      globalCostMap.set(e.currency, prev.plus(new Decimal(e.cost)));
    }
  }
  const globalCost: CostByCurrency = {};
  for (const [cur, val] of globalCostMap) globalCost[cur] = val.toString();
  const domCur = dominantCurrency(globalCost);
  const globalDom = domCur ? new Decimal(globalCost[domCur]) : new Decimal(0);

  const withShares = (s: PromptStats): PromptStats => ({
    ...s,
    costShare: globalDom.greaterThan(0)
      ? new Decimal(s.cost).div(globalDom).toNumber()
      : 0,
    tokenShare: globalTokens > 0 ? s.totalTokens / globalTokens : 0,
  });

  const prompts: PromptStats[] = [];
  let unattributed: PromptStats | null = null;
  for (const [key, evs] of groups) {
    if (key === UNATTRIBUTED) {
      unattributed = withShares(buildStats(key, false, evs));
    } else {
      prompts.push(withShares(buildStats(key, true, evs)));
    }
  }

  prompts.sort((a, b) => {
    const d = new Decimal(b.cost).minus(new Decimal(a.cost));
    if (!d.isZero()) return d.greaterThan(0) ? 1 : -1;
    return b.totalTokens - a.totalTokens;
  });

  return { prompts, unattributed, globalCost, globalTokens, globalCalls: events.length };
}

// --- Prompt detail -----------------------------------------------------------

export interface PromptExecutionRow {
  event_id: string;
  timestamp: string;
  model: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: string;
  latencyMs: number;
  status: string;
  promptVersion: string | null;
  attributionStatus: string;
}

export interface PromptVersionStats {
  version: string;
  promptHashes: string[];
  calls: number;
  totalTokens: number;
  cost: string;
  avgLatencyMs: number;
  outputInputRatio: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface PromptDetail {
  stats: PromptStats;
  recentExecutions: PromptExecutionRow[];
  trend: TrendPoint[]; // carries both cost and totalTokens per day
  versions: PromptVersionStats[];
  attribution: { complete: number; partial: number; missing: number };
}

function eventsForPrompt(events: ObservationEvent[], key: string): ObservationEvent[] {
  return events.filter((e) => promptKey(e) === key);
}

/** Per-version stats for a prompt, enabling regression comparison (FR-017). */
export function computePromptVersions(events: ObservationEvent[], key: string): PromptVersionStats[] {
  const byVersion = new Map<string, ObservationEvent[]>();
  for (const e of eventsForPrompt(events, key)) {
    const v = e.prompt_version ?? UNVERSIONED;
    const arr = byVersion.get(v) ?? [];
    arr.push(e);
    byVersion.set(v, arr);
  }
  const out: PromptVersionStats[] = [];
  for (const [version, evs] of byVersion) {
    const s = buildStats(version, true, evs);
    const times = evs.map((e) => e.timestamp).sort();
    out.push({
      version,
      promptHashes: s.promptHashes,
      calls: s.calls,
      totalTokens: s.totalTokens,
      cost: s.cost,
      avgLatencyMs: s.avgLatencyMs,
      outputInputRatio: s.outputInputRatio,
      firstSeen: times[0] ?? null,
      lastSeen: times[times.length - 1] ?? null,
    });
  }
  // Stable order: by version label.
  out.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return out;
}

export function computePromptDetail(
  events: ObservationEvent[],
  key: string,
  recentLimit = 25,
): PromptDetail {
  const scoped = eventsForPrompt(events, key);
  const stats = computePromptLeaderboard(events);
  const matched =
    key === UNATTRIBUTED ? stats.unattributed : stats.prompts.find((p) => p.key === key);

  const attribution = { complete: 0, partial: 0, missing: 0 };
  for (const e of scoped) attribution[e.attribution_status]++;

  const recentExecutions: PromptExecutionRow[] = [...scoped]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, recentLimit)
    .map((e) => ({
      event_id: e.event_id,
      timestamp: e.timestamp,
      model: e.model,
      agent: e.agent,
      inputTokens: e.input_tokens,
      outputTokens: e.output_tokens,
      totalTokens: e.total_tokens,
      cost: e.cost,
      latencyMs: e.latency_ms,
      status: e.status,
      promptVersion: e.prompt_version,
      attributionStatus: e.attribution_status,
    }));

  return {
    stats:
      matched ??
      buildStats(key, key !== UNATTRIBUTED, scoped), // fallback for an empty/unknown key
    recentExecutions,
    trend: computeCostByDay(scoped),
    versions: computePromptVersions(events, key),
    attribution,
  };
}

// --- Prompt recommendations (foundation) -------------------------------------

export type PromptFlagType = "expensive" | "high-input-output-ratio" | "high-token-usage";

export interface PromptFlag {
  type: PromptFlagType;
  prompt: string;
  detail: string;
  value: number;
  threshold: number;
}

/** Median of a numeric list (0 for empty). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Deterministic, explainable recommendation flags over the leaderboard (US2 §5,
 * foundation only). Thresholds are relative to the prompt population so they adapt
 * to scale; each flag is reproducible from the events and names its threshold.
 */
export const INPUT_OUTPUT_RATIO_THRESHOLD = 10; // input >= 10x output is heavy/inefficient

export function computePromptFlags(leaderboard: PromptLeaderboard): PromptFlag[] {
  const { prompts } = leaderboard;
  if (prompts.length === 0) return [];

  const costMedian = median(prompts.map((p) => Number(p.cost)));
  const tokenMedian = median(prompts.map((p) => p.avgTokensPerCall));
  const costThreshold = costMedian * 2;
  const tokenThreshold = tokenMedian * 2;

  const flags: PromptFlag[] = [];
  for (const p of prompts) {
    if (costThreshold > 0 && Number(p.cost) > costThreshold) {
      flags.push({
        type: "expensive",
        prompt: p.key,
        detail: `Cost ${p.cost} exceeds 2× median prompt cost`,
        value: Number(p.cost),
        threshold: costThreshold,
      });
    }
    if (p.inputOutputRatio >= INPUT_OUTPUT_RATIO_THRESHOLD) {
      flags.push({
        type: "high-input-output-ratio",
        prompt: p.key,
        detail: `Input/output ratio ${p.inputOutputRatio.toFixed(1)} is high — consider trimming the prompt`,
        value: p.inputOutputRatio,
        threshold: INPUT_OUTPUT_RATIO_THRESHOLD,
      });
    }
    if (tokenThreshold > 0 && p.avgTokensPerCall > tokenThreshold) {
      flags.push({
        type: "high-token-usage",
        prompt: p.key,
        detail: `Avg ${Math.round(p.avgTokensPerCall)} tokens/call exceeds 2× median`,
        value: p.avgTokensPerCall,
        threshold: tokenThreshold,
      });
    }
  }
  return flags;
}
