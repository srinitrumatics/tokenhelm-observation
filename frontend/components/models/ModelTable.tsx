import type { ModelStats } from "@/lib/analytics/models";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

interface ModelTableProps {
  models: ModelStats[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}

/** Per-model analytics (US5) with selection for Model-vs-Model comparison. */
export function ModelTable({ models, selected, onToggle }: ModelTableProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Models</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium" />
            <th className="py-1 pr-2 font-medium">Model</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 text-right font-medium">In</th>
            <th className="py-1 pr-2 text-right font-medium">Out</th>
            <th className="py-1 pr-2 text-right font-medium">Total</th>
            <th className="py-1 pr-2 text-right font-medium">$/call</th>
            <th className="py-1 pr-2 text-right font-medium">Latency</th>
            <th className="py-1 text-right font-medium">Success</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.key} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2">
                <input type="checkbox" checked={selected.has(m.key)} onChange={() => onToggle(m.key)} aria-label={`compare ${m.key}`} />
              </td>
              <td className="py-1.5 pr-2 text-slate-200">{m.key}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(m.calls)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(m.cost)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{formatTokens(m.inputTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{formatTokens(m.outputTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(m.totalTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{formatCost(m.averageCostPerCall)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(m.avgLatencyMs)} ms</td>
              <td className="py-1.5 text-right text-slate-400">{formatShare(m.successRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
