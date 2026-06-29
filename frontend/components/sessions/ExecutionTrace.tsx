"use client";

import { Fragment, useState } from "react";
import type { TraceStep } from "@/lib/analytics/sessions";
import { formatCost, formatTokens, formatTimestamp } from "@/lib/format";

interface ExecutionTraceProps {
  trace: TraceStep[];
}

/**
 * Canonical execution trace (US4 §3) + JSON inspector (§4). Every ObservationEvent
 * in execution order; expanding a row reveals the raw immutable event, proving the
 * UI is derived entirely from the canonical event stream.
 */
export function ExecutionTrace({ trace }: ExecutionTraceProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Execution trace</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Time</th>
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Agent</th>
            <th className="py-1 pr-2 font-medium">Prompt</th>
            <th className="py-1 pr-2 font-medium">Model</th>
            <th className="py-1 pr-2 font-medium">Tool</th>
            <th className="py-1 pr-2 text-right font-medium">In</th>
            <th className="py-1 pr-2 text-right font-medium">Out</th>
            <th className="py-1 pr-2 text-right font-medium">Total</th>
            <th className="py-1 pr-2 text-right font-medium">Latency</th>
            <th className="py-1 pr-2 text-right font-medium">Cost</th>
            <th className="py-1 pr-2 font-medium">Status</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {trace.map((t) => (
            <Fragment key={t.event_id}>
              <tr className="border-t border-slate-800/60">
                <td className="py-1.5 pr-2 text-slate-400">{formatTimestamp(t.timestamp)}</td>
                <td className="py-1.5 pr-2 text-slate-400">
                  {t.eventType === "tool_call" ? "tool" : "model"}
                </td>
                <td className="py-1.5 pr-2 text-slate-300">{t.agent}</td>
                <td className="py-1.5 pr-2 text-slate-400">{t.prompt}</td>
                <td className="py-1.5 pr-2 text-slate-400">{t.model}</td>
                <td className="py-1.5 pr-2 text-slate-400">{t.toolName ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(t.inputTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(t.outputTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(t.totalTokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-400">{Math.round(t.latencyMs)} ms</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatCost(t.cost)}</td>
                <td className="py-1.5 pr-2">
                  <span
                    className={
                      t.status === "error"
                        ? "rounded bg-rose-900/40 px-2 py-0.5 text-xs text-rose-200"
                        : "rounded bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-200"
                    }
                  >
                    {t.status}
                  </span>
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(t.event_id)}
                    className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    {open[t.event_id] ? "Hide JSON" : "JSON"}
                  </button>
                </td>
              </tr>
              {open[t.event_id] && (
                <tr className="bg-slate-950/60">
                  <td colSpan={13} className="px-2 py-2">
                    <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
                      {JSON.stringify(t.raw, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {trace.length === 0 && (
            <tr>
              <td colSpan={13} className="py-3 text-center text-slate-500">
                No events in this session.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
