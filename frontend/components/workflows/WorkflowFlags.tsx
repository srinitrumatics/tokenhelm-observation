import type { WorkflowFlag, WorkflowFlagType } from "@/lib/analytics/workflows";

const LABELS: Record<WorkflowFlagType, string> = {
  expensive: "Expensive",
  "long-running": "Long-running",
  "high-failure": "High failure",
  "excessive-tool-fan-out": "Tool fan-out",
  "high-model-cost-concentration": "Cost concentration",
  "single-provider-dependency": "Single provider",
};

/** Workflow recommendation foundation (US5): deterministic, explainable flags. */
export function WorkflowFlags({ flags }: { flags: WorkflowFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
        No workflow recommendations — nothing exceeds the thresholds.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Workflow recommendations</h3>
      <ul className="space-y-2">
        {flags.map((f, i) => (
          <li
            key={`${f.type}-${f.workflow}-${i}`}
            className="flex items-start gap-3 rounded border border-slate-800/70 bg-slate-950/40 p-2 text-sm"
          >
            <span className="mt-0.5 rounded bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-200">
              {LABELS[f.type]}
            </span>
            <span className="text-slate-300">
              <span className="font-mono font-medium text-slate-100">{f.workflow}</span> — {f.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
