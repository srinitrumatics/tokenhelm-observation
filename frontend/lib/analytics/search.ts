import type { ObservationEvent } from "../observation/event";
import { computePromptLeaderboard } from "./prompts";
import { computeAgentLeaderboard } from "./agents";
import { computeWorkflowLeaderboard } from "./workflows";
import { computeSessionExplorer } from "./sessions";
import { computeModelAnalytics } from "./models";

/**
 * T057 — Cross-entity search (FR-027, SC-008 <500ms). A CONSUMER of the existing
 * leaderboards: it computes each entity view once and substring-matches on the entity
 * key. No new aggregates — just a unified index over the validated analytics, so a
 * result's metrics always equal that entity's leaderboard row.
 */

export type SearchEntityType = "prompt" | "agent" | "workflow" | "session" | "model" | "provider";

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  label: string;
  cost: string;
  totalTokens: number;
  calls: number;
  href: string;
  matched: string; // why it matched (the field text)
}

function includesCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Search across prompts, agents, workflows, sessions, models and providers.
 * Empty query → no results (the UI shows the entity dashboards instead).
 */
export function search(events: ObservationEvent[], query: string, limit = 50): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const p of computePromptLeaderboard(events).prompts) {
    if (includesCI(p.key, q)) {
      results.push({ type: "prompt", id: p.key, label: p.key, cost: p.cost, totalTokens: p.totalTokens, calls: p.calls, href: `/prompts/${encodeURIComponent(p.key)}`, matched: p.key });
    }
  }

  for (const a of computeAgentLeaderboard(events).agents) {
    if (includesCI(a.key, q)) {
      results.push({ type: "agent", id: a.key, label: a.key, cost: a.rolledCost, totalTokens: a.rolledTotalTokens, calls: a.calls, href: `/agents/${encodeURIComponent(a.key)}`, matched: a.key });
    }
  }

  for (const w of computeWorkflowLeaderboard(events).workflows) {
    if (includesCI(w.key, q)) {
      results.push({ type: "workflow", id: w.key, label: w.key, cost: w.totalCost, totalTokens: w.totalTokens, calls: w.totalCalls, href: `/workflows/${encodeURIComponent(w.key)}`, matched: w.key });
    }
  }

  for (const s of computeSessionExplorer(events).sessions) {
    // Sessions match on their id OR any workflow/prompt they touched.
    const hay = [s.sessionId, ...s.workflowIds, ...s.prompts].join(" ");
    if (includesCI(hay, q)) {
      results.push({ type: "session", id: s.sessionId, label: s.sessionId, cost: s.cost, totalTokens: s.totalTokens, calls: s.eventCount, href: `/sessions/${encodeURIComponent(s.sessionId)}`, matched: includesCI(s.sessionId, q) ? s.sessionId : hay });
    }
  }

  const ma = computeModelAnalytics(events);
  for (const m of ma.models) {
    if (includesCI(m.key, q)) {
      results.push({ type: "model", id: m.key, label: m.key, cost: m.cost, totalTokens: m.totalTokens, calls: m.calls, href: `/models`, matched: m.key });
    }
  }
  for (const p of ma.providers) {
    if (includesCI(p.key, q)) {
      results.push({ type: "provider", id: p.key, label: p.key, cost: p.cost, totalTokens: p.totalTokens, calls: p.calls, href: `/models`, matched: p.key });
    }
  }

  // Rank by cost desc (Number is fine for ordering; exact money stays in the strings).
  results.sort((a, b) => Number(b.cost) - Number(a.cost));
  return results.slice(0, limit);
}
