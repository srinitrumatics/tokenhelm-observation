import Link from "next/link";
import type { WorkflowStats } from "@/lib/analytics/workflows";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

interface WorkflowLeaderboardProps {
  workflows: WorkflowStats[];
  unattributed: WorkflowStats | null;
  selected: Set<string>;
  onToggle: (key: string) => void;
}

function durationLabel(ms: number): string {
  if (ms <= 0) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${(s / 60).toFixed(1)}m`;
}

function Row({
  w,
  linkable,
  selected,
  onToggle,
}: {
  w: WorkflowStats;
  linkable: boolean;
  selected: boolean;
  onToggle: (k: string) => void;
}) {
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-1.5 pr-2">
        <input type="checkbox" checked={selected} onChange={() => onToggle(w.key)} aria-label={`compare ${w.key}`} />
      </td>
      <td className="py-1.5 pr-2 text-slate-200">
        {linkable ? (
          <Link href={`/workflows/${encodeURIComponent(w.key)}`} className="font-mono text-sky-300 hover:underline">
            {w.key}
          </Link>
        ) : (
          <span className="font-mono text-slate-400 italic">{w.key}</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(w.executions)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(w.totalCost)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(w.totalTokens)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{durationLabel(w.avgDurationMs)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{formatShare(w.successRate)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{w.avgAgents.toFixed(1)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{w.avgPrompts.toFixed(1)}</td>
      <td className="py-1.5 text-right text-slate-400">{w.avgToolCalls.toFixed(1)}</td>
    </tr>
  );
}

/** Workflow leaderboard (US5) with row selection for comparison. */
export function WorkflowLeaderboard({ workflows, unattributed, selected, onToggle }: WorkflowLeaderboardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Workflow leaderboard</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium" />
            <th className="py-1 pr-2 font-medium">Workflow</th>
            <th className="py-1 pr-2 text-right font-medium">Exec</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Avg dur</th>
            <th className="py-1 pr-2 text-right font-medium">Success</th>
            <th className="py-1 pr-2 text-right font-medium">Agents</th>
            <th className="py-1 pr-2 text-right font-medium">Prompts</th>
            <th className="py-1 text-right font-medium">Tools</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((w) => (
            <Row key={w.key} w={w} linkable selected={selected.has(w.key)} onToggle={onToggle} />
          ))}
          {unattributed && unattributed.totalCalls > 0 && (
            <Row w={unattributed} linkable={false} selected={selected.has(unattributed.key)} onToggle={onToggle} />
          )}
        </tbody>
      </table>
    </div>
  );
}
