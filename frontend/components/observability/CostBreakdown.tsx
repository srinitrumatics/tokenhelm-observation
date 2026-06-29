import type { CostGroup } from "@/lib/analytics/overview";
import { formatCostByCurrency, formatShare, formatTokens } from "@/lib/format";

interface CostBreakdownProps {
  title: string;
  column: string;
  groups: CostGroup[];
}

/** Per-dimension (model/provider) cost breakdown with share-of-whole (US1). */
export function CostBreakdown({ title, column, groups }: CostBreakdownProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">{column}</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 text-right font-medium">Cost %</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2 text-slate-200">{g.key}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(g.callCount)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(g.totalTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">
                {formatCostByCurrency(g.costByCurrency)}
              </td>
              <td className="py-1.5 text-right text-slate-400">{formatShare(g.costShare)}</td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-center text-slate-500">
                No data in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
