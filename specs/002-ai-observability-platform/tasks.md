---
description: "Task list for AI Observability Platform (TokenHelm Analytics)"
---

# Tasks: AI Observability Platform (TokenHelm Analytics)

**Input**: Design documents from `specs/002-ai-observability-platform/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED (not optional) for this feature. Constitution IV (Offline Verifiability) mandates
that the cost-tracking layer and analytics correctness be verifiable offline; quickstart.md defines
the test scenarios. Test tasks are therefore first-class.

**Organization**: Tasks are grouped by user story. The user-locked 12-step implementation sequence
maps onto these phases: steps 1–5 + base engine/replay → **Foundational (Phase 2)**; steps 6–11 →
**User Story phases (3–8)** in priority order; step 12 → **Polish (Phase 9)**.

## Locked architectural constraints (guide every phase)

1. **`ObservationEvent` is the only domain model** — analytics/APIs/dashboards/recs/alerts operate
   exclusively on it; no module imports a storage-specific schema.
2. **`EventSource` stays storage-agnostic** — `JsonlEventSource` is v1 only; all business logic
   depends on the interface (DuckDB/PostgreSQL/Redis added later without logic changes — T059).
3. **Canonical schema first** — the Python emitter emits canonical `ObservationEvent` directly
   (T011/T012); legacy JSONL normalization (T008) exists only for backward compatibility.
4. **Replay is first-class & foundational** — T010 rebuilds all derived analytics from immutable
   events without rerunning the app; asserted by T015 and `verify_tracking.py` validation #5 (T016).
5. **Deterministic reconciliation as tests** — these identities are automated assertions
   (`assertReconciles()`), not docs: Σ prompt cost + unattributed = global; Σ workflow cost = global;
   Σ provider cost = global; Σ model cost = global; Σ agent rollups = global (parent/child-aware).
   Per-story: T025/T030/T040; consolidated: T063.
6. **Stable identifiers in the canonical schema** — `event_id`, `request_id`, `session_id`,
   `workflow_id`, `prompt_hash`, `prompt_version` (T006 schema, T011 emit).
7. **MVP = Phases 1–3** — Observation Foundation + Canonical Event Pipeline + Cost & Overview.

> **Schema evolution (post-MVP, before US2):** Operational metadata contract added to `ObservationEvent` — `environment`, `application_name`, `application_version`, `tenant_id`, `tags[]`, `correlation_id` (all optional/defaulted; reserved now to avoid future breaking changes). Reflected in event.ts, normalize.ts, the JSON contract, and data-model.md.
>
> **Schema evolution (US3):** reserved `parent_agent` (nullable) added to derive the agent execution tree from ObservationEvent relationships; PromptStats extended with first_seen/last_seen/dominant_model/dominant_provider/average_cost_per_call/average_tokens_per_call/attribution_completeness.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US6 (user-story phases only)
- Exact file paths are included in every task.

## Path Conventions

Two-half repo (per plan.md): Python emitter at repo root (`cost_tracking.py`, `verify_tracking.py`);
analytics platform under `frontend/` (Next.js App Router). Pure logic lives in `frontend/lib/**`;
tests in `frontend/lib/__tests__/**`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding for the new observation + analytics layers (the `frontend/` app
already exists from spec 001).

- [X] T001 Create new source dirs `frontend/lib/observation/` and `frontend/lib/analytics/` and test dir `frontend/lib/__tests__/fixtures/`
- [X] T002 [P] Ensure analytics deps present (recharts, decimal.js, zod) in `frontend/package.json`; install if missing
- [X] T003 [P] Add shared dashboard shell + cross-page nav in `frontend/app/layout.tsx` (links to overview/prompts/agents/workflows/sessions/models/recommendations/alerts)
- [X] T004 [P] Author test fixtures in `frontend/lib/__tests__/fixtures/` — `canonical-events.jsonl`, `legacy-events.jsonl` (001-shape), and `anomaly-events.jsonl` (known cost spike + repeated high-token prompt)
- [X] T005 [P] Document `USAGE_LOG_PATH` (and future `EVENT_SOURCE` selector) in `frontend/.env.local.example`

---

## Phase 2: Foundational (Observation Foundation — Epic 1) ⚠️ BLOCKING

**Purpose**: The canonical `ObservationEvent`, the storage-agnostic `EventSource`, tolerant
normalization, replay, and the enriched Python emitter. Implements user-locked steps 1–5 plus the
base aggregation engine and replay. **No user story can begin until this phase is complete** — every
analytics view consumes `ObservationEvent` produced here.

**Constitution gate (NON-NEGOTIABLE)**: the emitter tasks MUST keep the plugin wired in BOTH run
paths (`run_demo.py` Runner + each package `app=App(...)`), MUST NOT drop a tracked call, and MUST
preserve the thinking-fold (`input + output == total`). `verify_tracking.py` MUST pass.

### Canonical schema (step 2)

- [X] T006 [P] Define `ObservationEvent` TS type + Zod schema in `frontend/lib/observation/event.ts`, mirroring `contracts/observation-event.schema.json` (all fields incl. `attribution_status`, `status`, `metadata`, `raw`; `cost` stays a string)

### EventSource abstraction (step 3)

- [X] T007 [P] Define `EventSource` interface + `EventReadResult` in `frontend/lib/observation/event-source.ts` per `contracts/event-source.md` (read/fingerprint/describe; skipped/duplicates/present)

### Legacy + canonical normalization (step 5)

- [X] T008 Implement `normalize()` in `frontend/lib/observation/normalize.ts` — map legacy 001-shape AND canonical records → `ObservationEvent`; derive `attribution_status` (complete/partial/missing); convert legacy `latency` seconds → `latency_ms`; compute `event_id` (use emitted id; content-hash fallback for legacy) (depends on T006)
- [X] T009 Implement `JsonlEventSource` in `frontend/lib/observation/jsonl-source.ts` — server-only, read-only, dedup by `event_id`/content-hash, skip-and-count malformed, deterministic order (timestamp, event_id), cached tail-refresh keyed by size+mtime (depends on T007, T008)

### Replay (step 6 — first-class)

- [X] T010 [P] Implement `replay.ts` in `frontend/lib/observation/replay.ts` — deterministic re-derivation over an `EventSource` + an in-memory `EventSource` for sink-migration equivalence checks (depends on T007, T008)

### Python emitter (step 4 — TokenHelm + tokenhelm-prompt)

- [X] T011 Enrich the emitter in `cost_tracking.py` to write canonical `ObservationEvent` fields (`event_id`, `request_id`, `session_id`, `conversation_id`, `workflow_id`, `prompt`, `prompt_hash`, `prompt_version`, `status`, `attribution_status`, `metadata`) in addition to existing token/cost/agent fields — sourced from ADK callback context + tokenhelm-prompt scope; keep BOTH seams synced; preserve thinking-fold + `priced=false` honesty
- [X] T012 Wire tool attribution (`tool_name`) via the plugin's ADK tool callbacks in `cost_tracking.py` (depends on T011)

### Base aggregation primitives (step 6)

- [X] T013 [P] Extend decimal-precise aggregation primitives in `frontend/lib/aggregate.ts` to operate on `ObservationEvent` (cost-by-currency from strings, token/call sums, unpriced exclusion)

### Foundational tests (Constitution IV)

- [X] T014 [P] `normalize()` tests in `frontend/lib/__tests__/normalize.test.ts` — legacy→canonical, `attribution_status` derivation, latency conversion, content-hash id stability
- [X] T015 [P] EventSource + replay tests in `frontend/lib/__tests__/event-source.test.ts` — dedup (FR-004/SC-003), skip-and-count, deterministic order, replay determinism + sink-swap equivalence (FR-031/SC-014), cold start. Also create the shared **reconciliation assertion helper** `assertReconciles()` in `frontend/lib/__tests__/reconcile.ts` (decimal-exact Σ-of-groups + unattributed == global), reused by all per-story reconciliation tests and the consolidated T063
- [X] T016 Extend `verify_tracking.py` with the 5 locked validations — (1) cost reconciliation unchanged, (2) prompt attribution 100% accurate, (3) canonical fields emitted correctly + thinking-fold preserved, (4) legacy normalization yields equivalent analytics, (5) replay equals live ingestion (depends on T011, T012)

**Checkpoint**: Canonical events flow end-to-end; `verify_tracking.py` and foundational Vitest green. User stories can begin.

---

## Phase 3: User Story 1 - Reconcilable cost & overview (Priority: P1) 🎯 MVP

**Goal**: Executive KPIs + cost analytics (by day/model/provider) whose totals reconcile exactly to
raw events, with date-range filtering and honest empty/unpriced/unattributed states.

**Independent Test**: Point the app at a fixed fixture set; verify total cost = decimal-exact sum,
calls = N, duplicates counted once, malformed lines skipped-and-reported, unpriced count tokens at
zero cost.

### Tests for User Story 1

- [X] T017 [P] [US1] Overview reconciliation tests in `frontend/lib/__tests__/overview.test.ts` — SC-001 zero discrepancy, FR-008–FR-012, unpriced honesty, missing-vs-zero distinction

### Implementation for User Story 1

- [X] T018 [P] [US1] Overview aggregator in `frontend/lib/analytics/overview.ts` — KPIs (cost/calls/tokens/averages/success+failure rate/entity counts), `costByDay/Model/Provider`, decimal-precise, `unattributedCalls` surfaced (depends on T013)
- [X] T019 [US1] `GET /api/overview` route in `frontend/app/api/overview/route.ts` — selects EventSource, runs aggregator, returns `{summary, breakdowns, meta}` with `skipped/duplicates/unattributedCalls` (no-store) (depends on T009, T018)
- [X] T020 [P] [US1] KPI cards in `frontend/components/kpi/SummaryCards.tsx`
- [X] T021 [P] [US1] Cost trend + breakdown charts in `frontend/components/charts/TrendChart.tsx` and `BreakdownTable.tsx` (Recharts)
- [X] T022 [P] [US1] `EmptyState` in `frontend/components/EmptyState.tsx` — distinguishes cold start (no events) from missing-attribution (counted-but-unattributed)
- [X] T023 [P] [US1] `DateRangeFilter` in `frontend/components/DateRangeFilter.tsx` (drives all views, recompute in-memory)
- [X] T024 [US1] Overview page in `frontend/app/page.tsx` — fetch once, wire filter + KPIs + charts + empty state (depends on T019–T023)

**Checkpoint**: MVP — trustworthy cost/overview from canonical events. Deploy/demo-able.

---

## Phase 4: User Story 2 - Prompt analytics / PromptOps (Priority: P2)

**Goal**: Prompt leaderboard ranked by cost, per-prompt stats (calls/tokens/cost/latency/response
size/output-input ratio), trends, side-by-side comparison, version tracking.

**Independent Test**: With multi-prompt fixtures, leaderboard ranks by cost, each metric = hand
aggregate, Σ per-prompt + unattributed = global total.

### Tests for User Story 2

- [X] T025 [P] [US2] Prompt analytics tests in `frontend/lib/__tests__/prompts.test.ts` — FR-013–FR-016; assert **Σ prompt cost + unattributed == global cost** via `assertReconciles()` (constraint #5)

### Implementation for User Story 2

- [X] T026 [P] [US2] Prompts aggregator in `frontend/lib/analytics/prompts.ts` — leaderboard, stats, per-day trend, comparison, prompt_version grouping (depends on T013)
- [X] T027 [US2] `GET /api/prompts` route in `frontend/app/api/prompts/route.ts` — supports `?prompt=` (compare) and `?trend=1` (depends on T009, T026)
- [X] T028 [P] [US2] Leaderboard + comparison + trend components in `frontend/components/prompts/`
- [X] T029 [US2] Prompts page in `frontend/app/prompts/page.tsx` (depends on T027, T028)

**Checkpoint**: US1 + US2 independently functional.

---

## Phase 5: User Story 3 - Agent analytics (Priority: P3)

**Goal**: Per-agent calls/cost/tokens/latency/tool-invocations/child-executions/failure-rate, plus
coordinator→sub-agent hierarchy with roll-up.

**Independent Test**: With coordinator+sub-agent fixtures (incl. tool round-trips), per-agent totals =
hand aggregates and parent roll-up = own + Σ children.

### Tests for User Story 3

- [X] T030 [P] [US3] Agent analytics tests in `frontend/lib/__tests__/agents.test.ts` — FR-018–FR-019; assert **Σ agent rollups == global cost** respecting parent/child rules (no double-count of children into parent total) via `assertReconciles()` (constraint #5)

### Implementation for User Story 3

- [X] T031 [P] [US3] Agents aggregator in `frontend/lib/analytics/agents.ts` — per-agent metrics, tool invocations, hierarchy roll-up, failure rate (depends on T013)
- [X] T032 [US3] `GET /api/agents` route in `frontend/app/api/agents/route.ts` (depends on T009, T031)
- [X] T033 [P] [US3] `ExecutionGraph` in `frontend/components/ExecutionGraph.tsx` + agent metric components in `frontend/components/agents/`
- [X] T034 [US3] Agents page in `frontend/app/agents/page.tsx` (depends on T032, T033)

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 - Session explorer (Priority: P3)

**Goal**: Reconstruct a full session timeline (user input → agent → prompt → tool → model response →
final response) in chronological order with a raw JSON inspector.

**Independent Test**: With events sharing a session id, the explorer renders steps in timestamp order
and each step exposes its unchanged raw event.

### Tests for User Story 4

- [X] T035 [P] [US4] Session tests in `frontend/lib/__tests__/sessions.test.ts` — FR-021–FR-022 chronological reconstruction, failure flagging

### Implementation for User Story 4

- [X] T036 [P] [US4] Sessions aggregator in `frontend/lib/analytics/sessions.ts` — session list + ordered step reconstruction linking `raw` (depends on T013)
- [X] T037 [US4] `GET /api/sessions` route in `frontend/app/api/sessions/route.ts` — list + `?session=` timeline (depends on T009, T036)
- [X] T038 [P] [US4] `SessionTimeline` + JSON inspector in `frontend/components/SessionTimeline.tsx`
- [X] T039 [US4] Sessions page in `frontend/app/sessions/page.tsx` (depends on T037, T038)

**Checkpoint**: US1–US4 independently functional.

---

## Phase 7: User Story 5 - Workflow, model & provider analytics (Priority: P4)

**Goal**: Workflow duration/cost/success/complexity + execution graph; model and provider comparison
(latency/tokens/cost/throughput/efficiency/error rate).

**Independent Test**: With workflow- and multi-model fixtures, each workflow's and model's/provider's
aggregates = hand values and per-group sums reconcile to global totals.

### Tests for User Story 5

- [X] T040 [P] [US5] Workflow + model tests in `frontend/lib/__tests__/workflows.test.ts` — FR-020, FR-023; assert **Σ workflow cost == global cost**, **Σ provider cost == global cost**, and **Σ model cost == global cost** via `assertReconciles()` (constraint #5)

### Implementation for User Story 5

- [X] T041 [P] [US5] Workflows aggregator in `frontend/lib/analytics/workflows.ts` — duration/cost/success/complexity + graph build (depends on T013)
- [X] T042 [P] [US5] Models aggregator in `frontend/lib/analytics/models.ts` — model + provider comparison (depends on T013)
- [X] T043 [US5] `GET /api/workflows` route in `frontend/app/api/workflows/route.ts` (depends on T009, T041)
- [X] T044 [US5] `GET /api/models` route in `frontend/app/api/models/route.ts` (depends on T009, T042)
- [X] T045 [P] [US5] Workflow graph + model/provider comparison components in `frontend/components/workflows/` and `frontend/components/models/`
- [X] T046 [US5] Workflows page in `frontend/app/workflows/page.tsx` (depends on T043, T045)
- [X] T047 [US5] Models page in `frontend/app/models/page.tsx` (depends on T044, T045)

**Checkpoint**: US1–US5 independently functional.

---

## Phase 8: User Story 6 - Recommendations & alerts (Priority: P5)

**Goal**: Auto-generated, event-referenced optimization recommendations with estimated savings, and
anomaly alerts (cost/latency/token/prompt-explosion/failure spikes) with active/resolved management.

**Independent Test**: The anomaly fixture raises the expected cost-spike alert (naming prompt +
magnitude) and yields a cache/optimize recommendation with an event-derived saving; resolving an
alert changes no raw event.

### Tests for User Story 6

- [X] T048 [P] [US6] Recommendation tests in `frontend/lib/__tests__/recommendations.test.ts` — FR-024, SC-012 event-referenced evidence; deterministic + replay-identical (5 tests)
- [X] T049 [P] [US6] Alert tests in `frontend/lib/__tests__/alerts.test.ts` — FR-025 spike detection (anomaly fixture → 7 alert types), acknowledge/resolve change only lifecycle state, raw events immutable (7 tests). Fixture: `fixtures/anomaly-events.jsonl`

### Implementation for User Story 6

- [X] T050 [P] [US6] Recommendation rules in `frontend/lib/analytics/recommendations.ts` — consumer of existing prompt/agent/workflow flags; deterministic ids; data-derived `created_at`; `related_event_ids` evidence (no independent aggregates)
- [X] T051 [P] [US6] Alert rules in `frontend/lib/analytics/alerts.ts` — baseline/window spike detection over existing aggregators (computeCostByDay/model/agent/prompt/workflow analytics); `related_event_ids`; lifecycle store in `frontend/lib/alert-state.ts` (never mutates events)
- [X] T052 [US6] `GET /api/recommendations` + `GET /api/recommendations/{id}` routes in `frontend/app/api/recommendations/` (depends on T009, T050)
- [X] T053 [US6] `GET /api/alerts`, `GET /api/alerts/{id}`, `PATCH /api/alerts/{id}/acknowledge`, `PATCH /api/alerts/{id}/resolve` routes in `frontend/app/api/alerts/` — PATCH mutates alert state only, never a raw event (verified: log md5 unchanged) (depends on T009, T051)
- [X] T054 [P] [US6] Recommendation + alert components: `components/recommendations/RecommendationCard.tsx`, `components/alerts/AlertCard.tsx`, shared `components/common/SeverityBadge.tsx`
- [X] T055 [US6] Recommendations page in `frontend/app/recommendations/page.tsx` — cards, category + severity filters, estimated impact, evidence (depends on T052, T054)
- [X] T056 [US6] Alerts page in `frontend/app/alerts/page.tsx` — active alerts, history, timeline, severity + entity filters, acknowledge/resolve (depends on T053, T054); nav activated in `app/layout.tsx`

**Checkpoint**: All user stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting capabilities (search, export), performance (step 12), and final validation.

- [X] T057 [P] Cross-entity search in `frontend/lib/analytics/search.ts` + `GET /api/search` route — across prompts/agents/workflows/sessions/models/providers (FR-027, SC-008). Test: `lib/__tests__/search.test.ts`
- [X] T058 [P] Export in `frontend/lib/analytics/export.ts` + `GET /api/export` route — `?view=&format=json|csv` over 8 views, stable headers, RFC-4180 CSV (FR-028). Test: `lib/__tests__/export.test.ts`
- [X] T059 [Step 12] Performance backend: `DuckDbEventSource` in `frontend/lib/observation/db-source.ts` behind the SAME `EventSource` interface; selector `getEventSource()` in `lib/observation/source.ts` via `EVENT_SOURCE`, native dep externalized in `next.config.ts`; ingest CLI `scripts/ingest-duckdb.mjs` + scale benchmark `scripts/bench.mjs`. Test `lib/__tests__/db-source.test.ts` proves byte-identical analytics across JSONL↔DuckDB sinks (SC-014). All 14 API routes now go through the selector. Honest scale (200k bench): JSONL full-parse ~22s/10M; DuckDB SQL GROUP BY ~5.7s/10M — 2s-at-10M needs the future AggregatingEventSource that pushes analytics GROUP BYs into SQL (depends on T007, T008)
- [X] T060 [P] Full validation green: Vitest **116/116**, `npm run typecheck` clean, `npm run build` compiled, `verify_tracking.py` all 5 canonical validations pass — all offline, no API key
- [X] T061 [P] Docs: rewrote `frontend/README.md` (platform pages, EventSource selector, demo) and added an observability-platform section to `CLAUDE.md`; authored `docs/architecture.md`, `docs/api.md`, `docs/event-source-plugin.md`, `docs/deployment.md`
- [X] T062 Backward-compat: 001 dashboard (`/api/usage` + `lib/aggregate.ts`) untouched and still parses the canonical superset records — confirmed by the passing 001 Vitest suite + `verify_tracking.py` validation #4 (legacy/canonical equivalence). `adk web` module-cache restart guidance documented in `docs/deployment.md`
- [X] T063 [P] Consolidated reconciliation invariants test in `frontend/lib/__tests__/reconcile.test.ts` — one shared fixture (`reconcile-events.jsonl`, global 0.017 / 1560), all five identities asserted decimal-exact for cost AND tokens, plus a post-migration replay check (6 tests)

### Polish deliverables (beyond the numbered tasks)

- [X] End-to-end demo `demo/run_demo_e2e.py` — drives the REAL tracking pipeline offline to emit a multi-agent "research-pipeline" trace to `demo/demo_usage_log.jsonl`; verified the dashboard renders agents/recommendations/alerts/search/export over it (translator failure → `failure-spike` alert + critical Reliability recommendation; agent rollup reconciles to global 0.005605)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories**. The Python emitter
  tasks (T011, T012, T016) and the EventSource/normalize/replay tasks (T008–T010) are the spine.
- **User Stories (Phases 3–8)**: all depend on Foundational. After it, they can proceed in parallel
  (different aggregator/route/page files) or sequentially in priority order P1→P5.
- **Polish (Phase 9)**: depends on the user stories it touches; T059 (DB sink) depends only on the
  EventSource interface (T007/T008).

### User Story Dependencies

- **US1 (P1)**: after Foundational. No dependency on other stories. = MVP.
- **US2 (P2)**, **US3 (P3)**, **US4 (P3)**, **US5 (P4)**, **US6 (P5)**: each after Foundational;
  independently testable. They share read-only aggregation primitives (T013) but write separate
  files, so they do not block one another.

### Within Each Story

- Tests → aggregator (lib) → API route → components → page.
- Aggregators (`lib/analytics/*`) before their routes; routes before pages.

### Parallel Opportunities

- Setup: T002–T005 in parallel.
- Foundational: T006, T007, T013 in parallel; T010, T014, T015 in parallel once T008 lands; the
  Python emitter track (T011→T012→T016) runs alongside the TS track.
- Across stories: once Foundational is done, US1–US6 aggregators (T018, T026, T031, T036, T041/T042,
  T050/T051) and their tests are all `[P]` against each other (distinct files).

---

## Parallel Example: Foundational Phase

```bash
# Schema + interface + primitives together:
Task: "T006 ObservationEvent type+Zod in frontend/lib/observation/event.ts"
Task: "T007 EventSource interface in frontend/lib/observation/event-source.ts"
Task: "T013 Decimal aggregation primitives in frontend/lib/aggregate.ts"

# Python emitter track in parallel with the TS track:
Task: "T011 Enrich emitter in cost_tracking.py"
```

## Parallel Example: After Foundational (stories in parallel)

```bash
Task: "T018 Overview aggregator (US1) in frontend/lib/analytics/overview.ts"
Task: "T026 Prompts aggregator (US2) in frontend/lib/analytics/prompts.ts"
Task: "T031 Agents aggregator (US3) in frontend/lib/analytics/agents.ts"
Task: "T036 Sessions aggregator (US4) in frontend/lib/analytics/sessions.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL — emitter + EventSource + normalize + replay,
   `verify_tracking.py` green) → 3. Phase 3 US1 → **STOP & VALIDATE** reconciliation against
   `usage_log.jsonl` → demo. This already supersedes the 001 cost dashboard with canonical events.

### Incremental Delivery

Foundation → US1 (MVP) → US2 → US3 → US4 → US5 → US6, validating each independently. Each story adds a
dashboard surface without breaking prior ones. Polish (search/export/DB sink) last.

### Notes

- `[P]` = different files, no incomplete dependencies.
- Constitution gates live in Foundational: keep BOTH tracking seams synced (T011), preserve
  thinking-fold, and pass the extended `verify_tracking.py` (T016) before claiming the phase done.
- Every aggregate must be reproducible from immutable `ObservationEvent`s — no derived metric becomes
  a source of truth (verified by replay tests T015 and verify_tracking validation #5).
- Commit after each task or logical group; restart `adk web` after the emitter change (T062).
