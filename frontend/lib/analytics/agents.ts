import Decimal from "decimal.js";
import { isPriced, UNATTRIBUTED, UNKNOWN, type ObservationEvent } from "../observation/event";
import {
  computeCostByDay,
  dominantCurrency,
  type CostByCurrency,
  type TrendPoint,
} from "./overview";

/**
 * Agent analytics / AgentOps (US3). Pure, decimal-precise, replayable.
 *
 * The execution hierarchy is derived ENTIRELY from ObservationEvent relationships —
 * `parent_agent` (agent → sub-agent) and `tool_name` (agent → tool) — never from
 * UI-only structures. Events without agent attribution fall into an explicit
 * "unattributed" bucket (same pattern as prompts).
 *
 * Reconciliation identities (asserted as tests, constraint #5):
 *   Σ root-agent rolled cost   + unattributed == global cost
 *   Σ root-agent rolled tokens + unattributed == global tokens
 *   per agent: rolled cost == own cost + Σ(child rolled cost)
 */

export interface AgentToolUsage {
  name: string;
  invocations: number;
}

export interface AgentStats {
  key: string;
  attributed: boolean;
  // own metrics (events directly produced by this agent)
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costByCurrency: CostByCurrency;
  cost: string; // own dominant-currency cost
  avgLatencyMs: number;
  errorCount: number;
  failureRate: number;
  toolInvocations: number;
  tools: AgentToolUsage[];
  models: string[];
  providers: string[];
  // hierarchy (from parent_agent edges)
  parent: string | null;
  children: string[];
  childAgentCount: number;
  depth: number;
  // rolled-up (own + all descendants)
  rolledCostByCurrency: CostByCurrency;
  rolledCost: string;
  rolledTotalTokens: number;
  rolledCalls: number;
  // shares (rolled vs global)
  costShare: number;
  tokenShare: number;
  // future-ready
  firstSeen: string | null;
  lastSeen: string | null;
  averageCostPerCall: string;
  averageTokensPerCall: number;
  attributionCompleteness: number;
}

export type AgentTreeNodeType = "agent" | "tool";

export interface AgentTreeNode {
  key: string;
  type: AgentTreeNodeType;
  cost: string; // agent: rolled cost; tool: own cost of tool events (informational)
  totalTokens: number;
  calls: number; // agent: rolled calls; tool: invocations
  failureRate?: number;
  depth: number;
  children: AgentTreeNode[];
}

export interface AgentLeaderboard {
  agents: AgentStats[]; // attributed, ranked by rolled cost desc
  unattributed: AgentStats | null;
  roots: string[];
  tree: AgentTreeNode[];
  maxDepth: number;
  globalCost: CostByCurrency;
  globalTokens: number;
  globalCalls: number;
}

function isAgentAttributed(e: ObservationEvent): boolean {
  return e.agent.length > 0 && e.agent !== UNKNOWN;
}

function agentKey(e: ObservationEvent): string {
  return isAgentAttributed(e) ? e.agent : UNATTRIBUTED;
}

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

function addCostMap(into: Map<string, Decimal>, from: CostByCurrency): void {
  for (const [cur, val] of Object.entries(from)) {
    into.set(cur, (into.get(cur) ?? new Decimal(0)).plus(new Decimal(val)));
  }
}

function mapToCost(acc: Map<string, Decimal>): CostByCurrency {
  const out: CostByCurrency = {};
  for (const [cur, val] of acc) out[cur] = val.toString();
  return out;
}

function domString(costs: CostByCurrency): string {
  const cur = dominantCurrency(costs);
  return cur && costs[cur] ? costs[cur] : "0";
}

/** Build own (direct) stats for one agent group — hierarchy filled in later. */
function buildOwnStats(key: string, attributed: boolean, events: ObservationEvent[]): AgentStats {
  const cost = new Map<string, Decimal>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let latencySum = 0;
  let errorCount = 0;
  let completeCount = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;
  const models = new Set<string>();
  const providers = new Set<string>();
  const toolCounts = new Map<string, number>();

  for (const e of events) {
    inputTokens += e.input_tokens;
    outputTokens += e.output_tokens;
    totalTokens += e.total_tokens;
    latencySum += e.latency_ms;
    if (e.status === "error") errorCount++;
    if (e.attribution_status === "complete") completeCount++;
    if (isPriced(e)) {
      cost.set(e.currency, (cost.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
    }
    models.add(e.model);
    providers.add(e.provider);
    if (e.tool_name) toolCounts.set(e.tool_name, (toolCounts.get(e.tool_name) ?? 0) + 1);
    const t = Date.parse(e.timestamp);
    if (firstSeen === null || t < Date.parse(firstSeen)) firstSeen = e.timestamp;
    if (lastSeen === null || t > Date.parse(lastSeen)) lastSeen = e.timestamp;
  }

  const costByCurrency = mapToCost(cost);
  const ownCost = new Decimal(domString(costByCurrency));
  const calls = events.length;
  const tools = [...toolCounts.entries()].map(([name, invocations]) => ({ name, invocations }));
  const toolInvocations = tools.reduce((a, t) => a + t.invocations, 0);

  return {
    key,
    attributed,
    calls,
    inputTokens,
    outputTokens,
    totalTokens,
    costByCurrency,
    cost: ownCost.toString(),
    avgLatencyMs: calls > 0 ? latencySum / calls : 0,
    errorCount,
    failureRate: calls > 0 ? errorCount / calls : 0,
    toolInvocations,
    tools,
    models: [...models],
    providers: [...providers],
    parent: null,
    children: [],
    childAgentCount: 0,
    depth: 0,
    rolledCostByCurrency: { ...costByCurrency },
    rolledCost: ownCost.toString(),
    rolledTotalTokens: totalTokens,
    rolledCalls: calls,
    costShare: 0,
    tokenShare: 0,
    firstSeen,
    lastSeen,
    averageCostPerCall: calls > 0 ? ownCost.div(calls).toString() : "0",
    averageTokensPerCall: calls > 0 ? totalTokens / calls : 0,
    attributionCompleteness: calls > 0 ? completeCount / calls : 0,
  };
}

/** Dominant non-null parent_agent among an agent's events (null → root). */
function resolveParent(events: ObservationEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.parent_agent && e.parent_agent !== UNKNOWN) {
      counts.set(e.parent_agent, (counts.get(e.parent_agent) ?? 0) + 1);
    }
  }
  return dominantKey(counts);
}

export function computeAgentLeaderboard(events: ObservationEvent[]): AgentLeaderboard {
  // 1. Group events by agent (own).
  const groups = new Map<string, ObservationEvent[]>();
  for (const e of events) {
    const key = agentKey(e);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  // 2. Own stats + parent resolution for attributed agents.
  const stats = new Map<string, AgentStats>();
  let unattributed: AgentStats | null = null;
  for (const [key, evs] of groups) {
    if (key === UNATTRIBUTED) {
      unattributed = buildOwnStats(key, false, evs);
    } else {
      const s = buildOwnStats(key, true, evs);
      s.parent = resolveParent(evs);
      stats.set(key, s);
    }
  }

  // 3. Wire children; a parent not in the set is treated as null (root).
  for (const s of stats.values()) {
    if (s.parent && stats.has(s.parent)) {
      stats.get(s.parent)!.children.push(s.key);
    } else {
      s.parent = null;
    }
  }
  for (const s of stats.values()) {
    s.children.sort();
    s.childAgentCount = s.children.length;
  }

  const roots = [...stats.values()].filter((s) => s.parent === null).map((s) => s.key).sort();

  // 4. Depth (BFS from roots; visited guards against cycles).
  const visited = new Set<string>();
  const queue: Array<{ key: string; depth: number }> = roots.map((k) => ({ key: k, depth: 0 }));
  while (queue.length) {
    const { key, depth } = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const s = stats.get(key)!;
    s.depth = depth;
    for (const c of s.children) if (!visited.has(c)) queue.push({ key: c, depth: depth + 1 });
  }

  // 5. Rolled-up totals: post-order over the forest (memoized, cycle-safe).
  const rolled = new Set<string>();
  const rollUp = (key: string): void => {
    if (rolled.has(key)) return;
    rolled.add(key);
    const s = stats.get(key)!;
    const costAcc = new Map<string, Decimal>();
    addCostMap(costAcc, s.costByCurrency);
    let tokens = s.totalTokens;
    let calls = s.calls;
    for (const c of s.children) {
      rollUp(c);
      const cs = stats.get(c)!;
      addCostMap(costAcc, cs.rolledCostByCurrency);
      tokens += cs.rolledTotalTokens;
      calls += cs.rolledCalls;
    }
    s.rolledCostByCurrency = mapToCost(costAcc);
    s.rolledCost = domString(s.rolledCostByCurrency);
    s.rolledTotalTokens = tokens;
    s.rolledCalls = calls;
  };
  for (const k of roots) rollUp(k);

  // 6. Global totals + shares.
  const globalAcc = new Map<string, Decimal>();
  let globalTokens = 0;
  for (const e of events) {
    globalTokens += e.total_tokens;
    if (isPriced(e)) {
      globalAcc.set(e.currency, (globalAcc.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
    }
  }
  const globalCost = mapToCost(globalAcc);
  const globalDom = new Decimal(domString(globalCost));
  for (const s of stats.values()) {
    s.costShare = globalDom.greaterThan(0) ? new Decimal(s.rolledCost).div(globalDom).toNumber() : 0;
    s.tokenShare = globalTokens > 0 ? s.rolledTotalTokens / globalTokens : 0;
  }

  const agents = [...stats.values()].sort((a, b) => {
    const d = new Decimal(b.rolledCost).minus(new Decimal(a.rolledCost));
    if (!d.isZero()) return d.greaterThan(0) ? 1 : -1;
    return b.rolledTotalTokens - a.rolledTotalTokens;
  });

  const maxDepth = agents.reduce((m, s) => Math.max(m, s.depth), 0);
  const tree = roots.map((k) => buildTreeNode(k, stats, new Set()));

  return {
    agents,
    unattributed,
    roots,
    tree,
    maxDepth,
    globalCost,
    globalTokens,
    globalCalls: events.length,
  };
}

/** Build a tree node for an agent: child agents (recursive) + tool leaves. */
function buildTreeNode(
  key: string,
  stats: Map<string, AgentStats>,
  seen: Set<string>,
): AgentTreeNode {
  const s = stats.get(key)!;
  const childNodes: AgentTreeNode[] = [];
  if (!seen.has(key)) {
    const nextSeen = new Set(seen).add(key);
    for (const c of s.children) {
      if (!nextSeen.has(c)) childNodes.push(buildTreeNode(c, stats, nextSeen));
    }
  }
  // Tool leaves (informational; their cost is part of the agent's own cost, not added to rollup).
  for (const t of s.tools) {
    childNodes.push({
      key: t.name,
      type: "tool",
      cost: "0",
      totalTokens: 0,
      calls: t.invocations,
      depth: s.depth + 1,
      children: [],
    });
  }
  return {
    key,
    type: "agent",
    cost: s.rolledCost,
    totalTokens: s.rolledTotalTokens,
    calls: s.rolledCalls,
    failureRate: s.failureRate,
    depth: s.depth,
    children: childNodes,
  };
}

// --- Agent detail ------------------------------------------------------------

export interface AgentExecutionRow {
  event_id: string;
  timestamp: string;
  model: string;
  toolName: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: string;
  latencyMs: number;
  status: string;
  attributionStatus: string;
}

export interface AgentDetail {
  stats: AgentStats;
  parent: string | null;
  children: string[];
  recentExecutions: AgentExecutionRow[];
  trend: TrendPoint[];
  attribution: { complete: number; partial: number; missing: number };
}

export function computeAgentDetail(
  events: ObservationEvent[],
  key: string,
  recentLimit = 25,
): AgentDetail {
  const lb = computeAgentLeaderboard(events);
  const stats =
    key === UNATTRIBUTED ? lb.unattributed : lb.agents.find((a) => a.key === key);
  const own = events.filter((e) => agentKey(e) === key);

  const attribution = { complete: 0, partial: 0, missing: 0 };
  for (const e of own) attribution[e.attribution_status]++;

  const recentExecutions: AgentExecutionRow[] = [...own]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, recentLimit)
    .map((e) => ({
      event_id: e.event_id,
      timestamp: e.timestamp,
      model: e.model,
      toolName: e.tool_name,
      inputTokens: e.input_tokens,
      outputTokens: e.output_tokens,
      totalTokens: e.total_tokens,
      cost: e.cost,
      latencyMs: e.latency_ms,
      status: e.status,
      attributionStatus: e.attribution_status,
    }));

  return {
    stats: stats ?? buildOwnStats(key, key !== UNATTRIBUTED, own),
    parent: stats?.parent ?? null,
    children: stats?.children ?? [],
    recentExecutions,
    trend: computeCostByDay(own),
    attribution,
  };
}

// --- Agent recommendations (foundation) --------------------------------------

export type AgentFlagType =
  | "expensive"
  | "high-token-usage"
  | "high-failure-rate"
  | "deep-hierarchy"
  | "excessive-fan-out";

export interface AgentFlag {
  type: AgentFlagType;
  agent: string;
  detail: string;
  value: number;
  threshold: number;
}

export const FAILURE_RATE_THRESHOLD = 0.25;
export const DEPTH_THRESHOLD = 3;
export const FAN_OUT_THRESHOLD = 4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeAgentFlags(lb: AgentLeaderboard): AgentFlag[] {
  const { agents } = lb;
  if (agents.length === 0) return [];

  const costMedian = median(agents.map((a) => Number(a.rolledCost)));
  const tokenMedian = median(agents.map((a) => a.averageTokensPerCall));
  const costThreshold = costMedian * 2;
  const tokenThreshold = tokenMedian * 2;

  const flags: AgentFlag[] = [];
  for (const a of agents) {
    if (costThreshold > 0 && Number(a.rolledCost) > costThreshold) {
      flags.push({
        type: "expensive",
        agent: a.key,
        detail: `Rolled cost ${a.rolledCost} exceeds 2× median agent cost`,
        value: Number(a.rolledCost),
        threshold: costThreshold,
      });
    }
    if (tokenThreshold > 0 && a.averageTokensPerCall > tokenThreshold) {
      flags.push({
        type: "high-token-usage",
        agent: a.key,
        detail: `Avg ${Math.round(a.averageTokensPerCall)} tokens/call exceeds 2× median`,
        value: a.averageTokensPerCall,
        threshold: tokenThreshold,
      });
    }
    if (a.calls >= 2 && a.failureRate > FAILURE_RATE_THRESHOLD) {
      flags.push({
        type: "high-failure-rate",
        agent: a.key,
        detail: `Failure rate ${(a.failureRate * 100).toFixed(0)}% exceeds ${FAILURE_RATE_THRESHOLD * 100}%`,
        value: a.failureRate,
        threshold: FAILURE_RATE_THRESHOLD,
      });
    }
    if (a.childAgentCount > FAN_OUT_THRESHOLD) {
      flags.push({
        type: "excessive-fan-out",
        agent: a.key,
        detail: `${a.childAgentCount} direct child agents exceeds ${FAN_OUT_THRESHOLD}`,
        value: a.childAgentCount,
        threshold: FAN_OUT_THRESHOLD,
      });
    }
  }
  // Deep hierarchy is a tree-level flag, attributed to the deepest root.
  if (lb.maxDepth >= DEPTH_THRESHOLD) {
    const deepest = agents.find((a) => a.depth === lb.maxDepth);
    flags.push({
      type: "deep-hierarchy",
      agent: deepest ? rootOf(deepest, lb) : lb.roots[0] ?? "",
      detail: `Execution hierarchy is ${lb.maxDepth} levels deep (≥ ${DEPTH_THRESHOLD})`,
      value: lb.maxDepth,
      threshold: DEPTH_THRESHOLD,
    });
  }
  return flags;
}

/** Walk up to the root agent of a node (for tree-level attribution). */
function rootOf(agent: AgentStats, lb: AgentLeaderboard): string {
  const byKey = new Map(lb.agents.map((a) => [a.key, a]));
  let cur: AgentStats | undefined = agent;
  const seen = new Set<string>();
  while (cur && cur.parent && !seen.has(cur.key)) {
    seen.add(cur.key);
    cur = byKey.get(cur.parent);
  }
  return cur ? cur.key : agent.key;
}
