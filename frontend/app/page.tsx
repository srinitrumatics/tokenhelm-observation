"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { KpiCards } from "@/components/observability/KpiCards";
import { AttributionNotice } from "@/components/observability/AttributionNotice";
import { CostByDayChart } from "@/components/observability/CostByDayChart";
import { CostBreakdown } from "@/components/observability/CostBreakdown";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";
import { DateRangeFilter } from "@/components/DateRangeFilter";

/**
 * Overview dashboard (US1) — executive KPIs + cost analytics over canonical
 * ObservationEvents. Fetches normalized events once, then recomputes every view
 * in-memory per date range (FR-012); totals reconcile exactly to the raw events.
 */
export default function OverviewPage() {
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
  const overview = useMemo(() => computeOverview(scoped), [scoped]);
  // Full (unfiltered) span for the date-range control bounds.
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Overview</h1>
          <p className="text-sm text-slate-400">
            Cost &amp; usage analytics over immutable{" "}
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
        <div className="text-sm text-slate-500">Loading observability data…</div>
      ) : !hasData ? (
        <OverviewEmptyState
          present={data?.meta.present ?? false}
          source={data?.meta.source ?? "unknown"}
        />
      ) : (
        <div className="space-y-8">
          {data && <AttributionNotice summary={overview.summary} meta={data.meta} />}

          <KpiCards summary={overview.summary} />

          <DateRangeFilter
            from={range.from}
            to={range.to}
            min={fullSpan.firstTimestamp}
            max={fullSpan.lastTimestamp}
            onChange={setRange}
          />

          <CostByDayChart points={overview.costByDay} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CostBreakdown title="By model" column="Model" groups={overview.byModel} />
            <CostBreakdown title="By provider" column="Provider" groups={overview.byProvider} />
          </div>
        </div>
      )}
    </main>
  );
}
