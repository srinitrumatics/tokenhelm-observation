import type { ObservationEvent } from "../observation/event";
import { computePromptLeaderboard } from "./prompts";
import { computeAgentLeaderboard } from "./agents";
import { computeWorkflowLeaderboard } from "./workflows";
import { computeSessionExplorer } from "./sessions";
import { computeModelAnalytics } from "./models";
import { computeRecommendations } from "./recommendations";
import { computeAlerts } from "./alerts";

/**
 * T058 — Export (FR-028). Flattens a computed analytics view into tabular rows so the
 * dashboard data can leave the platform as JSON or CSV. Read-only over events; the rows
 * are exactly the leaderboard/recommendation/alert values (no re-derivation).
 */

export type ExportView =
  | "prompts"
  | "agents"
  | "workflows"
  | "sessions"
  | "models"
  | "providers"
  | "recommendations"
  | "alerts";

export type Row = Record<string, string | number | boolean | null>;

export interface ExportTable {
  view: ExportView;
  columns: string[];
  rows: Row[];
}

export const EXPORT_VIEWS: ExportView[] = [
  "prompts", "agents", "workflows", "sessions", "models", "providers", "recommendations", "alerts",
];

// Stable column order per view so even an empty export emits a header row.
const COLUMNS: Record<ExportView, string[]> = {
  prompts: ["prompt", "attributed", "calls", "cost", "totalTokens", "avgTokensPerCall", "avgLatencyMs"],
  agents: ["agent", "parent", "depth", "calls", "ownCost", "rolledCost", "rolledTokens", "failureRate", "toolInvocations"],
  workflows: ["workflow", "executions", "totalCost", "totalTokens", "avgDurationMs", "successRate", "avgAgents", "avgPrompts", "avgToolCalls"],
  sessions: ["session", "attributed", "startTime", "endTime", "durationMs", "cost", "totalTokens", "eventCount", "workflows"],
  models: ["model", "calls", "cost", "totalTokens", "avgLatencyMs", "successRate", "failureRate", "providers"],
  providers: ["provider", "calls", "cost", "totalTokens", "avgLatencyMs", "successRate", "failureRate", "models"],
  recommendations: ["recommendation_id", "category", "severity", "title", "affected", "impact_type", "impact_value", "related_events", "created_at"],
  alerts: ["alert_id", "rule_id", "severity", "status", "entity", "metric", "observed_value", "threshold", "triggered_at"],
};

function table(view: ExportView, rows: Row[]): ExportTable {
  return { view, columns: COLUMNS[view], rows };
}

export function exportView(events: ObservationEvent[], view: ExportView): ExportTable {
  switch (view) {
    case "prompts": {
      const lb = computePromptLeaderboard(events);
      const all = [...lb.prompts, ...(lb.unattributed ? [lb.unattributed] : [])];
      return table(view, all.map((p) => ({
        prompt: p.key, attributed: p.attributed ?? true, calls: p.calls, cost: p.cost,
        totalTokens: p.totalTokens, avgTokensPerCall: p.avgTokensPerCall, avgLatencyMs: p.avgLatencyMs,
      })));
    }
    case "agents": {
      const lb = computeAgentLeaderboard(events);
      const all = [...lb.agents, ...(lb.unattributed ? [lb.unattributed] : [])];
      return table(view, all.map((a) => ({
        agent: a.key, parent: a.parent, depth: a.depth, calls: a.calls, ownCost: a.cost,
        rolledCost: a.rolledCost, rolledTokens: a.rolledTotalTokens, failureRate: a.failureRate,
        toolInvocations: a.toolInvocations,
      })));
    }
    case "workflows": {
      const lb = computeWorkflowLeaderboard(events);
      const all = [...lb.workflows, ...(lb.unattributed ? [lb.unattributed] : [])];
      return table(view, all.map((w) => ({
        workflow: w.key, executions: w.executions, totalCost: w.totalCost, totalTokens: w.totalTokens,
        avgDurationMs: w.avgDurationMs, successRate: w.successRate, avgAgents: w.avgAgents,
        avgPrompts: w.avgPrompts, avgToolCalls: w.avgToolCalls,
      })));
    }
    case "sessions": {
      const ex = computeSessionExplorer(events);
      const all = [...ex.sessions, ...(ex.unattributed ? [ex.unattributed] : [])];
      return table(view, all.map((s) => ({
        session: s.sessionId, attributed: s.attributed, startTime: s.startTime, endTime: s.endTime,
        durationMs: s.durationMs, cost: s.cost, totalTokens: s.totalTokens, eventCount: s.eventCount,
        workflows: s.workflowIds.join("|"),
      })));
    }
    case "models": {
      return table(view, computeModelAnalytics(events).models.map((m) => ({
        model: m.key, calls: m.calls, cost: m.cost, totalTokens: m.totalTokens,
        avgLatencyMs: m.avgLatencyMs, successRate: m.successRate, failureRate: m.failureRate,
        providers: m.providers.join("|"),
      })));
    }
    case "providers": {
      return table(view, computeModelAnalytics(events).providers.map((p) => ({
        provider: p.key, calls: p.calls, cost: p.cost, totalTokens: p.totalTokens,
        avgLatencyMs: p.avgLatencyMs, successRate: p.successRate, failureRate: p.failureRate,
        models: p.models.join("|"),
      })));
    }
    case "recommendations": {
      return table(view, computeRecommendations(events).map((r) => ({
        recommendation_id: r.recommendation_id, category: r.category, severity: r.severity, title: r.title,
        affected: `${r.affected_entity.type}:${r.affected_entity.id}`, impact_type: r.estimated_impact.type,
        impact_value: r.estimated_impact.value, related_events: r.related_event_ids.length, created_at: r.created_at,
      })));
    }
    case "alerts": {
      return table(view, computeAlerts(events).map((a) => ({
        alert_id: a.alert_id, rule_id: a.rule_id, severity: a.severity, status: a.status,
        entity: `${a.entity_type}:${a.entity_id}`, metric: a.metric, observed_value: a.observed_value,
        threshold: a.threshold, triggered_at: a.triggered_at,
      })));
    }
  }
}

/** RFC-4180-ish CSV serialization (quotes fields containing comma/quote/newline). */
export function toCsv(t: ExportTable): string {
  const escape = (v: string | number | boolean | null): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = t.columns.join(",");
  const lines = t.rows.map((r) => t.columns.map((c) => escape(r[c])).join(","));
  return [header, ...lines].join("\n");
}
