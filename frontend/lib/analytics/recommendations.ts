import type { ObservationEvent } from "../observation/event";
import { computePromptLeaderboard, computePromptFlags, type PromptFlagType } from "./prompts";
import { computeAgentLeaderboard, computeAgentFlags, type AgentFlagType } from "./agents";
import { computeWorkflowLeaderboard, computeWorkflowFlags, type WorkflowFlagType } from "./workflows";

/**
 * Recommendation engine (US6). A CONSUMER of the validated analytics — it maps the
 * existing prompt/agent/workflow recommendation flags into rich Recommendations. It
 * computes NO independent aggregates; it only re-expresses already-tested metrics and
 * attaches evidence (related ObservationEvent ids).
 *
 * Determinism (constraint): ids are derived from (flag, entity); `created_at` is the
 * latest related-event timestamp (data-derived, never wall-clock) — so replay over the
 * same event stream reproduces identical recommendations.
 */

export type RecommendationCategory =
  | "Cost Optimization"
  | "Prompt Optimization"
  | "Workflow Optimization"
  | "Agent Optimization"
  | "Reliability"
  | "Performance"
  | "Model Selection";

export type Severity = "low" | "medium" | "high" | "critical";
export type EntityType = "prompt" | "agent" | "workflow" | "model" | "provider";

export interface Recommendation {
  recommendation_id: string;
  category: RecommendationCategory;
  severity: Severity;
  title: string;
  description: string;
  evidence: string;
  affected_entity: { type: EntityType; id: string };
  estimated_impact: { type: string; value: string };
  suggested_action: string;
  related_event_ids: string[];
  created_at: string | null;
}

interface FlagMapping {
  category: RecommendationCategory;
  title: string;
  action: string;
  impact: string;
}

const PROMPT_MAP: Record<PromptFlagType, FlagMapping> = {
  expensive: { category: "Cost Optimization", title: "Expensive prompt", action: "Cache repeated calls or switch to a cheaper model", impact: "cost_saving" },
  "high-input-output-ratio": { category: "Prompt Optimization", title: "High input/output ratio", action: "Trim the prompt and reduce context tokens", impact: "token_saving" },
  "high-token-usage": { category: "Prompt Optimization", title: "High token usage", action: "Reduce prompt size or truncate context", impact: "token_saving" },
};

const AGENT_MAP: Record<AgentFlagType, FlagMapping> = {
  expensive: { category: "Cost Optimization", title: "Expensive agent", action: "Review the agent's model choice and call volume", impact: "cost_saving" },
  "high-token-usage": { category: "Agent Optimization", title: "High agent token usage", action: "Reduce per-call context", impact: "token_saving" },
  "high-failure-rate": { category: "Reliability", title: "High agent failure rate", action: "Investigate failing tool/model calls; add retries or a fallback", impact: "reliability" },
  "deep-hierarchy": { category: "Performance", title: "Deep execution hierarchy", action: "Flatten delegation depth to reduce latency", impact: "latency" },
  "excessive-fan-out": { category: "Agent Optimization", title: "Excessive child fan-out", action: "Consolidate sub-agents", impact: "structure" },
};

const WORKFLOW_MAP: Record<WorkflowFlagType, FlagMapping> = {
  expensive: { category: "Cost Optimization", title: "Expensive workflow", action: "Cache repeated steps or use cheaper models for hot paths", impact: "cost_saving" },
  "long-running": { category: "Performance", title: "Long-running workflow", action: "Parallelize or cache slow steps", impact: "latency" },
  "high-failure": { category: "Reliability", title: "High workflow failure rate", action: "Add retries/fallbacks for failing steps", impact: "reliability" },
  "excessive-tool-fan-out": { category: "Workflow Optimization", title: "Excessive tool fan-out", action: "Batch or reduce tool invocations", impact: "structure" },
  "high-model-cost-concentration": { category: "Model Selection", title: "Cost concentrated in one model", action: "Evaluate a cheaper model for the dominant step", impact: "cost_saving" },
  "single-provider-dependency": { category: "Reliability", title: "Single provider dependency", action: "Add a fallback provider for resilience", impact: "reliability" },
};

function severityFromRatio(value: number, threshold: number): Severity {
  if (threshold <= 0) return "medium";
  const r = value / threshold;
  if (r >= 4) return "critical";
  if (r >= 2) return "high";
  if (r >= 1.5) return "medium";
  return "low";
}

/** Select the events backing an entity (a lookup, NOT a new aggregate). */
export function eventsForEntity(
  events: ObservationEvent[],
  type: EntityType,
  id: string,
): ObservationEvent[] {
  const match = (e: ObservationEvent): boolean => {
    switch (type) {
      case "prompt":
        return e.attribution_status === "complete" && e.prompt === id;
      case "agent":
        return e.agent === id;
      case "workflow":
        return e.workflow_id === id;
      case "model":
        return e.model === id;
      case "provider":
        return e.provider === id;
    }
  };
  return events.filter(match).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function buildRecommendation(
  source: string,
  flagType: string,
  entityType: EntityType,
  entityId: string,
  value: number,
  threshold: number,
  detail: string,
  mapping: FlagMapping,
  events: ObservationEvent[],
): Recommendation {
  const related = eventsForEntity(events, entityType, entityId);
  const ids = related.map((e) => e.event_id).slice(0, 25);
  const created = related.length ? related[related.length - 1].timestamp : null;

  let impactValue: string;
  if (mapping.impact === "cost_saving") {
    impactValue = Math.max(0, value - threshold).toFixed(6);
  } else {
    impactValue = String(Math.round(value * 100) / 100);
  }

  return {
    recommendation_id: `rec:${source}:${flagType}:${entityType}:${entityId}`,
    category: mapping.category,
    severity: severityFromRatio(value, threshold),
    title: mapping.title,
    description: `${mapping.title} for ${entityType} "${entityId}": ${detail}`,
    evidence: detail,
    affected_entity: { type: entityType, id: entityId },
    estimated_impact: { type: mapping.impact, value: impactValue },
    suggested_action: mapping.action,
    related_event_ids: ids,
    created_at: created,
  };
}

/** Generate recommendations by consuming the existing analytics flags. */
export function computeRecommendations(events: ObservationEvent[]): Recommendation[] {
  const recs: Recommendation[] = [];

  const pl = computePromptLeaderboard(events);
  for (const f of computePromptFlags(pl)) {
    recs.push(buildRecommendation("prompt", f.type, "prompt", f.prompt, f.value, f.threshold, f.detail, PROMPT_MAP[f.type], events));
  }

  const al = computeAgentLeaderboard(events);
  for (const f of computeAgentFlags(al)) {
    recs.push(buildRecommendation("agent", f.type, "agent", f.agent, f.value, f.threshold, f.detail, AGENT_MAP[f.type], events));
  }

  const wl = computeWorkflowLeaderboard(events);
  for (const f of computeWorkflowFlags(wl, events)) {
    recs.push(buildRecommendation("workflow", f.type, "workflow", f.workflow, f.value, f.threshold, f.detail, WORKFLOW_MAP[f.type], events));
  }

  // Deterministic order (stable across replays).
  recs.sort((a, b) => (a.recommendation_id < b.recommendation_id ? -1 : a.recommendation_id > b.recommendation_id ? 1 : 0));
  return recs;
}

export function findRecommendation(events: ObservationEvent[], id: string): Recommendation | null {
  return computeRecommendations(events).find((r) => r.recommendation_id === id) ?? null;
}
