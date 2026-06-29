/** Shared severity pill used by recommendations and alerts (US6). */
const STYLES: Record<string, string> = {
  critical: "bg-red-900/50 text-red-200 border border-red-800",
  high: "bg-orange-900/40 text-orange-200 border border-orange-800",
  medium: "bg-amber-900/40 text-amber-200 border border-amber-800",
  low: "bg-slate-800 text-slate-300 border border-slate-700",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLES[severity] ?? STYLES.low}`}>
      {severity}
    </span>
  );
}
