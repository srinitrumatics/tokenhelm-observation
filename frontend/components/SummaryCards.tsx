import type { UsageSummary } from "@/lib/schema";
import { formatCostByCurrency, formatTokens } from "@/lib/format";

interface SummaryCardsProps {
  summary: UsageSummary;
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/**
 * Headline KPIs (User Story 1): total cost, call count, input/output/total tokens,
 * plus unpriced and skipped-line visibility (FR-002, FR-004, FR-009).
 */
export function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        label="Total cost"
        value={formatCostByCurrency(summary.costByCurrency)}
        hint={
          summary.unpricedCount > 0
            ? `${summary.unpricedCount} unpriced call(s) excluded from cost`
            : "all calls priced"
        }
      />
      <Card
        label="Model calls"
        value={formatTokens(summary.callCount)}
        hint={
          summary.skippedLines > 0
            ? `${summary.skippedLines} malformed line(s) skipped`
            : undefined
        }
      />
      <Card label="Total tokens" value={formatTokens(summary.totalTokens)} hint="as recorded" />
      <Card label="Input tokens" value={formatTokens(summary.inputTokens)} />
      <Card label="Output tokens" value={formatTokens(summary.outputTokens)} />
      <Card
        label="Priced / unpriced"
        value={`${summary.pricedCount} / ${summary.unpricedCount}`}
        hint="unpriced count tokens but not cost"
      />
    </div>
  );
}
