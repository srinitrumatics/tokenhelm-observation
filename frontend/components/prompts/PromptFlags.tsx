import type { PromptFlag, PromptFlagType } from "@/lib/analytics/prompts";

interface PromptFlagsProps {
  flags: PromptFlag[];
}

const LABELS: Record<PromptFlagType, string> = {
  expensive: "Expensive",
  "high-input-output-ratio": "Heavy prompt",
  "high-token-usage": "High token usage",
};

/** Prompt recommendation foundation (US2 §5): deterministic, explainable flags. */
export function PromptFlags({ flags }: PromptFlagsProps) {
  if (flags.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500">
        No prompt recommendations — nothing exceeds the relative thresholds.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Prompt recommendations</h3>
      <ul className="space-y-2">
        {flags.map((f, i) => (
          <li
            key={`${f.type}-${f.prompt}-${i}`}
            className="flex items-start gap-3 rounded border border-slate-800/70 bg-slate-950/40 p-2 text-sm"
          >
            <span className="mt-0.5 rounded bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-200">
              {LABELS[f.type]}
            </span>
            <span className="text-slate-300">
              <span className="font-medium text-slate-100">{f.prompt}</span> — {f.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
