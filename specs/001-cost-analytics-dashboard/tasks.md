---

description: "Task list for Cost Analytics Dashboard"
---

# Tasks: Cost Analytics Dashboard

**Input**: Design documents from `specs/001-cost-analytics-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Targeted Vitest tests ARE included — the plan and research (§9) call for offline
unit tests on the parser/aggregator, which is the correctness-critical path backing SC-002,
FR-004, FR-008, FR-009, FR-011 and the project's offline-verification value (Constitution IV).
UI is kept thin and is validated via `quickstart.md` rather than e2e tests.

**Organization**: Tasks are grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves (US1, US2, US3)
- All paths are relative to the repo root; the app lives in `frontend/`.

## Path Conventions

Web app (Next.js App Router) under `frontend/`: `frontend/app/`, `frontend/components/`,
`frontend/lib/`, tests in `frontend/lib/__tests__/`. Data source is the **read-only**
repo-root `usage_log.jsonl` (never modified).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the Next.js project and tooling.

- [X] T001 Scaffold a Next.js 15 App-Router app with TypeScript and Tailwind in `frontend/` (`app/`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `package.json`)
- [X] T002 [P] Add runtime deps (`recharts`, `decimal.js`, `zod`) and dev deps (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`) to `frontend/package.json`
- [X] T003 [P] Configure Vitest in `frontend/vitest.config.ts` (jsdom env, path alias) and add `"test": "vitest run"` script to `frontend/package.json`
- [X] T004 [P] Create `frontend/.env.local.example` with `USAGE_LOG_PATH=../usage_log.jsonl` and document it in code comments

**Checkpoint**: `npm run dev` serves an empty app; `npm test` runs (no tests yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data layer + API + app shell that ALL user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Define the Zod `UsageRecord` schema in `frontend/lib/schema.ts`, mirroring `specs/001-cost-analytics-dashboard/contracts/usage-record.schema.json` (string `cost`, `total_tokens` not recomputed, required fields)
- [X] T006 [P] Implement display helpers in `frontend/lib/format.ts` (format cost from decimal string, token counts, ISO timestamps)
- [X] T007 Implement the server-only log reader in `frontend/lib/usage-log.ts`: locate the file via `USAGE_LOG_PATH` (default `../usage_log.jsonl`), stream lines, `JSON.parse` + Zod-validate each, return `{ records, skippedLines, logPresent }`; skip malformed lines without throwing (depends on T005)
- [X] T008 Implement the base summary aggregator `computeSummary()` in `frontend/lib/aggregate.ts` using `decimal.js`: token totals, `costByCurrency` over `priced===true` only, `pricedCount`/`unpricedCount`, first/last timestamp (depends on T005, T006)
- [X] T009 Implement the `GET /api/usage` Route Handler in `frontend/app/api/usage/route.ts` returning `{ records, summary, meta }` per `contracts/usage-api.md`, with `Cache-Control: no-store` and `500` on I/O error; never writes the file (depends on T007, T008)
- [X] T010 [P] Create the root layout and Tailwind globals in `frontend/app/layout.tsx` and `frontend/app/globals.css`
- [X] T011 Implement the client data hook `useUsage()` in `frontend/lib/useUsage.ts` that fetches `/api/usage` and exposes `records`, `summary`, `meta`, loading/error state, and a `refresh()` (depends on T009)
- [X] T012 Create the dashboard page shell in `frontend/app/page.tsx` that calls `useUsage()` and lays out placeholder sections for summary/trend/breakdown/records (depends on T011)

**Checkpoint**: The app loads, fetches real log data, and renders raw counts — story UI can now be built.

---

## Phase 3: User Story 1 - See total spend and usage at a glance (Priority: P1) 🎯 MVP

**Goal**: Headline totals (cost, calls, input/output/total tokens) with unpriced/skipped
visibility and a graceful empty state.

**Independent Test**: Open the app against the sample log; the displayed totals equal a
manual sum (7 records → `USD 0.0040280`, `7958` total tokens); a missing log shows a zeroed
empty state.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [X] T013 [P] [US1] Create test fixtures in `frontend/lib/__tests__/fixtures/` (`valid.jsonl`, `unpriced.jsonl`, `mixed.jsonl` with malformed lines, `empty.jsonl`)
- [X] T014 [P] [US1] Unit-test `computeSummary()` in `frontend/lib/__tests__/aggregate.test.ts`: totals equal manual sum with zero discrepancy (SC-002), unpriced excluded from cost but tokens counted (FR-004), stored `total_tokens` used as-is even when > input+output (FR-010)
- [X] T015 [P] [US1] Unit-test the reader in `frontend/lib/__tests__/usage-log.test.ts`: malformed lines skipped and counted (FR-009/SC-005); missing file → `logPresent:false`, empty records (FR-008)

### Implementation for User Story 1

- [X] T016 [P] [US1] Build the `EmptyState` component in `frontend/components/EmptyState.tsx` (zeroed/missing-log message)
- [X] T017 [US1] Build the `SummaryCards` component in `frontend/components/SummaryCards.tsx` showing total cost (per currency), call count, input/output/total tokens, and unpriced + skipped-line indicators
- [X] T018 [US1] Wire `SummaryCards` + `EmptyState` into `frontend/app/page.tsx` and add a "Refresh" button calling `refresh()` (FR-012)

**Checkpoint**: MVP — totals are correct and visible; empty/unpriced/skipped handled. Fully demoable.

---

## Phase 4: User Story 2 - Understand spending and usage over time (Priority: P2)

**Goal**: Time-based trend chart of cost/tokens with a date-range filter that drives all views.

**Independent Test**: Load a multi-day log; the trend plots chronologically; applying a date
range updates both the chart and the summary cards.

### Tests for User Story 2 ⚠️

- [X] T019 [P] [US2] Unit-test trend bucketing and range filtering in `frontend/lib/__tests__/trend.test.ts`: chronological buckets, granularity selection, and that a range narrows both summary and trend (FR-005)

### Implementation for User Story 2

- [X] T020 [P] [US2] Add `computeTrend()` + `chooseBucketGranularity()` (hour vs day from span) and a range-filter helper to `frontend/lib/aggregate.ts`
- [X] T021 [P] [US2] Build the `DateRangeFilter` component in `frontend/components/DateRangeFilter.tsx`
- [X] T022 [US2] Build the `TrendChart` component in `frontend/components/TrendChart.tsx` using Recharts (cost + tokens over buckets) (depends on T020)
- [X] T023 [US2] Wire date-range state into `frontend/app/page.tsx` so the filter recomputes `SummaryCards` and `TrendChart` from the in-memory records (depends on T020, T021, T022)

**Checkpoint**: US1 + US2 both work independently; spend-over-time is explorable.

---

## Phase 5: User Story 3 - Break down and inspect usage by attribute (Priority: P3)

**Goal**: Per-model and per-provider breakdown with share-of-total, plus a sortable
record-detail table.

**Independent Test**: Load a log with multiple models/providers; breakdown groups totals
with correct shares; the detail table lists every record and sorts by cost and timestamp.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Unit-test `computeBreakdown()` in `frontend/lib/__tests__/breakdown.test.ts`: per-model/provider cost+token totals and shares (FR-006), and cost kept separate per currency (FR-011)

### Implementation for User Story 3

- [X] T025 [P] [US3] Add `computeBreakdown(dimension)` (group by model/provider, per-group cost/token totals, token/cost share, currency-grouped) to `frontend/lib/aggregate.ts`
- [X] T026 [P] [US3] Build the `RecordsTable` component in `frontend/components/RecordsTable.tsx`: sortable by cost and timestamp, showing provider, model, input/output/total tokens, cost, priced flag, timestamp; display stored total as-is (FR-007, FR-010)
- [X] T027 [US3] Build the `BreakdownTable` component in `frontend/components/BreakdownTable.tsx` (model + provider groups with shares) (depends on T025)
- [X] T028 [US3] Wire `BreakdownTable` + `RecordsTable` into `frontend/app/page.tsx`, respecting the active date range (depends on T026, T027)

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Performance, guarantees, and validation across stories.

- [X] T029 [P] Add a 10,000-record fixture and verify the app loads/renders it in under 3 s (SC-004) in `frontend/lib/__tests__/perf.test.ts`
- [X] T030 Verify the read-only guarantee: confirm `usage_log.jsonl` is byte-for-byte unchanged after running the app and the API (Constitution III)
- [X] T031 [P] Write `frontend/README.md` with run + validate instructions (mirrors `quickstart.md`)
- [X] T032 Run the full `quickstart.md` V1–V6 validation scenarios and confirm `npm test` is green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational. US1 → US2 → US3 by priority, or
  in parallel if staffed (they touch mostly separate component files; the shared
  `frontend/lib/aggregate.ts` is edited additively in T020/T025, so sequence those edits).
- **Polish (Phase 6)**: After the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on other stories — the MVP.
- **US2 (P2)**: After Foundational. Independently testable; reuses the same fetched records.
- **US3 (P3)**: After Foundational. Independently testable; reuses the same fetched records.

### Within Each User Story

- Tests written first and failing → then implementation.
- `aggregate.ts` helper (T020/T025) before the component that consumes it.
- Components before the page-wiring task that integrates them.

### Parallel Opportunities

- Setup: T002, T003, T004 in parallel after T001.
- Foundational: T005, T006, T010 in parallel; then T007/T008 → T009 → T011 → T012.
- US1: T013/T014/T015 (tests) in parallel; T016 parallel with them; T017 then T018.
- US2: T019/T020/T021 in parallel; T022 then T023.
- US3: T024/T025/T026 in parallel; T027 then T028.
- Across stories: with multiple devs, US1/US2/US3 can proceed in parallel once Phase 2 is done.

---

## Parallel Example: User Story 1

```bash
# Tests + fixtures + empty-state for US1 together (different files):
Task: "Create test fixtures in frontend/lib/__tests__/fixtures/"
Task: "Unit-test computeSummary() in frontend/lib/__tests__/aggregate.test.ts"
Task: "Unit-test reader in frontend/lib/__tests__/usage-log.test.ts"
Task: "Build EmptyState component in frontend/components/EmptyState.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup.
2. Phase 2: Foundational (blocks everything).
3. Phase 3: User Story 1.
4. **STOP and VALIDATE**: totals match a manual sum; empty/unpriced/skipped handled.
5. Demo the MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → demo (MVP: at-a-glance cost/tokens).
3. US2 → validate → demo (trends + date range).
4. US3 → validate → demo (breakdown + record detail).
5. Polish (perf, read-only check, quickstart).

### Parallel Team Strategy

After Phase 2, Developer A takes US1, B takes US2, C takes US3; coordinate edits to the
shared `frontend/lib/aggregate.ts` (additive functions) to avoid conflicts.

---

## Notes

- [P] = different files, no incomplete dependencies.
- The source `usage_log.jsonl` is read-only — no task writes to it (Constitution III).
- Cost is aggregated with `decimal.js` from the original strings — never floats (SC-002).
- Unpriced records contribute tokens but never invented cost (Constitution V / FR-004).
- Commit after each task or logical group; stop at any checkpoint to validate.
