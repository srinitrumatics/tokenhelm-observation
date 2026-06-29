import Link from "next/link";
import type { AgentStats } from "@/lib/analytics/agents";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

interface AgentLeaderboardProps {
  agents: AgentStats[];
  unattributed: AgentStats | null;
}

function Row({ a, linkable }: { a: AgentStats; linkable: boolean }) {
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-1.5 pr-2 text-slate-200">
        {linkable ? (
          <Link
            href={`/agents/${encodeURIComponent(a.key)}`}
            className="text-sky-300 hover:text-sky-200 hover:underline"
          >
            {a.key}
          </Link>
        ) : (
          <span className="text-slate-400 italic">{a.key}</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(a.calls)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(a.totalTokens)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(a.rolledCost)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(a.avgLatencyMs)} ms</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{formatShare(a.failureRate)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-400">{formatTokens(a.toolInvocations)}</td>
      <td className="py-1.5 text-right text-slate-400">{a.childAgentCount}</td>
    </tr>
  );
}

/** Agent leaderboard (US3 §1): calls, tokens, cost (rolled), latency, failure, tools, children. */
export function AgentLeaderboard({ agents, unattributed }: AgentLeaderboardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Agent leaderboard</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Agent</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Cost (rolled)</th>
            <th className="py-1 pr-2 text-right font-medium">Avg latency</th>
            <th className="py-1 pr-2 text-right font-medium">Fail rate</th>
            <th className="py-1 pr-2 text-right font-medium">Tools</th>
            <th className="py-1 text-right font-medium">Children</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <Row key={a.key} a={a} linkable />
          ))}
          {unattributed && unattributed.calls > 0 && <Row a={unattributed} linkable={false} />}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Cost is rolled up (own + descendants). “unattributed” aggregates agent-less calls — counted,
        never folded into a named agent.
      </p>
    </div>
  );
}
