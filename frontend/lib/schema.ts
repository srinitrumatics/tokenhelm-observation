import { z } from "zod";

/**
 * Zod schema for one line of usage_log.jsonl — a single tracked model call.
 * Mirrors specs/001-cost-analytics-dashboard/contracts/usage-record.schema.json.
 *
 * Notes that matter for correctness:
 *  - `cost` stays a STRING (variable-precision decimal); it is aggregated with
 *    decimal.js downstream, never parsed to a float here.
 *  - `total_tokens` is taken as recorded and never recomputed; it may exceed
 *    input_tokens + output_tokens because upstream folds reasoning tokens in.
 */
export const usageRecordSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  latency: z.number().nonnegative().optional().default(0),
  cost: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "cost must be a decimal string"),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "timestamp must be a parseable date",
  }),
  usage_complete: z.boolean().optional().default(true),
  priced: z.boolean(),
  currency: z.string().min(1),
  // Which agent produced the call. Older log records predate this field, so it is
  // optional; missing values are treated as "unknown" by the UI/aggregator.
  agent: z.string().min(1).optional(),
});

export type UsageRecord = z.infer<typeof usageRecordSchema>;

/** Dimension an attribute breakdown can group by. */
export type BreakdownDimension = "model" | "provider" | "agent";

/** Placeholder used when a record has no agent attribution. */
export const UNKNOWN_AGENT = "unknown";

/** Per-currency decimal-string cost totals, e.g. { USD: "0.0040280" }. */
export type CostByCurrency = Record<string, string>;

export interface UsageSummary {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costByCurrency: CostByCurrency;
  pricedCount: number;
  unpricedCount: number;
  skippedLines: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface BreakdownGroup {
  key: string;
  callCount: number;
  totalTokens: number;
  costByCurrency: CostByCurrency;
  tokenShare: number;
  costShare: number;
}

export interface DimensionBreakdown {
  dimension: BreakdownDimension;
  groups: BreakdownGroup[];
}

export interface TrendPoint {
  bucket: string;
  cost: string;
  totalTokens: number;
  callCount: number;
}

export interface UsageApiResponse {
  records: UsageRecord[];
  summary: UsageSummary;
  meta: {
    source: string;
    logPresent: boolean;
  };
}
