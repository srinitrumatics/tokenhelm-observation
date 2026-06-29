# Quickstart & Validation: Cost Analytics Dashboard

How to run the analytics app and validate it satisfies the spec. Implementation details
live in `tasks.md` / the code; this is a run-and-verify guide.

## Prerequisites

- Node.js 20+ and npm.
- A repo-root `usage_log.jsonl` (already present; produced by the ADK demos' cost tracker).
- The Next.js app scaffolded in `frontend/` (see `tasks.md`).

## Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # USAGE_LOG_PATH defaults to ../usage_log.jsonl
```

`.env.local` (default):

```bash
USAGE_LOG_PATH=../usage_log.jsonl
```

## Run

```bash
# from frontend/
npm run dev        # http://localhost:3000
# or production:
npm run build && npm run start
```

## Validate against the spec

Each scenario maps to a user story / success criterion. See `contracts/usage-api.md` and
`data-model.md` for the exact shapes referenced below.

### V1 — Headline totals (User Story 1 / SC-001, SC-002)

1. Open `http://localhost:3000`.
2. **Expect** summary cards showing total cost, call count, and input/output/total tokens
   within ~5 s.
3. Cross-check against the raw log:
   ```bash
   # call count
   grep -c . ../usage_log.jsonl
   ```
   **Expect** the displayed totals to equal a manual sum of the records (zero discrepancy).
   The current 7-record sample should total `USD 0.0040280` cost and `7958` total tokens.

### V2 — Unpriced & empty handling (US1 / FR-004, FR-008)

1. Temporarily point at a fixture with a `"priced": false` record
   (`USAGE_LOG_PATH=./fixtures/unpriced.jsonl npm run dev`).
   **Expect** its tokens counted but cost total unchanged, and an "unpriced: N" indicator.
2. Point at a missing path (`USAGE_LOG_PATH=./fixtures/none.jsonl`).
   **Expect** a zeroed empty state, not an error.

### V3 — Malformed lines (FR-009 / SC-005)

1. Point at `./fixtures/mixed.jsonl` containing some corrupt lines.
2. **Expect** valid records still analyzed and a "skipped N lines" indicator; no crash.

### V4 — Trends & date range (User Story 2 / FR-005)

1. With a multi-day log, view the trend chart.
   **Expect** cost/tokens plotted chronologically.
2. Apply a date range that excludes some records.
   **Expect** the chart AND the summary cards update to that range.

### V5 — Breakdown & detail (User Story 3 / FR-006, FR-007, FR-010)

1. View the by-model and by-provider breakdown.
   **Expect** per-group cost/token totals and a share-of-total per group.
2. Open the records table; sort by cost and by timestamp.
   **Expect** rows reorder; each row shows provider, model, input/output/total tokens, cost,
   priced flag, timestamp. Confirm a record where `total_tokens > input + output` displays
   its stored total unchanged.

### V6 — Refresh (FR-012)

1. Append a new line to the log (e.g. run a demo agent, or `echo` a valid record).
2. Click "Refresh" in the app.
   **Expect** the new call reflected in totals within one refresh.

## Automated checks (offline, no API key)

```bash
cd frontend
npm test            # Vitest: aggregation precision (SC-002), unpriced (FR-004),
                    # skip-malformed (FR-009), empty/missing (FR-008), multi-currency (FR-011)
```

These pure-function tests run against fixtures with no network or credentials, mirroring the
project's offline-verification value (Constitution IV).

## Done when

- V1–V6 manual scenarios pass.
- `npm test` is green.
- The source `usage_log.jsonl` is byte-for-byte unchanged after running the app
  (read-only guarantee — Constitution III).
