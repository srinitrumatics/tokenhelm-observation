"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useObservations } from "@/lib/useObservations";
import { computeSession } from "@/lib/analytics/sessions";
import { SessionTimeline } from "@/components/sessions/SessionTimeline";
import { ExecutionTrace } from "@/components/sessions/ExecutionTrace";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";
import { formatCostByCurrency, formatTokens, formatTimestamp } from "@/lib/format";

/**
 * Session detail (US4 §1–§4): reconstructed timeline + canonical execution trace +
 * per-event JSON inspector, all derived from the immutable ObservationEvent stream.
 */
export default function SessionDetailPage() {
  const params = useParams<{ session: string }>();
  const sessionId = decodeURIComponent(
    Array.isArray(params.session) ? params.session[0] : params.session,
  );

  const { data, loading, error } = useObservations();
  const events = data?.events ?? [];
  const session = useMemo(
    () => (events.length ? computeSession(events, sessionId) : null),
    [events, sessionId],
  );

  const s = session?.summary;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <Link href="/sessions" className="text-sm text-sky-300 hover:text-sky-200">
          ← Back to sessions
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          Session: <span className="font-mono text-slate-200">{sessionId}</span>
        </h1>
      </header>

      {error && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading session…</div>
      ) : !session || !s || s.eventCount === 0 ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase text-slate-400">Duration</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">
                {(s.durationMs / 1000).toFixed(1)}s
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {s.startTime ? formatTimestamp(s.startTime) : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase text-slate-400">Cost / tokens</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">
                {formatCostByCurrency(s.costByCurrency)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{formatTokens(s.totalTokens)} tokens</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase text-slate-400">Agents / prompts</div>
              <div className="mt-1 text-sm text-slate-200">{s.agents.join(", ") || "—"}</div>
              <div className="mt-1 text-xs text-slate-500">{s.prompts.join(", ") || "—"}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase text-slate-400">Workflow / completeness</div>
              <div className="mt-1 text-sm text-slate-200">{s.workflowIds.join(", ") || "—"}</div>
              <div className="mt-1 text-xs text-slate-500">
                {(s.attributionCompleteness * 100).toFixed(0)}% complete · {s.tools.length} tool(s)
              </div>
            </div>
          </div>

          <SessionTimeline timeline={session.timeline} />
          <ExecutionTrace trace={session.trace} />
        </div>
      )}
    </main>
  );
}
