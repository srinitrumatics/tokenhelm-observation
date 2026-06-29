# Phase 0 Research: Cost Analytics Dashboard

All Technical Context items resolved — no remaining NEEDS CLARIFICATION. Decisions below.

## 1. Framework & language

- **Decision**: Next.js 15 (App Router) + React 19, TypeScript 5.x, Node 20+.
- **Rationale**: User explicitly requested Next.js. App Router gives server-side Route
  Handlers for safe local-file access without standing up a separate backend. TypeScript
  protects the record schema and aggregation math (the correctness-critical path).
- **Alternatives considered**: Vite + React SPA (rejected — no built-in server runtime to
  read the local file securely; would need a separate API); Pages Router (rejected — App
  Router is current default and keeps file I/O server-only by construction).

## 2. How the browser gets log data

- **Decision**: A single `GET /api/usage` Route Handler reads the file server-side via a
  server-only `lib/usage-log.ts`, returning `{ records, summary, meta }`. Client components
  fetch it and do filtering/visualization in the browser. Refresh = re-fetch.
- **Rationale**: Keeps filesystem access on the server (browsers cannot read local files);
  one endpoint satisfies FR-001/FR-012 and supports on-demand refresh. Returning both the
  raw records and a server-computed summary lets the summary render fast while the detail
  table/filters use the records.
- **Alternatives considered**: Read the file in a Server Component and pass props (rejected
  — harder to refresh without a full navigation, and couples data to one page); a websocket
  live feed (rejected — live streaming is explicitly out of scope for v1).

## 3. Locating `usage_log.jsonl`

- **Decision**: Resolve from env var `USAGE_LOG_PATH`, default `../usage_log.jsonl`
  relative to the app's working directory (the `frontend/` folder), pointing at the repo
  root log. Document in `.env.local.example`.
- **Rationale**: The app lives in `frontend/` while the log lives at the repo root; an env
  var keeps the path configurable for other layouts and for tests (point at a fixture).
- **Alternatives considered**: Hardcoded relative path (rejected — brittle, untestable);
  copying the log into the app (rejected — violates Constitution III read-only/authoritative
  -log intent and risks staleness).

## 4. Decimal-precise cost aggregation (SC-002, FR-003)

- **Decision**: Parse each `cost` string with **decimal.js** and sum as Decimal; never use
  JS `number`/`parseFloat` for monetary totals. Display via a formatting helper.
- **Rationale**: Costs are strings with varying precision (e.g. `"0.000800"`,
  `"0.0002410"`); IEEE-754 float addition drifts and would fail the zero-discrepancy
  criterion. Decimal arithmetic on the original strings is exact.
- **Alternatives considered**: Integer micro-dollar/nano-dollar math (works but precision
  of source strings varies up to 7 decimals — fixed scaling is fragile); native float
  (rejected — fails SC-002).

## 5. Reading & parsing the JSONL safely (FR-009, SC-005)

- **Decision**: Read the file as UTF-8 and split into lines; `JSON.parse` each non-empty
  line inside try/catch, then validate with a **Zod** schema. Parse/validation failures are
  pushed to a `skipped` counter (with line number) and excluded; valid records continue.
  For large files, read via a streaming line reader (`readline` over a file stream) so the
  whole file isn't held twice in memory.
- **Rationale**: Per-line isolation means one corrupt line never aborts the view; Zod
  guarantees the downstream aggregator only sees well-typed records. Streaming keeps the 10k
  -record target (SC-004) comfortable.
- **Alternatives considered**: `JSON.parse` of the whole file (invalid — JSONL isn't a JSON
  array); a heavyweight CSV/stream lib (unnecessary for newline-delimited JSON).

## 6. Unpriced records & currency (FR-004, FR-010, FR-011)

- **Decision**: Aggregator counts every valid record's tokens and call count; it adds to the
  cost total **only** when `priced === true`, and groups cost subtotals by `currency` so
  differing currencies are never summed together. Stored `total_tokens` is displayed as-is,
  even when it exceeds `input_tokens + output_tokens`.
- **Rationale**: Directly enforces Constitution V (Pricing Transparency) and the observed
  data reality that `total_tokens` includes folded reasoning tokens.
- **Alternatives considered**: Recompute `total = input + output` (rejected — contradicts
  FR-010 and the tracker's thinking-token folding); convert currencies (rejected — needs FX
  rates, out of scope; flag/separate instead).

## 7. Charting

- **Decision**: **Recharts** for the trend line/area chart and breakdown bar/share charts.
- **Rationale**: React-native, declarative, lightweight, handles time-series and categorical
  breakdowns; good fit for a small dashboard. Time grouping (by hour/day) done in `lib`
  before passing to the chart.
- **Alternatives considered**: Chart.js (imperative, needs refs); D3 direct (more power than
  needed, higher effort); visx (lower-level than warranted for v1).

## 8. Styling

- **Decision**: Tailwind CSS (Next.js first-class setup).
- **Rationale**: Fast to build KPI cards/tables/empty states with consistent spacing; zero
  custom design system needed for a developer tool.
- **Alternatives considered**: CSS Modules (more boilerplate); a component library like MUI
  (heavier than needed).

## 9. Testing strategy

- **Decision**: Vitest unit tests on the framework-agnostic `lib/aggregate.ts` and
  `lib/usage-log.ts` against fixture logs — covering SC-002 (totals == manual sum), FR-004
  (unpriced excluded from cost), FR-009/SC-005 (malformed skipped + counted), FR-008
  (empty/missing), FR-011 (multi-currency). React Testing Library smoke test for the empty
  state. No e2e required for v1.
- **Rationale**: The correctness risk lives in parsing and money math, which are pure
  functions — cheap and deterministic to test offline (Constitution IV value). UI is thin.
- **Alternatives considered**: Playwright e2e (deferred — overkill for a local single-user
  tool); Jest (Vitest is faster and simpler with Vite/TS).

## Resolved unknowns summary

| Unknown | Resolution |
|---------|------------|
| Data delivery to browser | `GET /api/usage` Route Handler + client fetch |
| Log location | `USAGE_LOG_PATH` env, default `../usage_log.jsonl` |
| Monetary precision | decimal.js on raw cost strings |
| Malformed-line policy | per-line try/catch + Zod, count skipped |
| Unpriced / multi-currency | tokens counted, cost gated on `priced`, grouped by currency |
| Charts / styling | Recharts + Tailwind |
| Tests | Vitest on pure lib functions |
