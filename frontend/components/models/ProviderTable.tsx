import type { ProviderStats } from "@/lib/analytics/models";
import { formatCost, formatTokens, formatShare } from "@/lib/format";

interface ProviderTableProps {
  providers: ProviderStats[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}

/** Per-provider analytics (US5) with selection for Provider-vs-Provider comparison. */
export function ProviderTable({ providers, selected, onToggle }: ProviderTableProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Providers</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium" />
            <th className="py-1 pr-2 font-medium">Provider</th>
            <th className="py-1 pr-2 text-right font-medium">Calls</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 text-right font-medium">Tokens</th>
            <th className="py-1 pr-2 text-right font-medium">Avg latency</th>
            <th className="py-1 pr-2 text-right font-medium">Success</th>
            <th className="py-1 text-right font-medium">Failure</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.key} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2">
                <input type="checkbox" checked={selected.has(p.key)} onChange={() => onToggle(p.key)} aria-label={`compare ${p.key}`} />
              </td>
              <td className="py-1.5 pr-2 text-slate-200">{p.key}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(p.calls)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(p.cost)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(p.totalTokens)}</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(p.avgLatencyMs)} ms</td>
              <td className="py-1.5 pr-2 text-right text-slate-400">{formatShare(p.successRate)}</td>
              <td className="py-1.5 text-right text-slate-400">{formatShare(p.failureRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
