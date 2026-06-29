import type { ObservationEvent } from "../observation/event";
import { computeCostByDay, dayBucket } from "./overview";
import { computeModelAnalytics } from "./models";
import { computeAgentLeaderboard } from "./agents";
import { computePromptLeaderboard, computePromptVersions } from "./prompts";
import { computeWorkflowLeaderboard, computeWorkflowDetail } from "./workflows";
import { eventsForEntity } from "./recommendations";

/**
 * Alert engine (US6). A CONSUMER of the validated analytics — every rule reads an
 * already-tested aggregator (computeCostByDay, computeModelAnalytics, agent/prompt/
 * workflow analytics) and compares it against a threshold. It computes NO independent
 * aggregates and NEVER mutates ObservationEvents.
 *
 * `computeAlerts` returns alerts in the "active" lifecycle state. Acknowledgement and
 * resolution live entirely in a separate state store (see ../alert-state.ts) so the
 * immutable event stream is never touched. `triggered_at` is data-derived (latest
 * related-event timestamp), so replay over the same events reproduces identical alerts.
 */

export type AlertType =
  | "cost-spike"
  | "token-spike"
  | "latency-spike"
  | "failure-spike"
  | "prompt-regression"
  | "workflow-regression"
  | "model-degradation"
  | "provider-degradation";

export type AlertStatus = "active" | "acknowledged" | "resolved";
export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface Alert {
  alert_id: string;
  rule_id: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  entity_type: "global" | "model" | "provider" | "agent" | "prompt" | "workflow";
  entity_id: string;
  metric: string;
  threshold: number;
  observed_value: number;
  evidence: string;
  triggered_at: string | null;
  resolved_at: string | null;
  acknowledged_at: string | null;
  related_event_ids: string[];
}

// Thresholds — kept here so the anomaly fixture and tests can reason about them.
export const SPIKE_FACTOR = 3; // latest day vs mean of prior days
export const FAILURE_THRESHOLD = 0.5; // failure rate that trips a degradation/failure alert
export const MIN_CALLS = 2; // ignore single-call noise for rate-based rules
export const LATENCY_FACTOR = 2; // model latency vs median model latency
export const PROMPT_REGRESSION_FACTOR = 1.2; // newest version $/call vs oldest
export const WORKFLOW_REGRESSION_FACTOR = 2; // latest execution duration vs mean of earlier

function severityFromRatio(value: number, threshold: number): AlertSeverity {
  if (threshold <= 0) return "medium";
  const r = value / threshold;
  if (r >= 4) return "critical";
  if (r >= 2) return "high";
  if (r >= 1.5) return "medium";
  return "low";
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function alertId(rule: AlertType, entityType: string, entityId: string): string {
  return `alert:${rule}:${entityType}:${entityId}`;
}

function lastTimestamp(events: ObservationEvent[]): string | null {
  return events.length ? events[events.length - 1].timestamp : null;
}

/** Detect spikes and degradations across the validated analytics. */
export function computeAlerts(events: ObservationEvent[]): Alert[] {
  if (events.length === 0) return [];
  const alerts: Alert[] = [];

  // 1 & 2. Global cost / token spike — latest day vs mean of prior days (computeCostByDay).
  const byDay = computeCostByDay(events);
  if (byDay.length >= 2) {
    const last = byDay[byDay.length - 1];
    const prior = byDay.slice(0, -1);
    const dayEvents = events
      .filter((e) => dayBucket(e.timestamp) === last.bucket)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const dayIds = dayEvents.map((e) => e.event_id).slice(0, 50);
    const triggered = lastTimestamp(dayEvents);

    const baselineCost = prior.reduce((s, p) => s + Number(p.cost), 0) / prior.length;
    const observedCost = Number(last.cost);
    if (baselineCost > 0 && observedCost > SPIKE_FACTOR * baselineCost) {
      const threshold = SPIKE_FACTOR * baselineCost;
      alerts.push({
        alert_id: alertId("cost-spike", "global", "all"),
        rule_id: "cost-spike",
        severity: severityFromRatio(observedCost, threshold),
        status: "active",
        entity_type: "global",
        entity_id: "all",
        metric: "daily_cost",
        threshold,
        observed_value: observedCost,
        evidence: `Daily cost on ${last.bucket} was ${observedCost.toFixed(6)} vs a ${baselineCost.toFixed(6)} prior-day average (${SPIKE_FACTOR}× threshold).`,
        triggered_at: triggered,
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: dayIds,
      });
    }

    const baselineTokens = prior.reduce((s, p) => s + p.totalTokens, 0) / prior.length;
    const observedTokens = last.totalTokens;
    if (baselineTokens > 0 && observedTokens > SPIKE_FACTOR * baselineTokens) {
      const threshold = SPIKE_FACTOR * baselineTokens;
      alerts.push({
        alert_id: alertId("token-spike", "global", "all"),
        rule_id: "token-spike",
        severity: severityFromRatio(observedTokens, threshold),
        status: "active",
        entity_type: "global",
        entity_id: "all",
        metric: "daily_tokens",
        threshold,
        observed_value: observedTokens,
        evidence: `Daily tokens on ${last.bucket} were ${observedTokens} vs a ${Math.round(baselineTokens)} prior-day average (${SPIKE_FACTOR}× threshold).`,
        triggered_at: triggered,
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: dayIds,
      });
    }
  }

  // 3 & 8. Model degradation, latency spike (computeModelAnalytics).
  const ma = computeModelAnalytics(events);
  const latencyMedian = median(ma.models.map((m) => m.avgLatencyMs));
  for (const m of ma.models) {
    if (m.calls >= MIN_CALLS && m.failureRate > FAILURE_THRESHOLD) {
      const rel = eventsForEntity(events, "model", m.key);
      alerts.push({
        alert_id: alertId("model-degradation", "model", m.key),
        rule_id: "model-degradation",
        severity: severityFromRatio(m.failureRate, FAILURE_THRESHOLD),
        status: "active",
        entity_type: "model",
        entity_id: m.key,
        metric: "failure_rate",
        threshold: FAILURE_THRESHOLD,
        observed_value: m.failureRate,
        evidence: `Model "${m.key}" failure rate ${(m.failureRate * 100).toFixed(0)}% over ${m.calls} calls exceeds the ${(FAILURE_THRESHOLD * 100).toFixed(0)}% threshold.`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
    if (m.calls >= MIN_CALLS && latencyMedian > 0 && m.avgLatencyMs > LATENCY_FACTOR * latencyMedian) {
      const rel = eventsForEntity(events, "model", m.key);
      const threshold = LATENCY_FACTOR * latencyMedian;
      alerts.push({
        alert_id: alertId("latency-spike", "model", m.key),
        rule_id: "latency-spike",
        severity: severityFromRatio(m.avgLatencyMs, threshold),
        status: "active",
        entity_type: "model",
        entity_id: m.key,
        metric: "avg_latency_ms",
        threshold,
        observed_value: m.avgLatencyMs,
        evidence: `Model "${m.key}" average latency ${Math.round(m.avgLatencyMs)}ms is over ${LATENCY_FACTOR}× the ${Math.round(latencyMedian)}ms median.`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
  }

  // 4. Provider degradation (computeModelAnalytics providers).
  for (const p of ma.providers) {
    if (p.calls >= MIN_CALLS && p.failureRate > FAILURE_THRESHOLD) {
      const rel = eventsForEntity(events, "provider", p.key);
      alerts.push({
        alert_id: alertId("provider-degradation", "provider", p.key),
        rule_id: "provider-degradation",
        severity: severityFromRatio(p.failureRate, FAILURE_THRESHOLD),
        status: "active",
        entity_type: "provider",
        entity_id: p.key,
        metric: "failure_rate",
        threshold: FAILURE_THRESHOLD,
        observed_value: p.failureRate,
        evidence: `Provider "${p.key}" failure rate ${(p.failureRate * 100).toFixed(0)}% over ${p.calls} calls exceeds the ${(FAILURE_THRESHOLD * 100).toFixed(0)}% threshold.`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
  }

  // 5. Failure spike per agent (computeAgentLeaderboard).
  for (const a of computeAgentLeaderboard(events).agents) {
    if (a.calls >= MIN_CALLS && a.failureRate > FAILURE_THRESHOLD) {
      const rel = eventsForEntity(events, "agent", a.key);
      alerts.push({
        alert_id: alertId("failure-spike", "agent", a.key),
        rule_id: "failure-spike",
        severity: severityFromRatio(a.failureRate, FAILURE_THRESHOLD),
        status: "active",
        entity_type: "agent",
        entity_id: a.key,
        metric: "failure_rate",
        threshold: FAILURE_THRESHOLD,
        observed_value: a.failureRate,
        evidence: `Agent "${a.key}" failure rate ${(a.failureRate * 100).toFixed(0)}% over ${a.calls} calls exceeds the ${(FAILURE_THRESHOLD * 100).toFixed(0)}% threshold.`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
  }

  // 6. Prompt regression — newest version $/call vs oldest (computePromptVersions).
  for (const p of computePromptLeaderboard(events).prompts) {
    const versions = computePromptVersions(events, p.key)
      .filter((v) => v.calls > 0 && v.firstSeen)
      .sort((a, b) => Date.parse(a.firstSeen as string) - Date.parse(b.firstSeen as string));
    if (versions.length < 2) continue;
    const oldest = versions[0];
    const newest = versions[versions.length - 1];
    const oldRate = Number(oldest.cost) / oldest.calls;
    const newRate = Number(newest.cost) / newest.calls;
    if (oldRate > 0 && newRate > PROMPT_REGRESSION_FACTOR * oldRate) {
      const rel = eventsForEntity(events, "prompt", p.key);
      const threshold = PROMPT_REGRESSION_FACTOR * oldRate;
      alerts.push({
        alert_id: alertId("prompt-regression", "prompt", p.key),
        rule_id: "prompt-regression",
        severity: severityFromRatio(newRate, threshold),
        status: "active",
        entity_type: "prompt",
        entity_id: p.key,
        metric: "cost_per_call",
        threshold,
        observed_value: newRate,
        evidence: `Prompt "${p.key}" version "${newest.version}" costs ${newRate.toFixed(6)}/call vs "${oldest.version}" at ${oldRate.toFixed(6)}/call (regression).`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
  }

  // 7. Workflow regression — latest execution duration vs mean of earlier (durationTrend).
  for (const w of computeWorkflowLeaderboard(events).workflows) {
    const trend = computeWorkflowDetail(events, w.key).durationTrend;
    if (trend.length < 2) continue;
    const latest = trend[trend.length - 1];
    const earlier = trend.slice(0, -1);
    const baseline = earlier.reduce((s, t) => s + t.durationMs, 0) / earlier.length;
    if (baseline > 0 && latest.durationMs > WORKFLOW_REGRESSION_FACTOR * baseline) {
      const rel = eventsForEntity(events, "workflow", w.key);
      const threshold = WORKFLOW_REGRESSION_FACTOR * baseline;
      alerts.push({
        alert_id: alertId("workflow-regression", "workflow", w.key),
        rule_id: "workflow-regression",
        severity: severityFromRatio(latest.durationMs, threshold),
        status: "active",
        entity_type: "workflow",
        entity_id: w.key,
        metric: "execution_duration_ms",
        threshold,
        observed_value: latest.durationMs,
        evidence: `Workflow "${w.key}" latest execution ran ${Math.round(latest.durationMs)}ms vs a ${Math.round(baseline)}ms average of earlier runs (${WORKFLOW_REGRESSION_FACTOR}× threshold).`,
        triggered_at: lastTimestamp(rel),
        resolved_at: null,
        acknowledged_at: null,
        related_event_ids: rel.map((e) => e.event_id).slice(0, 50),
      });
    }
  }

  alerts.sort((a, b) => (a.alert_id < b.alert_id ? -1 : a.alert_id > b.alert_id ? 1 : 0));
  return alerts;
}

export function findAlert(events: ObservationEvent[], id: string): Alert | null {
  return computeAlerts(events).find((a) => a.alert_id === id) ?? null;
}
