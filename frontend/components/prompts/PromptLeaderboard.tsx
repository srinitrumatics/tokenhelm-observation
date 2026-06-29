import Link from "next/link";
import type { PromptStats } from "@/lib/analytics/prompts";
import { formatCostByCurrency, formatTokens, formatShare } from "@/lib/format";

interface PromptLeaderboardProps {
  prompts: PromptStats[];
  unattributed: PromptStats | null;
}

function Row({ p, linkable }: { p: PromptStats; linkable: boolean }) {
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-1.5 pr-2 text-slate-200">
        {linkable ? (
          <Link
            href={`/prompts/${encodeURIComponent(p.key)}`}
            className="text-sky-300 hover:text-sky-200 hover:underline"
          >
            {p.key}
          </Link>
        ) : (
          <span className="text-slate-400 italic">{p.key}</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(p.calls)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(p.totalTokens)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatCostByCurrency(p.costByCurrency)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(p.avgLatencyMs)} ms</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{p.outputInputRatio.toFixed(2)}</td>
      <td className="py-1.5 text-right text-slate-400">{formatShare(p.costShare)}</td>
    </tr>
  );
}

/** Prompt leaderboard (US2 §1): calls, tokens, cost, avg latency, output/input ratio. */
export function PromptLeaderboard({ prompts, unattributed }: PromptLeaderboardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Prompt leaderboard</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Prompt</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 text-right font-medium">Avg latency</th>
            <th className="py-1 pr-2 text-right font-medium">Out/In</th>
            <th className="py-1 text-right font-medium">Cost %</th>
          </tr>
        </thead>
        <tbody>
          {prompts.map((p) => (
            <Row key={p.key} p={p} linkable />
          ))}
          {unattributed && unattributed.calls > 0 && <Row p={unattributed} linkable={false} />}
          {prompts.length === 0 && !unattributed && (
            <tr>
              <td colSpan={7} className="py-3 text-center text-slate-500">
                No prompt data in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {unattributed && unattributed.calls > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          “unattributed” aggregates calls without complete prompt attribution — counted, never folded
          into a named prompt.
        </p>
      )}
    </div>
  );
}
