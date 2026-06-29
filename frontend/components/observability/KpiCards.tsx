import type { OverviewSummary } from "@/lib/analytics/overview";
import { formatCostByCurrency, formatTokens, formatShare } from "@/lib/format";

interface KpiCardsProps {
  summary: OverviewSummary;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/**
 * Executive KPIs (US1): cost, calls, tokens, success/failure, and distinct-entity
 * counts. Unpriced and unattributed are surfaced explicitly — "missing attribution"
 * is shown as its own number, never hidden or folded into a named entity.
 */
export function KpiCards({ summary }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Total cost"
        value={formatCostByCurrency(summary.costByCurrency)}
        hint={
          summary.unpricedCount > 0
            ? `${summary.unpricedCount} unpriced call(s) excluded from cost`
            : "all calls priced"
        }
      />
      <Card label="Model calls" value={formatTokens(summary.callCount)} />
      <Card label="Total tokens" value={formatTokens(summary.totalTokens)} hint="as recorded" />
      <Card
        label="Success rate"
        value={formatShare(summary.successRate)}
        hint={summary.failureCount > 0 ? `${summary.failureCount} failed call(s)` : "no failures"}
      />
      <Card
        label="Unattributed calls"
        value={formatTokens(summary.unattributedCalls)}
        hint="counted but not attributable to a prompt/agent"
      />
      <Card
        label="Prompts / Agents"
        value={`${summary.promptCount} / ${summary.agentCount}`}
        hint="distinct, attributed"
      />
      <Card
        label="Models / Providers"
        value={`${summary.modelCount} / ${summary.providerCount}`}
      />
      <Card
        label="Workflows / Sessions"
        value={`${summary.workflowCount} / ${summary.sessionCount}`}
      />
    </div>
  );
}
