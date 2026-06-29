import Decimal from "decimal.js";
import { isPriced, UNATTRIBUTED, UNKNOWN, type ObservationEvent } from "../observation/event";
import { computeCostByDay, dominantCurrency, type CostByCurrency, type TrendPoint } from "./overview";
import { computeAgentLeaderboard, type AgentTreeNode } from "./agents";
import { reconstructTrace, type TraceStep } from "./sessions";

/**
 * Workflow analytics (US5). Built ENTIRELY on the existing session/span + agent-tree
 * models — no new execution concepts. A workflow groups events by `workflow_id`; an
 * "execution" is a distinct session within that workflow (forward-compatible with a
 * future emitter that reuses a workflow id across runs).
 *
 * Reconciliation identities (asserted as tests, constraint #5):
 *   Σ workflow cost   + unattributed == global cost
 *   Σ workflow tokens + unattributed == global tokens
 *   workflow total == Σ its constituent events
 */

function workflowKey(e: ObservationEvent): string {
  return e.workflow_id && e.workflow_id !== UNKNOWN ? e.workflow_id : UNATTRIBUTED;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v !== UNKNOWN))];
}

export interface WorkflowStats {
  key: string;
  attributed: boolean;
  executions: number;
  totalCostByCurrency: CostByCurrency;
  totalCost: string;
  totalTokens: number;
  totalCalls: number;
  avgDurationMs: number;
  successRate: number;
  failureRate: number;
  avgAgents: number;
  avgPrompts: number;
  avgToolCalls: number;
  costShare: number;
  tokenShare: number;
  agents: string[];
  prompts: string[];
  tools: string[];
  models: string[];
  providers: string[];
}

interface ExecutionMetrics {
  sessionId: string;
  start: string;
  durationMs: number;
  agents: number;
  prompts: number;
  toolCalls: number;
}

/** Per-execution (per-session) metrics within a workflow group. */
function executionsOf(events: ObservationEvent[]): ExecutionMetrics[] {
  const bySession = new Map<string, ObservationEvent[]>();
  for (const e of events) {
    const k = e.session_id && e.session_id !== UNKNOWN ? e.session_id : `${UNATTRIBUTED}:${e.event_id}`;
    (bySession.get(k) ?? bySession.set(k, []).get(k)!).push(e);
  }
  const out: ExecutionMetrics[] = [];
  for (const [sessionId, evs] of bySession) {
    const times = evs.map((e) => Date.parse(e.timestamp));
    const start = Math.min(...times);
    out.push({
      sessionId,
      start: new Date(start).toISOString(),
      durationMs: Math.max(...times) - start,
      agents: uniq(evs.map((e) => (e.agent !== UNKNOWN ? e.agent : null))).length,
      prompts: uniq(evs.map((e) => (e.attribution_status === "complete" ? e.prompt : null))).length,
      toolCalls: evs.filter((e) => e.tool_name).length,
    });
  }
  return out;
}

function buildWorkflowStats(key: string, attributed: boolean, events: ObservationEvent[]): WorkflowStats {
  const cost = new Map<string, Decimal>();
  let totalTokens = 0;
  let errorCount = 0;
  for (const e of events) {
    totalTokens += e.total_tokens;
    if (e.status === "error") errorCount++;
    if (isPriced(e)) cost.set(e.currency, (cost.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
  }
  const totalCostByCurrency: CostByCurrency = {};
  for (const [cur, val] of cost) totalCostByCurrency[cur] = val.toString();
  const domCur = dominantCurrency(totalCostByCurrency);

  const execs = executionsOf(events);
  const n = execs.length || 1;
  const mean = (sel: (m: ExecutionMetrics) => number) => execs.reduce((a, m) => a + sel(m), 0) / n;
  const calls = events.length;

  return {
    key,
    attributed,
    executions: execs.length,
    totalCostByCurrency,
    totalCost: domCur && totalCostByCurrency[domCur] ? totalCostByCurrency[domCur] : "0",
    totalTokens,
    totalCalls: calls,
    avgDurationMs: mean((m) => m.durationMs),
    successRate: calls > 0 ? (calls - errorCount) / calls : 0,
    failureRate: calls > 0 ? errorCount / calls : 0,
    avgAgents: mean((m) => m.agents),
    avgPrompts: mean((m) => m.prompts),
    avgToolCalls: mean((m) => m.toolCalls),
    costShare: 0,
    tokenShare: 0,
    agents: uniq(events.map((e) => (e.agent !== UNKNOWN ? e.agent : null))),
    prompts: uniq(events.map((e) => (e.attribution_status === "complete" ? e.prompt : null))),
    tools: uniq(events.map((e) => e.tool_name)),
    models: uniq(events.map((e) => e.model)),
    providers: uniq(events.map((e) => e.provider)),
  };
}

export interface WorkflowLeaderboard {
  workflows: WorkflowStats[];
  unattributed: WorkflowStats | null;
  globalCost: CostByCurrency;
  globalTokens: number;
  globalCalls: number;
}

export function computeWorkflowLeaderboard(events: ObservationEvent[]): WorkflowLeaderboard {
  const groups = new Map<string, ObservationEvent[]>();
  for (const e of events) {
    const k = workflowKey(e);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }

  const globalAcc = new Map<string, Decimal>();
  let globalTokens = 0;
  for (const e of events) {
    globalTokens += e.total_tokens;
    if (isPriced(e)) globalAcc.set(e.currency, (globalAcc.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
  }
  const globalCost: CostByCurrency = {};
  for (const [cur, val] of globalAcc) globalCost[cur] = val.toString();
  const globalDom = new Decimal(globalCost[dominantCurrency(globalCost) ?? ""] ?? "0");

  const withShares = (s: WorkflowStats): WorkflowStats => ({
    ...s,
    costShare: globalDom.greaterThan(0) ? new Decimal(s.totalCost).div(globalDom).toNumber() : 0,
    tokenShare: globalTokens > 0 ? s.totalTokens / globalTokens : 0,
  });

  const workflows: WorkflowStats[] = [];
  let unattributed: WorkflowStats | null = null;
  for (const [key, evs] of groups) {
    if (key === UNATTRIBUTED) unattributed = withShares(buildWorkflowStats(key, false, evs));
    else workflows.push(withShares(buildWorkflowStats(key, true, evs)));
  }
  workflows.sort((a, b) => {
    const d = new Decimal(b.totalCost).minus(new Decimal(a.totalCost));
    if (!d.isZero()) return d.greaterThan(0) ? 1 : -1;
    return b.totalTokens - a.totalTokens;
  });

  return { workflows, unattributed, globalCost, globalTokens, globalCalls: events.length };
}

// --- Workflow detail ---------------------------------------------------------

export interface Participation {
  key: string;
  count: number;
}

export interface WorkflowDetail {
  stats: WorkflowStats;
  trace: TraceStep[];
  graph: AgentTreeNode[];
  agentParticipation: Participation[];
  promptParticipation: Participation[];
  toolParticipation: Participation[];
  modelUsage: Participation[];
  providerUsage: Participation[];
  costTrend: TrendPoint[];
  durationTrend: { execution: string; start: string; durationMs: number }[];
}

function participation(events: ObservationEvent[], sel: (e: ObservationEvent) => string | null): Participation[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const k = sel(e);
    if (k && k !== UNKNOWN) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export function computeWorkflowDetail(events: ObservationEvent[], key: string): WorkflowDetail {
  const scoped = events.filter((e) => workflowKey(e) === key);
  const lb = computeWorkflowLeaderboard(events);
  const stats =
    key === UNATTRIBUTED ? lb.unattributed : lb.workflows.find((w) => w.key === key);

  return {
    stats: stats ?? buildWorkflowStats(key, key !== UNATTRIBUTED, scoped),
    trace: reconstructTrace(scoped),
    graph: computeAgentLeaderboard(scoped).tree, // execution graph from ObservationEvent edges
    agentParticipation: participation(scoped, (e) => (e.agent !== UNKNOWN ? e.agent : null)),
    promptParticipation: participation(scoped, (e) => (e.attribution_status === "complete" ? e.prompt : null)),
    toolParticipation: participation(scoped, (e) => e.tool_name),
    modelUsage: participation(scoped, (e) => e.model),
    providerUsage: participation(scoped, (e) => e.provider),
    costTrend: computeCostByDay(scoped),
    durationTrend: executionsOf(scoped)
      .map((m) => ({ execution: m.sessionId, start: m.start, durationMs: m.durationMs }))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  };
}

// --- Workflow recommendations (foundation) -----------------------------------

export type WorkflowFlagType =
  | "expensive"
  | "long-running"
  | "high-failure"
  | "excessive-tool-fan-out"
  | "high-model-cost-concentration"
  | "single-provider-dependency";

export interface WorkflowFlag {
  type: WorkflowFlagType;
  workflow: string;
  detail: string;
  value: number;
  threshold: number;
}

export const TOOL_FAN_OUT_THRESHOLD = 5;
export const CONCENTRATION_THRESHOLD = 0.8;
export const WORKFLOW_FAILURE_THRESHOLD = 0.25;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Fraction of a workflow's cost concentrated in its single most expensive model. */
function modelConcentration(events: ObservationEvent[]): number {
  const byModel = new Map<string, Decimal>();
  let total = new Decimal(0);
  for (const e of events) {
    if (!isPriced(e)) continue;
    const c = new Decimal(e.cost);
    total = total.plus(c);
    byModel.set(e.model, (byModel.get(e.model) ?? new Decimal(0)).plus(c));
  }
  if (total.isZero()) return 0;
  let max = new Decimal(0);
  for (const v of byModel.values()) if (v.greaterThan(max)) max = v;
  return max.div(total).toNumber();
}

export function computeWorkflowFlags(
  lb: WorkflowLeaderboard,
  events: ObservationEvent[],
): WorkflowFlag[] {
  const { workflows } = lb;
  if (!workflows.length) return [];
  const costThreshold = median(workflows.map((w) => Number(w.totalCost))) * 2;
  const durationThreshold = median(workflows.map((w) => w.avgDurationMs)) * 2;

  const flags: WorkflowFlag[] = [];
  for (const w of workflows) {
    const scoped = events.filter((e) => workflowKey(e) === w.key);
    if (costThreshold > 0 && Number(w.totalCost) > costThreshold) {
      flags.push({ type: "expensive", workflow: w.key, detail: `Cost ${w.totalCost} exceeds 2× median`, value: Number(w.totalCost), threshold: costThreshold });
    }
    if (durationThreshold > 0 && w.avgDurationMs > durationThreshold) {
      flags.push({ type: "long-running", workflow: w.key, detail: `Avg duration ${Math.round(w.avgDurationMs)}ms exceeds 2× median`, value: w.avgDurationMs, threshold: durationThreshold });
    }
    if (w.failureRate > WORKFLOW_FAILURE_THRESHOLD) {
      flags.push({ type: "high-failure", workflow: w.key, detail: `Failure rate ${(w.failureRate * 100).toFixed(0)}% exceeds ${WORKFLOW_FAILURE_THRESHOLD * 100}%`, value: w.failureRate, threshold: WORKFLOW_FAILURE_THRESHOLD });
    }
    if (w.avgToolCalls > TOOL_FAN_OUT_THRESHOLD) {
      flags.push({ type: "excessive-tool-fan-out", workflow: w.key, detail: `Avg ${w.avgToolCalls.toFixed(1)} tool calls exceeds ${TOOL_FAN_OUT_THRESHOLD}`, value: w.avgToolCalls, threshold: TOOL_FAN_OUT_THRESHOLD });
    }
    const concentration = modelConcentration(scoped);
    if (concentration > CONCENTRATION_THRESHOLD && w.models.length > 1) {
      flags.push({ type: "high-model-cost-concentration", workflow: w.key, detail: `${(concentration * 100).toFixed(0)}% of cost in one model`, value: concentration, threshold: CONCENTRATION_THRESHOLD });
    }
    if (w.providers.length === 1) {
      flags.push({ type: "single-provider-dependency", workflow: w.key, detail: `Depends on a single provider (${w.providers[0]})`, value: 1, threshold: 1 });
    }
  }
  return flags;
}
