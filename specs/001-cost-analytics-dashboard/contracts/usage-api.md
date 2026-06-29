# API Contract: `GET /api/usage`

The single server endpoint the dashboard fetches. Implemented as a Next.js App-Router
Route Handler (`frontend/app/api/usage/route.ts`) backed by server-only `lib/usage-log.ts`.
Read-only — it never writes to `usage_log.jsonl`.

## Request

```
GET /api/usage
```

No query parameters in v1 — the endpoint returns all valid records plus a full-log summary;
date-range filtering is applied **client-side** to the returned records (FR-005). (A future
revision MAY accept `from`/`to` to filter server-side; out of scope for v1.)

## Response `200 OK`

`Content-Type: application/json`

```jsonc
{
  "records": [
    {
      "provider": "gemini",
      "model": "gemini-3-flash-preview",
      "input_tokens": 1200,
      "output_tokens": 80,
      "total_tokens": 1280,
      "latency": 0.0,
      "cost": "0.000800",
      "timestamp": "2026-06-26T14:07:59.900565+00:00",
      "usage_complete": true,
      "priced": true,
      "currency": "USD"
    }
    // ... one object per valid line, in file order
  ],
  "summary": {
    "callCount": 7,
    "inputTokens": 4601,
    "outputTokens": 691,
    "totalTokens": 7958,
    "costByCurrency": { "USD": "0.0040280" },
    "pricedCount": 7,
    "unpricedCount": 0,
    "skippedLines": 0,
    "firstTimestamp": "2026-06-26T14:07:59.900565+00:00",
    "lastTimestamp": "2026-06-27T03:30:48.448236+00:00"
  },
  "meta": {
    "source": "../usage_log.jsonl",
    "logPresent": true
  }
}
```

### Field contracts

- `records[]` — every line that parsed AND validated against
  [`usage-record.schema.json`](./usage-record.schema.json), in original file order.
  Malformed/invalid lines are **omitted** here and counted in `summary.skippedLines`.
- `summary` — the `UsageSummary` entity (see `data-model.md`). `costByCurrency` values are
  decimal strings summed only over `priced === true` records (FR-004); keys are distinct
  currencies (FR-011). `totalTokens` sums stored `total_tokens` as-is (FR-010).
- `meta.logPresent` — `false` when the log file does not exist; in that case `records` is
  `[]` and all summary numbers are zero (FR-008).

## Behavioral contract

| Condition | Status | Body |
|-----------|--------|------|
| Log present, ≥1 valid line | `200` | records + computed summary as above |
| Log present, some malformed lines | `200` | valid records only; `skippedLines > 0` |
| Log present, all lines malformed | `200` | `records: []`, zeroed summary, `skippedLines > 0` |
| Log file missing | `200` | `records: []`, zeroed summary, `meta.logPresent: false` |
| Log unreadable (permissions / I/O error) | `500` | `{ "error": "<message>" }` |

Guarantees:
- **Never mutates** the source file (Constitution III).
- A single bad line never fails the request (FR-009 / SC-005).
- Cost figures are never invented: unpriced records contribute `0` to cost (Constitution V).

## Client refresh contract (FR-012)

The dashboard re-fetches `GET /api/usage` on load and on an explicit "Refresh" action, so
newly appended calls appear within one refresh. The Route Handler reads the file fresh on
each request (no long-lived cache); responses set `Cache-Control: no-store`.
