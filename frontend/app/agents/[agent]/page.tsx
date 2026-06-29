"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useObservations } from "@/lib/useObservations";
import { computeAgentDetail } from "@/lib/analytics/agents";
import { AgentDetail } from "@/components/agents/AgentDetail";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

/**
 * Agent detail page (US3 §2). Reconstructs one agent's executions, trends, hierarchy
 * links, and attribution from the shared ObservationEvent stream.
 */
export default function AgentDetailPage() {
  const params = useParams<{ agent: string }>();
  const agentKey = decodeURIComponent(
    Array.isArray(params.agent) ? params.agent[0] : params.agent,
  );

  const { data, loading, error } = useObservations();
  const events = data?.events ?? [];
  const detail = useMemo(
    () => (events.length ? computeAgentDetail(events, agentKey) : null),
    [events, agentKey],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <Link href="/agents" className="text-sm text-sky-300 hover:text-sky-200">
          ← Back to agents
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          Agent: <span className="font-mono text-slate-200">{agentKey}</span>
        </h1>
      </header>

      {error && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading agent detail…</div>
      ) : !detail || detail.stats.calls === 0 ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <AgentDetail agentKey={agentKey} detail={detail} />
      )}
    </main>
  );
}
