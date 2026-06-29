import type { TimelineNode } from "@/lib/analytics/sessions";

interface SessionTimelineProps {
  timeline: TimelineNode[];
}

const KIND_STYLE: Record<TimelineNode["kind"], string> = {
  request: "border-sky-700 bg-sky-950/40 text-sky-200",
  step: "border-slate-700 bg-slate-900/60 text-slate-100",
  response: "border-emerald-700 bg-emerald-950/40 text-emerald-200",
};

/**
 * Vertical execution timeline (US4 §1): User Request → … → Final Response,
 * reconstructed chronologically from immutable events.
 */
export function SessionTimeline({ timeline }: SessionTimelineProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-4 text-sm font-semibold text-slate-300">Execution timeline</h3>
      <div className="flex flex-col items-center">
        {timeline.map((node, i) => (
          <div key={`${node.kind}-${i}`} className="flex w-full max-w-md flex-col items-center">
            <div className={`w-full rounded-md border px-4 py-2 text-center ${KIND_STYLE[node.kind]}`}>
              <div className="text-sm font-medium">{node.label}</div>
              {node.sublabel && <div className="text-xs text-slate-400">{node.sublabel}</div>}
              {node.status === "error" && (
                <div className="text-xs font-medium text-rose-300">error</div>
              )}
            </div>
            {i < timeline.length - 1 && <div className="h-5 w-px bg-slate-700" aria-hidden />}
          </div>
        ))}
      </div>
    </div>
  );
}
