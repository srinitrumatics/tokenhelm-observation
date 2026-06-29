"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computeSessionExplorer } from "@/lib/analytics/sessions";
import { SessionList } from "@/components/sessions/SessionList";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

/**
 * Session Explorer (US4) — session list + analytics. Each session links to its
 * reconstructed execution trace. Recomputed client-side per date range.
 */
export default function SessionsPage() {
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
  const explorer = useMemo(() => computeSessionExplorer(scoped), [scoped]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Session Explorer</h1>
          <p className="text-sm text-slate-400">
            End-to-end execution traces reconstructed from{" "}
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
        <div className="text-sm text-slate-500">Loading sessions…</div>
      ) : !hasData ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-8">
          <DateRangeFilter
            from={range.from}
            to={range.to}
            min={fullSpan.firstTimestamp}
            max={fullSpan.lastTimestamp}
            onChange={setRange}
          />
          <SessionList
            sessions={explorer.sessions}
            unattributed={explorer.unattributed}
            analytics={explorer.analytics}
          />
        </div>
      )}
    </main>
  );
}
