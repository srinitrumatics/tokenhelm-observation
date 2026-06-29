"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/schema";

interface TrendChartProps {
  points: TrendPoint[];
}

/** Cost and token usage over time (User Story 2, FR-005). */
export function TrendChart({ points }: TrendChartProps) {
  const data = points.map((p) => ({
    bucket: p.bucket,
    cost: Number(p.cost),
    totalTokens: p.totalTokens,
  }));

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
        No data in the selected range.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Usage over time</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis
            yAxisId="tokens"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            label={{ value: "tokens", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }}
          />
          <YAxis
            yAxisId="cost"
            orientation="right"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", color: "#e2e8f0" }}
          />
          <Line
            yAxisId="tokens"
            type="monotone"
            dataKey="totalTokens"
            name="Total tokens"
            stroke="#38bdf8"
            dot={false}
          />
          <Line
            yAxisId="cost"
            type="monotone"
            dataKey="cost"
            name="Cost"
            stroke="#f59e0b"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
