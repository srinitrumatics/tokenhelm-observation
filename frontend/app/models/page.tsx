"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computeModelAnalytics } from "@/lib/analytics/models";
import { ModelTable } from "@/components/models/ModelTable";
import { ProviderTable } from "@/components/models/ProviderTable";
import { CompareGrid, type CompareItem } from "@/components/common/CompareGrid";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

/** Model & Provider Analytics (US5): per-model/provider stats + comparison views. */
export default function ModelsPage() {
  const { data, loading, error, refresh } = useObservations();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [models, setModels] = useState<Set<string>>(new Set());
  const [providers, setProviders] = useState<Set<string>>(new Set());

  const events = data?.events ?? [];
  const scoped = useMemo(() => filterByRange(events, range.from, range.to), [events, range.from, range.to]);
  const analytics = useMemo(() => computeModelAnalytics(scoped), [scoped]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (k: string) => {
    const n = new Set(set);
    n.has(k) ? n.delete(k) : n.add(k);
    setter(n);
  };

  const modelCompare: CompareItem[] = analytics.models
    .filter((m) => models.has(m.key))
    .map((m) => ({
      name: m.key,
      metrics: [
        { label: "Calls", value: formatTokens(m.calls) },
        { label: "Cost", value: formatCost(m.cost) },
        { label: "Total tokens", value: formatTokens(m.totalTokens) },
        { label: "$/call", value: formatCost(m.averageCostPerCall) },
        { label: "Avg latency", value: `${Math.round(m.avgLatencyMs)} ms` },
        { label: "Success rate", value: formatShare(m.successRate) },
      ],
    }));

  const providerCompare: CompareItem[] = analytics.providers
    .filter((p) => providers.has(p.key))
    .map((p) => ({
      name: p.key,
      metrics: [
        { label: "Calls", value: formatTokens(p.calls) },
        { label: "Cost", value: formatCost(p.cost) },
        { label: "Total tokens", value: formatTokens(p.totalTokens) },
        { label: "Avg latency", value: `${Math.round(p.avgLatencyMs)} ms` },
        { label: "Success rate", value: formatShare(p.successRate) },
        { label: "Failure rate", value: formatShare(p.failureRate) },
      ],
    }));

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Model &amp; Provider Analytics</h1>
          <p className="text-sm text-slate-400">Compare models and providers to surface optimization opportunities</p>
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
        <div className="text-sm text-slate-500">Loading model analytics…</div>
      ) : !hasData ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-8">
          <DateRangeFilter from={range.from} to={range.to} min={fullSpan.firstTimestamp} max={fullSpan.lastTimestamp} onChange={setRange} />
          <ModelTable models={analytics.models} selected={models} onToggle={toggle(models, setModels)} />
          <CompareGrid title="Model vs Model" items={modelCompare} hint="Tick two or more models to compare." />
          <ProviderTable providers={analytics.providers} selected={providers} onToggle={toggle(providers, setProviders)} />
          <CompareGrid title="Provider vs Provider" items={providerCompare} hint="Tick two or more providers to compare." />
        </div>
      )}
    </main>
  );
}
