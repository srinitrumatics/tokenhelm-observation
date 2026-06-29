import type { PromptVersionStats } from "@/lib/analytics/prompts";
import { formatCost, formatTokens, formatTimestamp } from "@/lib/format";

interface PromptVersionTableProps {
  versions: PromptVersionStats[];
}

/** Prompt version comparison (US2 §3): per-version stats side by side. */
export function PromptVersionTable({ versions }: PromptVersionTableProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Versions</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Version</th>
            <th className="py-1 pr-2 font-medium">Hash</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 text-right font-medium">Out/In</th>
            <th className="py-1 text-right font-medium">First seen</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2 text-slate-200">{v.version}</td>
              <td className="py-1.5 pr-2 font-mono text-xs text-slate-500">
                {v.promptHashes.join(", ") || "—"}
              </td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(v.calls)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(v.totalTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(v.cost)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{v.outputInputRatio.toFixed(2)}</td>
              <td className="py-1.5 text-right text-slate-500">
                {v.firstSeen ? formatTimestamp(v.firstSeen) : "—"}
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={7} className="py-3 text-center text-slate-500">
                No versions in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
