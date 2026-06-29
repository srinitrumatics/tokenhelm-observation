import type { Alert } from "@/lib/analytics/alerts";
import { SeverityBadge } from "@/components/common/SeverityBadge";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-red-900/40 text-red-200",
  acknowledged: "bg-amber-900/40 text-amber-200",
  resolved: "bg-emerald-900/40 text-emerald-200",
};

const RULE_LABELS: Record<string, string> = {
  "cost-spike": "Cost spike",
  "token-spike": "Token spike",
  "latency-spike": "Latency spike",
  "failure-spike": "Failure spike",
  "prompt-regression": "Prompt regression",
  "workflow-regression": "Workflow regression",
  "model-degradation": "Model degradation",
  "provider-degradation": "Provider degradation",
};

export function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  busy,
}: {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  busy: boolean;
}) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={alert.severity} />
        <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${STATUS_STYLES[alert.status]}`}>
          {alert.status}
        </span>
        <h3 className="text-sm font-semibold text-slate-100">
          {RULE_LABELS[alert.rule_id] ?? alert.rule_id}
        </h3>
        <span className="font-mono text-xs text-slate-400">
          {alert.entity_type}:{alert.entity_id}
        </span>
      </header>

      <p className="mb-3 text-sm text-slate-300">{alert.evidence}</p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
        <div><dt className="text-slate-500">Metric</dt><dd className="text-slate-200">{alert.metric}</dd></div>
        <div><dt className="text-slate-500">Observed</dt><dd className="text-slate-200">{alert.observed_value.toFixed(4)}</dd></div>
        <div><dt className="text-slate-500">Threshold</dt><dd className="text-slate-200">{alert.threshold.toFixed(4)}</dd></div>
        <div><dt className="text-slate-500">Triggered</dt><dd className="text-slate-200">{alert.triggered_at ?? "—"}</dd></div>
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || alert.status !== "active"}
          onClick={() => onAcknowledge(alert.alert_id)}
          className="rounded border border-amber-800 px-3 py-1 text-xs text-amber-200 hover:bg-amber-900/30 disabled:opacity-40"
        >
          Acknowledge
        </button>
        <button
          type="button"
          disabled={busy || alert.status === "resolved"}
          onClick={() => onResolve(alert.alert_id)}
          className="rounded border border-emerald-800 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-40"
        >
          Resolve
        </button>
        {alert.resolved_at && (
          <span className="text-xs text-slate-500">resolved {alert.resolved_at}</span>
        )}
      </div>
    </article>
  );
}
