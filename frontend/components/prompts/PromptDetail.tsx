import type { PromptDetail as PromptDetailData } from "@/lib/analytics/prompts";
import { TrendChart } from "@/components/TrendChart";
import { PromptVersionTable } from "./PromptVersionTable";
import { formatCostByCurrency, formatTokens, formatTimestamp } from "@/lib/format";

interface PromptDetailProps {
  promptKey: string;
  detail: PromptDetailData;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-slate-700 bg-slate-950/40 px-2 py-0.5 text-xs text-slate-300">
      <span className="text-slate-500">{label}:</span> {value}
    </span>
  );
}

/**
 * Prompt detail (US2 §2): stats, metadata, attribution status, cost+token trend,
 * recent executions, and version comparison. All derived from ObservationEvents.
 */
export function PromptDetail({ promptKey, detail }: PromptDetailProps) {
  const { stats, recentExecutions, trend, versions, attribution } = detail;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Calls" value={formatTokens(stats.calls)} />
        <Stat label="Total tokens" value={formatTokens(stats.totalTokens)} />
        <Stat label="Cost" value={formatCostByCurrency(stats.costByCurrency)} />
        <Stat label="Out/In ratio" value={stats.outputInputRatio.toFixed(2)} />
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Metadata &amp; attribution</h3>
        <div className="flex flex-wrap gap-2">
          <Chip label="versions" value={stats.versions.join(", ") || "—"} />
          <Chip label="prompt_hash" value={stats.promptHashes.join(", ") || "—"} />
          <Chip label="agents" value={stats.agents.join(", ") || "—"} />
          <Chip label="models" value={stats.models.join(", ") || "—"} />
          <Chip label="environments" value={stats.environments.join(", ") || "—"} />
          <Chip label="avg latency" value={`${Math.round(stats.avgLatencyMs)} ms`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-emerald-900/30 px-2 py-0.5 text-emerald-200">
            complete: {attribution.complete}
          </span>
          <span className="rounded bg-amber-900/30 px-2 py-0.5 text-amber-200">
            partial: {attribution.partial}
          </span>
          <span className="rounded bg-rose-900/30 px-2 py-0.5 text-rose-200">
            missing: {attribution.missing}
          </span>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Cost &amp; token trend</h3>
        <TrendChart points={trend} />
      </div>

      {versions.length > 1 && <PromptVersionTable versions={versions} />}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Recent executions</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 pr-2 font-medium">Time</th>
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 pr-2 text-right font-medium">In</th>
              <th className="py-1 pr-2 text-right font-medium">Out</th>
              <th className="py-1 pr-2 text-right font-medium">Total</th>
              <th className="py-1 pr-2 text-right font-medium">Latency</th>
              <th className="py-1 pr-2 font-medium">Version</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentExecutions.map((r) => (
              <tr key={r.event_id} className="border-t border-slate-800/60">
                <td className="py-1.5 pr-2 text-slate-400">{formatTimestamp(r.timestamp)}</td>
                <td className="py-1.5 pr-2 text-slate-300">{r.model}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.inputTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.outputTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.totalTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(r.latencyMs)} ms</td>
                <td className="py-1.5 pr-2 text-slate-400">{r.promptVersion ?? "—"}</td>
                <td className="py-1.5">
                  <span
                    className={
                      r.status === "error"
                        ? "rounded bg-rose-900/40 px-2 py-0.5 text-xs text-rose-200"
                        : "rounded bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-200"
                    }
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {recentExecutions.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3 text-center text-slate-500">
                  No executions for “{promptKey}” in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
