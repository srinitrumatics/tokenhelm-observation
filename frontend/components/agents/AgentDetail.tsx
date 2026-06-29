import Link from "next/link";
import type { AgentDetail as AgentDetailData } from "@/lib/analytics/agents";
import { TrendChart } from "@/components/TrendChart";
import { formatCostByCurrency, formatTokens, formatTimestamp, formatShare } from "@/lib/format";

interface AgentDetailProps {
  agentKey: string;
  detail: AgentDetailData;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

/** Agent detail (US3 §2): stats, parent/children, cost+token trend, executions, attribution. */
export function AgentDetail({ agentKey, detail }: AgentDetailProps) {
  const { stats, parent, children, recentExecutions, trend, attribution } = detail;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Calls (own)" value={formatTokens(stats.calls)} />
        <Stat label="Rolled cost" value={formatCostByCurrency(stats.rolledCostByCurrency)} />
        <Stat label="Failure rate" value={formatShare(stats.failureRate)} />
        <Stat label="Tool invocations" value={formatTokens(stats.toolInvocations)} />
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Hierarchy &amp; attribution</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Parent:</span>
          {parent ? (
            <Link href={`/agents/${encodeURIComponent(parent)}`} className="text-sky-300 hover:underline">
              {parent}
            </Link>
          ) : (
            <span className="text-slate-400">— (root)</span>
          )}
          <span className="ml-4 text-slate-500">Children:</span>
          {children.length ? (
            children.map((c) => (
              <Link
                key={c}
                href={`/agents/${encodeURIComponent(c)}`}
                className="rounded border border-slate-700 px-2 py-0.5 text-xs text-sky-300 hover:bg-slate-800"
              >
                {c}
              </Link>
            ))
          ) : (
            <span className="text-slate-400">none</span>
          )}
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

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Recent executions</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 pr-2 font-medium">Time</th>
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 pr-2 font-medium">Tool</th>
              <th className="py-1 pr-2 text-right font-medium">Total</th>
              <th className="py-1 pr-2 text-right font-medium">Latency</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentExecutions.map((r) => (
              <tr key={r.event_id} className="border-t border-slate-800/60">
                <td className="py-1.5 pr-2 text-slate-400">{formatTimestamp(r.timestamp)}</td>
                <td className="py-1.5 pr-2 text-slate-300">{r.model}</td>
                <td className="py-1.5 pr-2 text-slate-400">{r.toolName ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.totalTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(r.latencyMs)} ms</td>
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
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No executions for “{agentKey}” in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
