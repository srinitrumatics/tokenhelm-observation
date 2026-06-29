"use client";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import type { UsageRecord } from "@/lib/schema";
import { formatCost, formatTimestamp, formatTokens } from "@/lib/format";

interface RecordsTableProps {
  records: UsageRecord[];
}

type SortKey = "timestamp" | "cost";
type SortDir = "asc" | "desc";

/**
 * Sortable per-record detail (User Story 3, FR-007). Displays stored total_tokens
 * as-is even when it exceeds input+output (FR-010). Cost sorts use decimal compare.
 */
export function RecordsTable({ records }: RecordsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "timestamp") {
        cmp = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      } else {
        cmp = new Decimal(a.cost).comparedTo(new Decimal(b.cost));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [records, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Call detail ({records.length})</h3>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="cursor-pointer py-1 pr-2 font-medium" onClick={() => toggle("timestamp")}>
                Time{arrow("timestamp")}
              </th>
              <th className="py-1 pr-2 font-medium">Agent</th>
              <th className="py-1 pr-2 font-medium">Provider</th>
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 pr-2 text-right font-medium">In</th>
              <th className="py-1 pr-2 text-right font-medium">Out</th>
              <th className="py-1 pr-2 text-right font-medium">Total</th>
              <th className="cursor-pointer py-1 pr-2 text-right font-medium" onClick={() => toggle("cost")}>
                Cost{arrow("cost")}
              </th>
              <th className="py-1 text-right font-medium">Priced</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.timestamp}-${i}`} className="border-t border-slate-800/60">
                <td className="py-1.5 pr-2 text-slate-400">{formatTimestamp(r.timestamp)}</td>
                <td className="py-1.5 pr-2 text-slate-200">{r.agent ?? "unknown"}</td>
                <td className="py-1.5 pr-2 text-slate-300">{r.provider}</td>
                <td className="py-1.5 pr-2 text-slate-300">{r.model}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.input_tokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.output_tokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">{formatTokens(r.total_tokens)}</td>
                <td className="py-1.5 pr-2 text-right text-slate-300">
                  {r.priced ? formatCost(r.cost, r.currency) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {r.priced ? (
                    <span className="text-emerald-400">yes</span>
                  ) : (
                    <span className="text-amber-400">no</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
