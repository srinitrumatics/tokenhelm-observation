import type { OverviewSummary } from "@/lib/analytics/overview";
import type { ObservationMeta } from "@/lib/observation/api";

interface AttributionNoticeProps {
  summary: OverviewSummary;
  meta: ObservationMeta;
}

/**
 * Honesty banner (FR-029): surfaces data incompleteness — skipped malformed records,
 * deduped duplicates, and unattributed calls — so the dashboard never reads as
 * falsely complete. Renders nothing when everything is clean.
 */
export function AttributionNotice({ summary, meta }: AttributionNoticeProps) {
  const notes: string[] = [];
  if (summary.unattributedCalls > 0) {
    notes.push(
      `${summary.unattributedCalls} call(s) lack full attribution (counted, grouped as "unattributed").`,
    );
  }
  if (meta.skipped > 0) notes.push(`${meta.skipped} malformed record(s) skipped.`);
  if (meta.duplicates > 0) notes.push(`${meta.duplicates} duplicate event(s) collapsed.`);
  if (summary.unpricedCount > 0) {
    notes.push(`${summary.unpricedCount} unpriced call(s) count tokens but contribute zero cost.`);
  }
  if (notes.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-200/90">
      <span className="font-semibold">Data notes:</span>{" "}
      {notes.join("  ")}
    </div>
  );
}
