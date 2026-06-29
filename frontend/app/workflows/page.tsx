"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computeWorkflowLeaderboard, computeWorkflowFlags } from "@/lib/analytics/workflows";
import { WorkflowLeaderboard } from "@/components/workflows/WorkflowLeaderboard";
import { WorkflowFlags } from "@/components/workflows/WorkflowFlags";
import { CompareGrid, type CompareItem } from "@/components/common/CompareGrid";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

/** Workflow Analytics (US5): leaderboard, recommendation flags, workflow-vs-workflow compare. */
export default function WorkflowsPage() {
  const { data, loading, error, refresh } = useObservations();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const events = data?.events ?? [];
  const scoped = useMemo(() => filterByRange(events, range.from, range.to), [events, range.from, range.to]);
  const leaderboard = useMemo(() => computeWorkflowLeaderboard(scoped), [scoped]);
  const flags = useMemo(() => computeWorkflowFlags(leaderboard, scoped), [leaderboard, scoped]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const compareItems: CompareItem[] = useMemo(() => {
    const all = [...leaderboard.workflows, ...(leaderboard.unattributed ? [leaderboard.unattributed] : [])];
    return all
      .filter((w) => selected.has(w.key))
      .map((w) => ({
        name: w.key,
        metrics: [
          { label: "Total cost", value: formatCost(w.totalCost) },
          { label: "Total tokens", value: formatTokens(w.totalTokens) },
          { label: "Executions", value: String(w.executions) },
          { label: "Avg duration", value: `${(w.avgDurationMs / 1000).toFixed(1)}s` },
          { label: "Success rate", value: formatShare(w.successRate) },
          { label: "Avg agents", value: w.avgAgents.toFixed(1) },
          { label: "Avg prompts", value: w.avgPrompts.toFixed(1) },
          { label: "Avg tool calls", value: w.avgToolCalls.toFixed(1) },
        ],
      }));
  }, [leaderboard, selected]);

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Workflow Analytics</h1>
          <p className="text-sm text-slate-400">
            Workflow cost, duration, success &amp; composition — from{" "}
            <code className="text-slate-300">ObservationEvent</code> relationships
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading workflow analytics…</div>
      ) : !hasData ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-8">
          <DateRangeFilter from={range.from} to={range.to} min={fullSpan.firstTimestamp} max={fullSpan.lastTimestamp} onChange={setRange} />
          <WorkflowLeaderboard
            workflows={leaderboard.workflows}
            unattributed={leaderboard.unattributed}
            selected={selected}
            onToggle={toggle}
          />
          <CompareGrid title="Workflow vs Workflow" items={compareItems} hint="Tick two or more workflows to compare." />
          <WorkflowFlags flags={flags} />
        </div>
      )}
    </main>
  );
}
