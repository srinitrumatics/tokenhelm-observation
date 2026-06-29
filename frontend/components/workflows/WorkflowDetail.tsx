import type { WorkflowDetail as WorkflowDetailData, Participation } from "@/lib/analytics/workflows";
import { AgentTree } from "@/components/agents/AgentTree";
import { ExecutionTrace } from "@/components/sessions/ExecutionTrace";
import { TrendChart } from "@/components/TrendChart";
import { formatCostByCurrency, formatTokens, formatShare } from "@/lib/format";

interface WorkflowDetailProps {
  workflowKey: string;
  detail: WorkflowDetailData;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function ParticipationList({ title, items }: { title: string; items: Participation[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-slate-400">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-500">—</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((p) => (
            <li key={p.key} className="flex justify-between">
              <span className="text-slate-300">{p.key}</span>
              <span className="text-slate-500">{p.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Workflow detail (US5): graph + execution trace + participation + trends. */
export function WorkflowDetail({ detail }: WorkflowDetailProps) {
  const { stats, graph, trace, costTrend, durationTrend } = detail;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Executions" value={String(stats.executions)} />
        <Stat label="Total cost" value={formatCostByCurrency(stats.totalCostByCurrency)} />
        <Stat label="Total tokens" value={formatTokens(stats.totalTokens)} />
        <Stat label="Success rate" value={formatShare(stats.successRate)} />
      </div>

      <AgentTree tree={graph} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <ParticipationList title="Agents" items={detail.agentParticipation} />
        <ParticipationList title="Prompts" items={detail.promptParticipation} />
        <ParticipationList title="Tools" items={detail.toolParticipation} />
        <ParticipationList title="Models" items={detail.modelUsage} />
        <ParticipationList title="Providers" items={detail.providerUsage} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Cost &amp; token trend</h3>
        <TrendChart points={costTrend} />
      </div>

      {durationTrend.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Duration per execution</h3>
          <ul className="space-y-1 text-sm">
            {durationTrend.map((d) => (
              <li key={d.execution} className="flex justify-between">
                <span className="font-mono text-slate-400">{d.execution}</span>
                <span className="text-slate-300">{(d.durationMs / 1000).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ExecutionTrace trace={trace} />
    </div>
  );
}
