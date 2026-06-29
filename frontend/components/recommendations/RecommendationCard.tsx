import type { Recommendation } from "@/lib/analytics/recommendations";
import { SeverityBadge } from "@/components/common/SeverityBadge";
import { formatCost } from "@/lib/format";

/** Impact rendered to a human-readable line — cost savings shown as currency. */
function impactLabel(impact: Recommendation["estimated_impact"]): string {
  switch (impact.type) {
    case "cost_saving":
      return `~${formatCost(impact.value)} potential saving`;
    case "token_saving":
      return `${impact.value} tokens/call (excess)`;
    case "reliability":
      return `${impact.value} failure rate`;
    case "latency":
      return `${impact.value} (latency factor)`;
    default:
      return `${impact.value}`;
  }
}

/** A single recommendation card: severity, category, evidence, entity, action, impact. */
export function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <SeverityBadge severity={rec.severity} />
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300">
          {rec.category}
        </span>
        <h3 className="text-sm font-semibold text-slate-100">{rec.title}</h3>
      </header>

      <p className="mb-3 text-sm text-slate-300">{rec.description}</p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-slate-500">Affected</dt>
          <dd className="font-mono text-slate-200">
            {rec.affected_entity.type}:{rec.affected_entity.id}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-500">Estimated impact</dt>
          <dd className="text-emerald-300">{impactLabel(rec.estimated_impact)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-500">Evidence</dt>
          <dd className="text-slate-300">{rec.evidence}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-500">Events</dt>
          <dd className="text-slate-300">{rec.related_event_ids.length} referenced</dd>
        </div>
      </dl>

      <div className="mt-3 rounded border border-sky-900/60 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
        <span className="font-semibold">Suggested action:</span> {rec.suggested_action}
      </div>
    </article>
  );
}
