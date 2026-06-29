"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computePromptLeaderboard, computePromptFlags } from "@/lib/analytics/prompts";
import { PromptLeaderboard } from "@/components/prompts/PromptLeaderboard";
import { PromptFlags } from "@/components/prompts/PromptFlags";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

/**
 * Prompt analytics / PromptOps (US2). Reuses the shared event stream, computes the
 * leaderboard + recommendation flags client-side per date range. Each prompt links
 * to its detail page.
 */
export default function PromptsPage() {
  const { data, loading, error, refresh } = useObservations();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });

  const events = data?.events ?? [];
  const scoped = useMemo(
    () => filterByRange(events, range.from, range.to),
    [events, range.from, range.to],
  );
  const leaderboard = useMemo(() => computePromptLeaderboard(scoped), [scoped]);
  const flags = useMemo(() => computePromptFlags(leaderboard), [leaderboard]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Prompt Analytics</h1>
          <p className="text-sm text-slate-400">
            Cost, tokens, latency &amp; ratios per prompt — derived from{" "}
            <code className="text-slate-300">ObservationEvent</code>s
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
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading prompt analytics…</div>
      ) : !hasData ? (
        <OverviewEmptyState
          present={data?.meta.present ?? false}
          source={data?.meta.source ?? "unknown"}
        />
      ) : (
        <div className="space-y-8">
          <DateRangeFilter
            from={range.from}
            to={range.to}
            min={fullSpan.firstTimestamp}
            max={fullSpan.lastTimestamp}
            onChange={setRange}
          />
          <PromptLeaderboard prompts={leaderboard.prompts} unattributed={leaderboard.unattributed} />
          <PromptFlags flags={flags} />
        </div>
      )}
    </main>
  );
}
