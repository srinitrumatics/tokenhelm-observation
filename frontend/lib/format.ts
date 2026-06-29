import Decimal from "decimal.js";
import type { CostByCurrency } from "./schema";

/**
 * Format a decimal cost string for display. Keeps small sub-cent values readable
 * (the demo logs cost fractions of a cent) without lying about precision.
 */
export function formatCost(value: string, currency = "USD"): string {
  const d = new Decimal(value || "0");
  // Show up to 6 significant decimals, trimmed; fall back to "0".
  const fixed = d.toDecimalPlaces(7).toString();
  return `${currency} ${fixed}`;
}

/** Format a map of per-currency costs as a compact, stable string. */
export function formatCostByCurrency(costs: CostByCurrency): string {
  const entries = Object.entries(costs);
  if (entries.length === 0) return "—";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cur, val]) => formatCost(val, cur))
    .join("  ·  ");
}

/** Thousands-separated integer for token counts. */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format an ISO timestamp for table/axis display. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Render a 0–1 share as a percentage string. */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
