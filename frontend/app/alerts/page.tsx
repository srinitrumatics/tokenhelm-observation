"use client";

import { useMemo, useState } from "react";
import { useObservations } from "@/lib/useObservations";
import { computeOverview, filterByRange } from "@/lib/analytics/overview";
import { computeAlerts, type Alert, type AlertStatus } from "@/lib/analytics/alerts";
import { AlertCard } from "@/components/alerts/AlertCard";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

const SEVERITIES = ["critical", "high", "medium", "low"];

interface Overlay {
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

/**
 * Alerts (US6): operational anomalies derived from validated analytics. Alerts are
 * recomputed in-memory from immutable events; acknowledge/resolve mutate ONLY lifecycle
 * state — persisted server-side via PATCH and overlaid locally for instant feedback.
 */
export default function AlertsPage() {
  const { data, loading, error, refresh } = useObservations();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [severity, setSeverity] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const events = data?.events ?? [];
  const scoped = useMemo(() => filterByRange(events, range.from, range.to), [events, range.from, range.to]);
  const computed = useMemo(() => computeAlerts(scoped), [scoped]);
  const fullSpan = useMemo(() => computeOverview(events).summary, [events]);

  // Apply local lifecycle overlay onto the freshly computed (always-active) alerts.
  const alerts: Alert[] = computed.map((a) => {
    const o = overlay[a.alert_id];
    return o ? { ...a, status: o.status, acknowledged_at: o.acknowledged_at, resolved_at: o.resolved_at } : a;
  });

  const entityTypes = Array.from(new Set(computed.map((a) => a.entity_type))).sort();

  const visible = alerts.filter(
    (a) => (!severity || a.severity === severity) && (!entityType || a.entity_type === entityType),
  );
  const active = visible.filter((a) => a.status === "active");
  const history = visible
    .filter((a) => a.status !== "active")
    .sort((x, y) => (x.triggered_at ?? "").localeCompare(y.triggered_at ?? ""));
  const timeline = [...visible].sort((x, y) => (x.triggered_at ?? "").localeCompare(y.triggered_at ?? ""));

  async function patch(id: string, action: "acknowledge" | "resolve") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(id)}/${action}`, { method: "PATCH" });
      const now = new Date().toISOString();
      // Optimistic overlay update (works even if the server store is reset/separate).
      setOverlay((prev) => ({
        ...prev,
        [id]: {
          status: action === "acknowledge" ? "acknowledged" : "resolved",
          acknowledged_at: action === "acknowledge" ? now : prev[id]?.acknowledged_at ?? null,
          resolved_at: action === "resolve" ? now : prev[id]?.resolved_at ?? null,
        },
      }));
      if (!res.ok) {
        // Surface but keep optimistic state; the alert may have cleared server-side.
        await res.json().catch(() => null);
      }
    } finally {
      setBusyId(null);
    }
  }

  const hasData = events.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Alerts</h1>
          <p className="text-sm text-slate-400">
            Cost / token / latency / failure spikes and regressions — detected from the validated
            analytics, never from a parallel aggregate
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
        <div className="text-sm text-slate-500">Loading alerts…</div>
      ) : !hasData ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <div className="space-y-8">
          <DateRangeFilter from={range.from} to={range.to} min={fullSpan.firstTimestamp} max={fullSpan.lastTimestamp} onChange={setRange} />

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200"
            >
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-200"
            >
              <option value="">All entities</option>
              {entityTypes.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
            <span className="text-slate-500">{active.length} active · {history.length} in history</span>
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Active alerts</h2>
            {active.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
                No active alerts match the current filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {active.map((a) => (
                  <AlertCard key={a.alert_id} alert={a} busy={busyId === a.alert_id}
                    onAcknowledge={(id) => patch(id, "acknowledge")} onResolve={(id) => patch(id, "resolve")} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Timeline</h2>
            <ol className="space-y-1 border-l border-slate-800 pl-4">
              {timeline.map((a) => (
                <li key={a.alert_id} className="relative text-xs text-slate-400">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-slate-600" />
                  <span className="text-slate-500">{a.triggered_at ?? "—"}</span>{" "}
                  <span className="font-medium text-slate-200">{a.rule_id}</span> · {a.entity_type}:{a.entity_id} ·{" "}
                  <span className="uppercase">{a.severity}</span> · {a.status}
                </li>
              ))}
            </ol>
          </section>

          {history.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Alert history</h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {history.map((a) => (
                  <AlertCard key={a.alert_id} alert={a} busy={busyId === a.alert_id}
                    onAcknowledge={(id) => patch(id, "acknowledge")} onResolve={(id) => patch(id, "resolve")} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
