# Phase 1 Data Model: Cost Analytics Dashboard

The app is read-only; these are in-memory shapes derived from the log, not persisted
schemas. Field names for `UsageRecord` mirror the existing `usage_log.jsonl` exactly.

## Entity: UsageRecord

One model call as logged. One JSONL line → one record. Validated by Zod (`lib/schema.ts`);
invalid lines are skipped, not coerced.

| Field | Type | Notes / Validation |
|-------|------|--------------------|
| `provider` | string | Non-empty. e.g. `"gemini"`. |
| `model` | string | Non-empty. e.g. `"gemini-3-flash-preview"`. |
| `input_tokens` | integer ≥ 0 | Prompt tokens. |
| `output_tokens` | integer ≥ 0 | Output tokens (reasoning folded in upstream). |
| `total_tokens` | integer ≥ 0 | Stored as-is; MAY exceed `input + output` (FR-010). Not recomputed. |
| `latency` | number ≥ 0 | Seconds. May be `0.0`. |
| `cost` | string | Decimal string, variable precision (e.g. `"0.0002410"`). Parsed with decimal.js. |
| `timestamp` | string (ISO 8601) | Must parse as a date; used for ordering & range filter. |
| `usage_complete` | boolean | Whether usage was fully reported. |
| `priced` | boolean | If `false`, excluded from cost totals; tokens still counted (FR-004). |
| `currency` | string | ISO currency code, e.g. `"USD"`. Cost grouped by this (FR-011). |
| `agent` | string (optional) | ADK agent that produced the call (coordinator / sub-agent / pipeline stage). Optional — legacy records lack it; treated as `"unknown"`. Enables per-agent breakdown. |

**Validation rules**
- A line failing JSON parse OR Zod validation → not a `UsageRecord`; increment `skippedLines`.
- `cost` is kept as its original string until aggregation (no float coercion).
- `timestamp` that cannot be parsed to a valid date → record is treated as malformed/skipped.

## Entity: UsageSummary

Derived aggregate over a (possibly range-filtered) set of `UsageRecord`s.

| Field | Type | Derivation |
|-------|------|------------|
| `callCount` | integer | Count of valid records in scope. |
| `inputTokens` | integer | Σ `input_tokens`. |
| `outputTokens` | integer | Σ `output_tokens`. |
| `totalTokens` | integer | Σ `total_tokens` (stored values). |
| `costByCurrency` | record<string, string> | Per-currency Σ `cost` over `priced===true` records, as decimal strings (FR-011). |
| `pricedCount` | integer | Records with `priced===true`. |
| `unpricedCount` | integer | Records with `priced===false` (FR-004 visibility). |
| `skippedLines` | integer | Malformed/invalid lines skipped (FR-009 / SC-005). |
| `firstTimestamp` / `lastTimestamp` | string \| null | Min/max timestamp in scope. |

## Entity: DimensionBreakdown

Grouping of in-scope records by an attribute (`agent`, `model`, or `provider`).

| Field | Type | Derivation |
|-------|------|------------|
| `dimension` | `"agent" \| "model" \| "provider"` | Which attribute grouped on. |
| `groups[]` | array | One per distinct value. |
| `groups[].key` | string | The model/provider value. |
| `groups[].callCount` | integer | Records in group. |
| `groups[].totalTokens` | integer | Σ `total_tokens` in group. |
| `groups[].costByCurrency` | record<string,string> | Σ priced `cost` in group, per currency. |
| `groups[].tokenShare` | number (0–1) | Group `totalTokens` ÷ overall `totalTokens`. |
| `groups[].costShare` | number (0–1) | Group cost ÷ overall cost (per dominant currency). |

## Entity: TrendPoint (P2)

Time-bucketed series for the trend chart.

| Field | Type | Derivation |
|-------|------|------------|
| `bucket` | string | Time bucket label (e.g. ISO date or hour) the records fall into. |
| `cost` | string | Σ priced `cost` in bucket (decimal string), dominant currency. |
| `totalTokens` | integer | Σ `total_tokens` in bucket. |
| `callCount` | integer | Records in bucket. |

Bucket granularity (hour vs day) chosen from the span between `firstTimestamp` and
`lastTimestamp` so the chart stays readable.

## Entity: DateRangeFilter (P2, transient UI state)

| Field | Type | Notes |
|-------|------|-------|
| `from` | string \| null | Inclusive lower bound (ISO). Null = open. |
| `to` | string \| null | Inclusive upper bound (ISO). Null = open. |

Applied client-side to the fetched records; drives `UsageSummary`, `TrendPoint[]`, and
`DimensionBreakdown` recomputation (FR-005).

## Relationships

```text
usage_log.jsonl ──parse/validate──> UsageRecord[]  (+ skippedLines count)
UsageRecord[] ──filter(DateRangeFilter)──> scoped records
   scoped records ──aggregate──> UsageSummary
   scoped records ──groupBy(model|provider)──> DimensionBreakdown
   scoped records ──bucketByTime──> TrendPoint[]
```
