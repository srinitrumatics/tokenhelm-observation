"use client";

interface DateRangeFilterProps {
  from: string | null;
  to: string | null;
  min: string | null;
  max: string | null;
  onChange: (next: { from: string | null; to: string | null }) => void;
}

/** Convert an ISO timestamp to the value a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date-range control driving all views (User Story 2, FR-005). */
export function DateRangeFilter({ from, to, min, max, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <label className="flex flex-col text-xs text-slate-400">
        From
        <input
          type="datetime-local"
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          value={toLocalInput(from)}
          onChange={(e) =>
            onChange({ from: e.target.value ? new Date(e.target.value).toISOString() : null, to })
          }
        />
      </label>
      <label className="flex flex-col text-xs text-slate-400">
        To
        <input
          type="datetime-local"
          className="mt-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          value={toLocalInput(to)}
          onChange={(e) =>
            onChange({ from, to: e.target.value ? new Date(e.target.value).toISOString() : null })
          }
        />
      </label>
      <button
        type="button"
        className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800"
        onClick={() => onChange({ from: null, to: null })}
      >
        Clear range
      </button>
      {(min || max) && (
        <span className="text-xs text-slate-600">
          log spans {min ? new Date(min).toLocaleDateString() : "?"} –{" "}
          {max ? new Date(max).toLocaleDateString() : "?"}
        </span>
      )}
    </div>
  );
}
