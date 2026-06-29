import type { BreakdownDimension, DimensionBreakdown } from "@/lib/schema";
import { formatCostByCurrency, formatShare, formatTokens } from "@/lib/format";

interface BreakdownTableProps {
  breakdown: DimensionBreakdown;
}

/**
 * Display labels per dimension. The `agent` dimension keys off each record's
 * `agent` field, which the cost tracker sets to the prompt scope the call ran
 * under (one prompt per agent in the demos) — so it surfaces as "prompt" here,
 * matching the tracker's PER-PROMPT ATTRIBUTION output.
 */
const DIMENSION_LABELS: Record<BreakdownDimension, { title: string; column: string }> = {
  model: { title: "By model", column: "Model" },
  provider: { title: "By provider", column: "Provider" },
  agent: { title: "By prompt", column: "Prompt" },
};

/** Per-dimension (prompt/model/provider) totals with share-of-whole (User Story 3, FR-006). */
export function BreakdownTable({ breakdown }: BreakdownTableProps) {
  const { title, column } = DIMENSION_LABELS[breakdown.dimension];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">{column}</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Token %</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 text-right font-medium">Cost %</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.groups.map((g) => (
            <tr key={g.key} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2 text-slate-200">{g.key}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(g.callCount)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(g.totalTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{formatShare(g.tokenShare)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">
                {formatCostByCurrency(g.costByCurrency)}
              </td>
              <td className="py-1.5 text-right text-slate-400">{formatShare(g.costShare)}</td>
            </tr>
          ))}
          {breakdown.groups.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-center text-slate-500">
                No data in range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
