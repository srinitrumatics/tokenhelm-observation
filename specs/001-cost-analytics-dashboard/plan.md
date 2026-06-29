# Implementation Plan: Cost Analytics Dashboard

**Branch**: `001-cost-analytics-dashboard` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-cost-analytics-dashboard/spec.md`

## Summary

A read-only Next.js web app, housed in a `frontend/` folder at the repo root, that turns
the append-only `usage_log.jsonl` audit trail into analytics: headline cost/token totals
(P1), spend/usage trends over time with date-range filtering (P2), and per-model /
per-provider breakdown plus a sortable record-detail table (P3). The app reads the log
server-side via a Next.js Route Handler, parses and validates each line, skips malformed
lines (counting them), aggregates cost with decimal precision (excluding `priced=false`
records from cost but not tokens), and renders the views client-side. It never writes to
the log.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+; Next.js 15 (App Router) with React 19

**Primary Dependencies**: Next.js, React, Tailwind CSS (styling), Recharts (time-series &
breakdown charts), decimal.js (precise monetary aggregation), Zod (per-record schema
validation). Dev: Vitest + React Testing Library (parsing/aggregation correctness).

**Storage**: No database. Single read-only data source — the repo-root `usage_log.jsonl`
(newline-delimited JSON), located via `USAGE_LOG_PATH` env var (default `../usage_log.jsonl`
resolved from the app working directory). The app MUST NOT modify it.

**Testing**: Vitest unit tests for the parser/aggregator (the correctness-critical path —
backs SC-002 zero-discrepancy and SC-005 skip-malformed); React Testing Library for the
summary/empty-state components.

**Target Platform**: Local developer machine; modern evergreen browser; served by
`next dev` (development) or `next build` + `next start`.

**Project Type**: Web application — Next.js front end with server-side Route Handlers for
file access (no separate backend service).

**Performance Goals**: Headline totals visible within 5 s of opening (SC-001); a 10,000-
record log loads and renders in under 3 s on a typical laptop (SC-004).

**Constraints**: Read-only over `usage_log.jsonl` (never mutate — Constitution III);
fully offline, no external/network API calls; decimal-accurate cost totals with zero
discrepancy vs. manual sum (SC-002); honor `priced=false` honestly (Constitution V);
graceful empty/missing-log and malformed-line handling.

**Scale/Scope**: Thousands to ~tens of thousands of records; single local user; ~4 views
(summary, trend, breakdown, detail) in one app.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (v1.0.0) governs the Python ADK demos and their cost-tracking
layer. This feature is an adjacent, read-only **consumer** of that layer's output. Each
principle is evaluated for relevance:

| Principle | Applies? | Assessment |
|-----------|----------|------------|
| I. One Pattern Per Demo | Indirect | This is not an ADK agent demo package, so the one-pattern rule does not constrain it. It is kept as a separate `frontend/` tool and does NOT add incidental complexity to the three demo packages. **PASS** |
| II. Idiomatic ADK First | No | Not ADK/Python code. N/A. |
| III. Universal Cost Tracking (NON-NEGOTIABLE) | Yes | The app is strictly read-only over `usage_log.jsonl`; it touches no plugin wiring and cannot drop a tracked call. The log remains the authoritative append-only record. **PASS** |
| IV. Offline Verifiability | Yes (in spirit) | The app needs no API key and works entirely offline; correctness-critical parsing/aggregation is covered by offline Vitest tests against fixture logs, mirroring the project's offline-verification value. **PASS** |
| V. Pricing Transparency | Yes | The dashboard surfaces `priced=false` records, excludes them from cost totals while counting tokens, and shows stored cost values without inventing figures (FR-004, FR-010). **PASS** |

**Technical Standards alignment**: The app reads the documented log schema (provider,
model, input/output/total tokens, latency, cost, timestamp, usage_complete, priced,
currency) and treats it as stable. It does not require `.venv`, `GOOGLE_API_KEY`, or any
ADK runtime, so those standards do not apply to it.

**Gate result**: PASS — no violations, Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/001-cost-analytics-dashboard/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── usage-record.schema.json   # Per-line record contract
│   └── usage-api.md               # GET /api/usage Route Handler contract
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
frontend/                         # Next.js app (App Router)
├── app/
│   ├── layout.tsx                # Root layout + Tailwind
│   ├── page.tsx                  # Dashboard page (server component shell)
│   └── api/
│       └── usage/
│           └── route.ts          # GET /api/usage — reads + parses log, returns records + summary
├── components/
│   ├── SummaryCards.tsx          # P1 headline KPIs (cost, calls, tokens, unpriced/skipped)
│   ├── TrendChart.tsx            # P2 cost/token time series
│   ├── DateRangeFilter.tsx       # P2 range control (drives all views)
│   ├── BreakdownTable.tsx        # P3 by-model / by-provider groups + share
│   ├── RecordsTable.tsx          # P3 sortable per-record detail
│   └── EmptyState.tsx            # zeroed empty / missing-log state
├── lib/
│   ├── usage-log.ts              # server-only: locate + stream-read jsonl, parse lines
│   ├── schema.ts                 # Zod schema for a usage record (mirrors contract)
│   ├── aggregate.ts              # decimal-precise summary + breakdown + currency grouping
│   └── format.ts                 # cost/token/timestamp display helpers
├── lib/__tests__/
│   ├── aggregate.test.ts         # SC-002 zero-discrepancy, FR-004 unpriced, FR-011 currency
│   └── usage-log.test.ts         # FR-009 skip malformed, FR-008 empty/missing
├── public/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── .env.local.example            # USAGE_LOG_PATH default

usage_log.jsonl                   # EXISTING repo-root data source (read-only, unchanged)
```

**Structure Decision**: A self-contained Next.js App-Router project under `frontend/`,
matching the user's request. File access is isolated in a server-only `lib/usage-log.ts`
exposed through a single `GET /api/usage` Route Handler; client components handle filtering
and visualization. The pure parsing/aggregation logic in `lib/` is framework-agnostic so it
can be unit-tested offline (Constitution IV value) independent of React.

## Complexity Tracking

> No constitution violations — section intentionally empty.
