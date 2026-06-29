interface OverviewEmptyStateProps {
  present: boolean;
  source: string;
}

/**
 * Cold-start empty state (US1): shown when the event source is absent or holds no
 * events. This is distinct from "missing attribution" (events exist but can't be
 * attributed) — that case renders the dashboard with an AttributionNotice, never
 * this empty state.
 */
export function OverviewEmptyState({ present, source }: OverviewEmptyStateProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-200">No observation events yet</h2>
      <p className="mt-2 text-sm text-slate-400">
        {present
          ? "The event source was found but contains no usable events."
          : "No event source was found."}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Source: <code className="text-slate-400">{source}</code>
      </p>
      <p className="mt-4 text-xs text-slate-500">
        Run an ADK demo to record model calls, then refresh.
      </p>
    </div>
  );
}
