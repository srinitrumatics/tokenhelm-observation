"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useObservations } from "@/lib/useObservations";
import { computeWorkflowDetail } from "@/lib/analytics/workflows";
import { WorkflowDetail } from "@/components/workflows/WorkflowDetail";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

/** Workflow detail (US5): execution graph, trace, participation, and trends. */
export default function WorkflowDetailPage() {
  const params = useParams<{ workflow: string }>();
  const workflowKey = decodeURIComponent(
    Array.isArray(params.workflow) ? params.workflow[0] : params.workflow,
  );

  const { data, loading, error } = useObservations();
  const events = data?.events ?? [];
  const detail = useMemo(
    () => (events.length ? computeWorkflowDetail(events, workflowKey) : null),
    [events, workflowKey],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <Link href="/workflows" className="text-sm text-sky-300 hover:text-sky-200">
          ← Back to workflows
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          Workflow: <span className="font-mono text-slate-200">{workflowKey}</span>
        </h1>
      </header>

      {error && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading workflow detail…</div>
      ) : !detail || detail.stats.totalCalls === 0 ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <WorkflowDetail workflowKey={workflowKey} detail={detail} />
      )}
    </main>
  );
}
