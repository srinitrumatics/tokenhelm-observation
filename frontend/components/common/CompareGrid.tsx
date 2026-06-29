export interface CompareItem {
  name: string;
  metrics: { label: string; value: string }[];
}

interface CompareGridProps {
  title: string;
  items: CompareItem[];
  hint?: string;
}

/**
 * Generic side-by-side comparison (US5): metrics as rows, selected items as columns.
 * Used for Workflow vs Workflow, Model vs Model, and Provider vs Provider so
 * optimization opportunities are immediately visible.
 */
export function CompareGrid({ title, items, hint }: CompareGridProps) {
  if (items.length < 2) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
        {hint ?? "Select two or more rows to compare."}
      </div>
    );
  }
  const labels = items[0].metrics.map((m) => m.label);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Metric</th>
            {items.map((it) => (
              <th key={it.name} className="py-1 pr-2 text-right font-medium text-slate-300">
                {it.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label} className="border-t border-slate-800/60">
              <td className="py-1.5 pr-2 text-slate-400">{label}</td>
              {items.map((it) => (
                <td key={it.name} className="py-1.5 pr-2 text-right text-slate-200">
                  {it.metrics[i]?.value ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
