"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useObservations } from "@/lib/useObservations";
import { computePromptDetail } from "@/lib/analytics/prompts";
import { PromptDetail } from "@/components/prompts/PromptDetail";
import { OverviewEmptyState } from "@/components/observability/OverviewEmptyState";

/**
 * Prompt detail page (US2 §2). Reconstructs one prompt's timeline, executions,
 * trends, versions, metadata, and attribution status from the shared event stream.
 */
export default function PromptDetailPage() {
  const params = useParams<{ prompt: string }>();
  const promptKey = decodeURIComponent(
    Array.isArray(params.prompt) ? params.prompt[0] : params.prompt,
  );

  const { data, loading, error } = useObservations();
  const events = data?.events ?? [];
  const detail = useMemo(
    () => (events.length ? computePromptDetail(events, promptKey) : null),
    [events, promptKey],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <Link href="/prompts" className="text-sm text-sky-300 hover:text-sky-200">
          ← Back to prompts
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-100">
          Prompt: <span className="font-mono text-slate-200">{promptKey}</span>
        </h1>
      </header>

      {error && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-slate-500">Loading prompt detail…</div>
      ) : !detail || detail.stats.calls === 0 ? (
        <OverviewEmptyState present={data?.meta.present ?? false} source={data?.meta.source ?? "unknown"} />
      ) : (
        <PromptDetail promptKey={promptKey} detail={detail} />
      )}
    </main>
  );
}
