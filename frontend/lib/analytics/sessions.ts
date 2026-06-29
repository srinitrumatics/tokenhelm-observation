import Decimal from "decimal.js";
import { isPriced, UNATTRIBUTED, UNKNOWN, type ObservationEvent } from "../observation/event";
import { dominantCurrency, type CostByCurrency } from "./overview";

/**
 * Session analytics / Session Explorer (US4). Reconstructs end-to-end execution
 * traces chronologically from immutable ObservationEvents — the canonical debug view.
 *
 * Ordering comes from timestamps + event relationships, never from UI state. Each
 * event is also modelled as an OTel-like SPAN (spanId/parentSpanId) so this can later
 * evolve into a distributed trace view without re-modelling (future-ready, §7).
 *
 * Events without a session_id fall into an explicit "unattributed" session bucket
 * (same pattern as prompts/agents). Reconciliation identities are asserted as tests:
 *   Σ session cost   (incl. unattributed) == global cost
 *   Σ session tokens (incl. unattributed) == global tokens
 *   session total == Σ its constituent events
 */

export type TraceEventType = "model_call" | "tool_call";

export interface TraceStep {
  event_id: string;
  spanId: string; // = event_id
  parentSpanId: string | null; // OTel-style parent (derived from agent relationships)
  timestamp: string;
  eventType: TraceEventType;
  agent: string;
  prompt: string;
  model: string;
  provider: string;
  toolName: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  cost: string;
  status: string;
  attributionStatus: string;
  raw: Record<string, unknown>; // the immutable ObservationEvent (JSON inspector, §4)
}

export type TimelineNodeKind = "request" | "step" | "response";

export interface TimelineNode {
  kind: TimelineNodeKind;
  label: string;
  sublabel?: string;
  timestamp: string | null;
  eventId?: string;
  status?: string;
}

export interface SessionSummary {
  sessionId: string;
  attributed: boolean;
  requestIds: string[];
  workflowIds: string[];
  startTime: string | null;
  endTime: string | null;
  durationMs: number;
  costByCurrency: CostByCurrency;
  cost: string;
  totalTokens: number;
  eventCount: number;
  models: string[];
  providers: string[];
  prompts: string[];
  agents: string[];
  tools: string[];
  attributionCompleteness: number;
}

export interface Session {
  summary: SessionSummary;
  timeline: TimelineNode[];
  trace: TraceStep[];
}

export interface SessionAnalytics {
  sessionCount: number;
  longestSession: { sessionId: string; durationMs: number } | null;
  mostExpensiveSession: { sessionId: string; cost: string } | null;
  highestTokenSession: { sessionId: string; totalTokens: number } | null;
  averageDurationMs: number;
  averageEventsPerSession: number;
}

export interface SessionExplorer {
  sessions: SessionSummary[]; // attributed, newest first
  unattributed: SessionSummary | null;
  analytics: SessionAnalytics; // over attributed sessions (the honest population)
  globalCost: CostByCurrency;
  globalTokens: number;
  globalCalls: number;
}

function sessionKey(e: ObservationEvent): string {
  return e.session_id && e.session_id !== UNKNOWN ? e.session_id : UNATTRIBUTED;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v !== UNKNOWN))];
}

/** Chronological order: timestamp asc, then event_id (deterministic for replay). */
function chronological(events: ObservationEvent[]): ObservationEvent[] {
  return [...events].sort((a, b) => {
    const t = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    if (t !== 0) return t;
    return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
  });
}

function buildSummary(key: string, attributed: boolean, events: ObservationEvent[]): SessionSummary {
  const ordered = chronological(events);
  const cost = new Map<string, Decimal>();
  let totalTokens = 0;
  let completeCount = 0;
  for (const e of ordered) {
    totalTokens += e.total_tokens;
    if (e.attribution_status === "complete") completeCount++;
    if (isPriced(e)) {
      cost.set(e.currency, (cost.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
    }
  }
  const costByCurrency: CostByCurrency = {};
  for (const [cur, val] of cost) costByCurrency[cur] = val.toString();
  const domCur = dominantCurrency(costByCurrency);
  const start = ordered[0]?.timestamp ?? null;
  const end = ordered[ordered.length - 1]?.timestamp ?? null;

  return {
    sessionId: key,
    attributed,
    requestIds: uniq(ordered.map((e) => e.request_id)),
    workflowIds: uniq(ordered.map((e) => e.workflow_id)),
    startTime: start,
    endTime: end,
    durationMs: start && end ? Date.parse(end) - Date.parse(start) : 0,
    costByCurrency,
    cost: domCur && costByCurrency[domCur] ? costByCurrency[domCur] : "0",
    totalTokens,
    eventCount: ordered.length,
    models: uniq(ordered.map((e) => e.model)),
    providers: uniq(ordered.map((e) => e.provider)),
    prompts: uniq(ordered.map((e) => (e.attribution_status === "complete" ? e.prompt : null))),
    agents: uniq(ordered.map((e) => e.agent)),
    tools: uniq(ordered.map((e) => e.tool_name)),
    attributionCompleteness: ordered.length > 0 ? completeCount / ordered.length : 0,
  };
}

function groupBySession(events: ObservationEvent[]): Map<string, ObservationEvent[]> {
  const groups = new Map<string, ObservationEvent[]>();
  for (const e of events) {
    const key = sessionKey(e);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  return groups;
}

export function computeSessionExplorer(events: ObservationEvent[]): SessionExplorer {
  const groups = groupBySession(events);
  const sessions: SessionSummary[] = [];
  let unattributed: SessionSummary | null = null;

  for (const [key, evs] of groups) {
    if (key === UNATTRIBUTED) unattributed = buildSummary(key, false, evs);
    else sessions.push(buildSummary(key, true, evs));
  }
  // Newest first by start time.
  sessions.sort((a, b) => Date.parse(b.startTime ?? "") - Date.parse(a.startTime ?? ""));

  // Global totals.
  const globalAcc = new Map<string, Decimal>();
  let globalTokens = 0;
  for (const e of events) {
    globalTokens += e.total_tokens;
    if (isPriced(e)) {
      globalAcc.set(e.currency, (globalAcc.get(e.currency) ?? new Decimal(0)).plus(new Decimal(e.cost)));
    }
  }
  const globalCost: CostByCurrency = {};
  for (const [cur, val] of globalAcc) globalCost[cur] = val.toString();

  return {
    sessions,
    unattributed,
    analytics: computeSessionAnalytics(sessions),
    globalCost,
    globalTokens,
    globalCalls: events.length,
  };
}

/** Analytics over the attributed-session population (§6). */
export function computeSessionAnalytics(sessions: SessionSummary[]): SessionAnalytics {
  if (sessions.length === 0) {
    return {
      sessionCount: 0,
      longestSession: null,
      mostExpensiveSession: null,
      highestTokenSession: null,
      averageDurationMs: 0,
      averageEventsPerSession: 0,
    };
  }
  let longest = sessions[0];
  let expensive = sessions[0];
  let highestTokens = sessions[0];
  let durationSum = 0;
  let eventSum = 0;
  for (const s of sessions) {
    if (s.durationMs > longest.durationMs) longest = s;
    if (new Decimal(s.cost).greaterThan(new Decimal(expensive.cost))) expensive = s;
    if (s.totalTokens > highestTokens.totalTokens) highestTokens = s;
    durationSum += s.durationMs;
    eventSum += s.eventCount;
  }
  return {
    sessionCount: sessions.length,
    longestSession: { sessionId: longest.sessionId, durationMs: longest.durationMs },
    mostExpensiveSession: { sessionId: expensive.sessionId, cost: expensive.cost },
    highestTokenSession: { sessionId: highestTokens.sessionId, totalTokens: highestTokens.totalTokens },
    averageDurationMs: durationSum / sessions.length,
    averageEventsPerSession: eventSum / sessions.length,
  };
}

/** Derive an OTel-style parent span: the latest earlier event of this event's parent_agent. */
function deriveParentSpan(ordered: ObservationEvent[], index: number): string | null {
  const e = ordered[index];
  if (!e.parent_agent || e.parent_agent === UNKNOWN) return null;
  for (let i = index - 1; i >= 0; i--) {
    if (ordered[i].agent === e.parent_agent) return ordered[i].event_id;
  }
  return null;
}

function toTraceStep(e: ObservationEvent, parentSpanId: string | null): TraceStep {
  return {
    event_id: e.event_id,
    spanId: e.event_id,
    parentSpanId,
    timestamp: e.timestamp,
    eventType: e.tool_name ? "tool_call" : "model_call",
    agent: e.agent,
    prompt: e.prompt,
    model: e.model,
    provider: e.provider,
    toolName: e.tool_name,
    inputTokens: e.input_tokens,
    outputTokens: e.output_tokens,
    totalTokens: e.total_tokens,
    latencyMs: e.latency_ms,
    cost: e.cost,
    status: e.status,
    attributionStatus: e.attribution_status,
    raw: e.raw,
  };
}

/**
 * Reconstruct a chronological execution trace (with OTel-style spans) from any set
 * of ObservationEvents. Shared by the Session Explorer and Workflow Analytics so
 * both build on the SAME span model (no new execution concepts).
 */
export function reconstructTrace(events: ObservationEvent[]): TraceStep[] {
  const ordered = chronological(events);
  return ordered.map((e, i) => toTraceStep(e, deriveParentSpan(ordered, i)));
}

/** Frame a trace as a User Request → … → Final Response timeline. */
export function buildTimeline(
  trace: TraceStep[],
  startTime: string | null,
  endTime: string | null,
): TimelineNode[] {
  return [
    { kind: "request", label: "User Request", timestamp: startTime },
    ...trace.map((t) => ({
      kind: "step" as const,
      label: t.agent,
      sublabel: t.toolName ? `🔧 ${t.toolName}` : t.model,
      timestamp: t.timestamp,
      eventId: t.event_id,
      status: t.status,
    })),
    { kind: "response", label: "Final Response", timestamp: endTime },
  ];
}

/** Reconstruct one session: chronological trace + framed timeline (§1–§4). */
export function computeSession(events: ObservationEvent[], sessionId: string): Session {
  const scoped = events.filter((e) => sessionKey(e) === sessionId);
  const summary = buildSummary(sessionId, sessionId !== UNATTRIBUTED, scoped);
  const trace = reconstructTrace(scoped);
  const timeline = buildTimeline(trace, summary.startTime, summary.endTime);
  return { summary, timeline, trace };
}
