"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computeRecommendations } from "@/lib/analytics/recommendations";
import { RecommendationCard } from "@/components/recommendations/RecommendationCard";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

const CATEGORIES = [
  "Cost Optimization",
  "Prompt Optimization",
  "Workflow Optimization",
  "Agent Optimization",
  "Reliability",
  "Performance",
  "Model Selection",
];
const SEVERITIES = ["critical", "high", "medium", "low"];

/** Recommendations (US6): optimization opportunities derived from validated analytics. */
export default function RecommendationsPage() {
  const { data, loading, error, refresh } = useObservations();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [category, setCategory] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");

  const events = data?.events ?? [];
  const scoped = useMemo(() => filterByRange(events, range.from, range.to), [events, range.from, range.to]);
  const recs = useMemo(() => computeRecommendations(scoped), [scoped]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const filtered = recs.filter(
    (r) => (!category || r.category === category) && (!severity || r.severity === severity),
  );

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Recommendations</h1>
          <p className="text-sm text-slate-400">
            Optimization opportunities derived from prompt, agent &amp; workflow analytics — each
            backed by <code className="text-slate-300">ObservationEvent</code> evidence
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
        <div className="text-sm text-slate-500">Loading recommendations…</div>
      ) : !hasData ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-6">
          <DateRangeFilter from={range.from} to={range.to} min={fullSpan.firstTimestamp} max={fullSpan.lastTimestamp} onChange={setRange} />

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200"
            >
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-slate-500">{filtered.length} of {recs.length} shown</span>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
              No recommendations match the current filters — nothing exceeds the analytics thresholds.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filtered.map((r) => (
                <RecommendationCard key={r.recommendation_id} rec={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
