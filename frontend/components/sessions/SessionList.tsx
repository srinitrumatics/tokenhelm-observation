import Link from "next/link";
import type { SessionSummary, SessionAnalytics } from "@/lib/analytics/sessions";
import { formatCost, formatTokens, formatTimestamp } from "@/lib/format";

interface SessionListProps {
  sessions: SessionSummary[];
  unattributed: SessionSummary | null;
  analytics: SessionAnalytics;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Row({ s, linkable }: { s: SessionSummary; linkable: boolean }) {
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-1.5 pr-2 text-slate-200">
        {linkable ? (
          <Link
            href={`/sessions/${encodeURIComponent(s.sessionId)}`}
            className="font-mono text-sky-300 hover:text-sky-200 hover:underline"
          >
            {s.sessionId}
          </Link>
        ) : (
          <span className="font-mono text-slate-400 italic">{s.sessionId}</span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-slate-400">{s.startTime ? formatTimestamp(s.startTime) : "—"}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatDuration(s.durationMs)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(s.eventCount)}</td>
      <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(s.totalTokens)}</td>
      <td className="py-1.5 text-right text-slate-300">{formatCost(s.cost)}</td>
    </tr>
  );
}

/** Session list + session analytics (US4 §6). */
export function SessionList({ sessions, unattributed, analytics }: SessionListProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Sessions" value={String(analytics.sessionCount)} />
        <Stat
          label="Longest"
          value={analytics.longestSession ? formatDuration(analytics.longestSession.durationMs) : "—"}
        />
        <Stat
          label="Most expensive"
          value={analytics.mostExpensiveSession ? formatCost(analytics.mostExpensiveSession.cost) : "—"}
        />
        <Stat label="Avg duration" value={formatDuration(analytics.averageDurationMs)} />
        <Stat label="Avg events/session" value={analytics.averageEventsPerSession.toFixed(1)} />
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Sessions</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1 pr-2 font-medium">Session</th>
              <th className="py-1 pr-2 font-medium">Started</th>
              <th className="py-1 pr-2 text-right font-medium">Duration</th>
              <th className="py-1 pr-2 text-right font-medium">Events</th>
              <th className="py-1 pr-2 text-right font-medium">Tokens</th>
              <th className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <Row key={s.sessionId} s={s} linkable />
            ))}
            {unattributed && unattributed.eventCount > 0 && <Row s={unattributed} linkable />}
            {sessions.length === 0 && !unattributed && (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No sessions in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
