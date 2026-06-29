interface EmptyStateProps {
  logPresent: boolean;
  source: string;
}

/** Zeroed empty state shown when the log is missing or has no valid records (FR-008). */
export function EmptyState({ logPresent, source }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-200">No usage data yet</h2>
      <p className="mt-2 text-sm text-slate-400">
        {logPresent
          ? "The usage log was found but contains no valid records."
          : "No usage log was found."}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Looked for: <code className="text-slate-400">{source}</code>
      </p>
      <p className="mt-4 text-xs text-slate-500">
        Run an ADK demo to record model calls, then refresh.
      </p>
    </div>
  );
}
