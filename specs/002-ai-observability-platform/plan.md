# Implementation Plan: AI Observability Platform (TokenHelm Analytics)

**Branch**: `002-ai-observability-platform` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-ai-observability-platform/spec.md`

## Summary

Turn TokenHelm / tokenhelm-prompt events into a unified observability platform built around one
canonical **`ObservationEvent`** contract. Two halves cooperate:

1. **Observation Foundation (Python emit)** — enrich the tracker's emitter so every tracked model
   call is written as a normalized `ObservationEvent` (ids, attribution, status, metadata) through a
   pluggable storage **sink** (`usage_log.jsonl` is the v1 sink). This must preserve the
   NON-NEGOTIABLE "everything is tracked" guarantee and keep `verify_tracking.py` green.
2. **Analytics platform (TypeScript)** — extend the existing Next.js `frontend/` app with an
   `EventSource` storage abstraction, a pure decimal-precise **aggregation engine** over
   `ObservationEvent[]`, a **REST API** (Route Handlers), and dashboards for overview/cost, prompt,
   agent, workflow, session, model/provider, recommendations, and alerts. Analytics depend only on the
   `ObservationEvent` contract — never on a storage format — so JSONL can be swapped for a database
   sink (for the 10M-event / 100-concurrent targets) without analytics changes. Replay is re-deriving
   analytics over the immutable source.

Delivery follows the 8 epics in the spec; Epic 1 (Observation Foundation) is the base for everything.
This plan covers Roadmap Phases 1–3; Epic 8 (enterprise/streaming) is out of scope.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (Next.js 15 App Router, React 19) for the
analytics platform; Python 3.x via the project `.venv` (ADK 2.3.0) for the emitter enrichment.

**Primary Dependencies**:
- *Analytics*: Next.js, React, Tailwind CSS, Recharts (charts/graphs), decimal.js (precise cost),
  Zod (per-record validation). Dev: Vitest + React Testing Library.
- *Emitter*: tokenhelm, tokenhelm-prompt, google-adk (all already pinned); no new runtime deps.

**Storage**: No mandatory database in v1. Canonical source = the TokenHelm event stream; concrete v1
sink = the append-only `usage_log.jsonl`, read behind an `EventSource` interface. Additional sinks
(DuckDB/SQLite, PostgreSQL, Redis Streams, OpenTelemetry) implement the same interface for scale —
not built in this phase. The platform MUST NOT modify the audit trail.

**Testing**: Vitest unit tests for the pure layer — `normalize()` (legacy→ObservationEvent,
attribution_status), `EventSource` reading/dedup/replay determinism, aggregation reconciliation
(zero-discrepancy), recommendation/alert rules; React Testing Library for view/empty states. Python
side: `verify_tracking.py` extended with assertions for the new emitted fields (offline, no API key).

**Target Platform**: Local developer machine; modern evergreen browser; `next dev` / `next build` +
`next start`. Emitter runs in the ADK runtime (`run_demo.py`, `adk web`/`adk run`).

**Project Type**: Web application (Next.js front end + server-side Route Handlers) plus a small,
cross-cutting Python emitter change. No separate backend service.

**Performance Goals**: Main dashboard interactive < 2 s on the target dataset (SC-006); analytics
reflect newly appended events < 5 s (SC-007); search < 500 ms (SC-008). Reconciliation discrepancy =
0 (SC-001). 10M events (SC-009) / 100 concurrent (SC-010) are met via the database `EventSource`
staged behind the storage interface, not the JSONL path (see research D6 — stated honestly).

**Constraints**: Read-only over the event store (Constitution III); analytics never parse a storage
format directly (consume `ObservationEvent` only); decimal-exact cost with `priced=false` honored
honestly (Constitution V); fully offline/no network for analytics correctness (Constitution IV);
emitter change must not drop a tracked call and must keep both run-path seams in sync (Constitution
III + sync-both-seams rule); replay is deterministic (SC-014).

**Scale/Scope**: v1 local-first at thousands → low hundreds of thousands of events; ~10 dashboard
pages; one canonical event contract; 8 epics (7 in scope). Multi-tenant/RBAC/SSO deferred (Epic 8).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution (v1.0.0) governs the Python ADK demos and their cost-tracking layer. Unlike spec
001 (a pure read-only consumer), this feature **also modifies the cost-tracking emitter** (Epic 1),
so the NON-NEGOTIABLE principles apply directly and become hard gates, not N/A.

| Principle | Applies? | Assessment |
|-----------|----------|------------|
| I. One Pattern Per Demo | Indirect | No new ADK demo package is added; the three demos keep their single-pattern shape. The emitter change is to the shared tracking layer, not to a demo's pattern. Analytics live in `frontend/`. **PASS** |
| II. Idiomatic ADK First | Yes (emitter) | Attribution is sourced from ADK-native callback context (agent_name, invocation/session ids) and the existing tokenhelm-prompt scope — not bespoke plumbing. Any deviation must be documented. **PASS (with obligation)** |
| III. Universal Cost Tracking (NON-NEGOTIABLE) | Yes (critical) | The emitter enrichment MUST remain wired in BOTH run paths (`run_demo.py` Runner and each package `app=App(...,plugins=[CostTrackingPlugin()])`) and stay in sync; it MUST NOT drop or skip any tracked call; thinking-token fold (`input+output==total`) MUST be preserved. New `ObservationEvent` fields are additive metadata on the same `after_model_callback`. **PASS only if these hold — enforced by the gate below.** |
| IV. Offline Verifiability | Yes (critical) | `verify_tracking.py` MUST pass after the emitter change and MUST be extended with assertions for the new fields (event_id present, attribution_status correct, legacy normalize). Analytics correctness is covered by offline Vitest. **PASS (with obligation)** |
| V. Pricing Transparency | Yes | Cost stays data-driven from `pricing.yaml`; unpriced models keep `priced=false`, contribute zero cost, are flagged. No invented figures in analytics. **PASS** |

**Technical Standards alignment**: Model stays `gemini-3-flash-preview`; pricing unchanged; the
append-only `usage_log.jsonl` remains non-lossy (new fields are additive; legacy lines still parse).
After any emitter wiring change, `adk web` MUST be restarted (loader caches modules) and
`verify_tracking.py` run before claiming completion (Development Workflow gates).

**Gate result**: PASS — no violations. Three **obligations** carried into design/tasks (not
violations): (a) keep both tracking seams synced and lossless; (b) preserve thinking-fold totals;
(c) extend and pass `verify_tracking.py`. Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/002-ai-observability-platform/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — D1–D10 decisions
├── data-model.md        # Phase 1 output — ObservationEvent contract + derived views
├── quickstart.md        # Phase 1 output — runnable validation scenarios
├── contracts/           # Phase 1 output
│   ├── observation-event.schema.json   # Canonical ObservationEvent contract
│   ├── event-source.md                 # EventSource storage-sink interface contract
│   └── rest-api.md                     # REST API (Route Handler) contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
# ── Epic 1: Observation Foundation (Python emitter enrichment) ──
cost_tracking.py                  # MODIFY: emit normalized ObservationEvent (ids, attribution,
                                  #         status, metadata) through the sink; keep both seams,
                                  #         thinking-fold, priced=false honesty intact
pricing.yaml                      # unchanged (pricing stays data-driven)
verify_tracking.py                # MODIFY: assert new emitted fields (event_id, attribution_status,
                                  #         legacy normalize) — offline gate (Constitution IV)
usage_log.jsonl                   # v1 storage SINK (append-only, additive fields, backward compatible)

# ── Epics 2–7: Analytics platform (Next.js frontend/) ──
frontend/
├── app/
│   ├── layout.tsx                # shared layout + nav across pages
│   ├── page.tsx                  # Overview dashboard (Epic 3): KPIs + cost analytics
│   ├── prompts/page.tsx          # Prompt Analytics / PromptOps (Epic 4)
│   ├── agents/page.tsx           # Agent Analytics (Epic 5)
│   ├── workflows/page.tsx        # Workflow Analytics (Epic 5)
│   ├── sessions/page.tsx         # Session Explorer (Epic 6)
│   ├── models/page.tsx           # Model & Provider Analytics (Epic 5)
│   ├── recommendations/page.tsx  # Recommendations (Epic 7)
│   ├── alerts/page.tsx           # Alerts (Epic 7)
│   └── api/
│       ├── overview/route.ts     # GET /api/overview   — KPIs + cost breakdowns
│       ├── prompts/route.ts      # GET /api/prompts    — leaderboard/stats/trends/compare
│       ├── agents/route.ts       # GET /api/agents     — per-agent + hierarchy
│       ├── workflows/route.ts    # GET /api/workflows  — tracing/graph/cost/duration
│       ├── sessions/route.ts     # GET /api/sessions   — list + reconstructed timeline
│       ├── models/route.ts       # GET /api/models     — model/provider comparison
│       ├── recommendations/route.ts # GET /api/recommendations
│       ├── alerts/route.ts       # GET/PATCH /api/alerts  — list + resolve (no raw mutation)
│       ├── search/route.ts       # GET /api/search     — cross-entity search
│       └── export/route.ts       # GET /api/export     — export analytics view
├── components/
│   ├── kpi/…                     # KPI cards (Epic 3)
│   ├── charts/…                  # Recharts wrappers: trend, breakdown, graph (Epics 3–5)
│   ├── prompts/… agents/… workflows/… sessions/…   # per-epic views
│   ├── SessionTimeline.tsx       # reconstructed session steps + JSON inspector (Epic 6)
│   ├── ExecutionGraph.tsx        # agent/workflow graph (Epic 5)
│   ├── alerts/… recommendations/…
│   └── EmptyState.tsx            # cold-start/empty state
├── lib/
│   ├── observation/
│   │   ├── event.ts              # ObservationEvent type (mirrors contract) + attribution_status
│   │   ├── normalize.ts          # raw record (legacy + canonical) → ObservationEvent
│   │   ├── event-source.ts       # EventSource interface (storage-agnostic)
│   │   ├── jsonl-source.ts       # server-only JsonlEventSource (cached + tail-refresh, dedup)
│   │   └── replay.ts             # deterministic re-derivation helper (FR-031)
│   ├── analytics/
│   │   ├── overview.ts           # KPIs + cost-by-day/model/provider (decimal-precise)
│   │   ├── prompts.ts            # prompt stats/leaderboard/trend/compare/version
│   │   ├── agents.ts             # per-agent stats + hierarchy roll-up
│   │   ├── workflows.ts          # workflow duration/cost/success + graph build
│   │   ├── sessions.ts           # session reconstruction (chronological steps)
│   │   ├── models.ts             # model/provider comparison
│   │   ├── recommend.ts          # deterministic recommendation rules + est. savings
│   │   ├── alerts.ts             # deterministic anomaly/alert rules
│   │   └── search.ts             # cross-entity search index
│   ├── aggregate.ts              # (existing 001 helpers reused/extended for decimal sums)
│   └── format.ts                 # display helpers (reused)
├── lib/__tests__/
│   ├── normalize.test.ts         # FR-005/FR-007: legacy→canonical, attribution_status
│   ├── event-source.test.ts      # FR-004 dedup, FR-031 replay determinism, refresh
│   ├── overview.test.ts          # SC-001 zero-discrepancy, FR-008–FR-012, unpriced honesty
│   ├── prompts.test.ts           # FR-013–FR-016 + per-prompt sums reconcile to global
│   ├── agents.test.ts            # FR-018–FR-019 hierarchy roll-up + failure rate
│   ├── workflows.test.ts         # FR-020 duration/cost/success/graph
│   ├── sessions.test.ts          # FR-021–FR-022 chronological reconstruction
│   ├── recommend.test.ts         # FR-024 + SC-012 event-referenced savings
│   └── alerts.test.ts            # FR-025 spike detection
│   └── fixtures/                 # canonical + legacy + anomaly event fixtures
├── package.json  tsconfig.json  next.config.ts  tailwind.config.ts
└── .env.local.example            # USAGE_LOG_PATH (and future EVENT_SOURCE selector)
```

**Structure Decision**: Keep the two-half repo shape. The Python emitter enrichment lives in the
existing `cost_tracking.py`/`verify_tracking.py` (Epic 1, the canonical-emit side). The analytics
platform extends the existing Next.js `frontend/` app, introducing two pure sublayers under `lib/`:
`observation/` (the `ObservationEvent` model, tolerant `normalize`, the `EventSource` storage seam,
and `replay`) and `analytics/` (one storage-agnostic aggregator per dashboard domain). Route Handlers
under `app/api/**` are thin adapters that select an `EventSource`, run an aggregator, and return JSON;
pages/components render. This isolates the storage-independence and reconciliation guarantees in
offline-testable pure functions, exactly mirroring the proven 001 seam while generalizing it from a
flat `UsageRecord` to the canonical `ObservationEvent`.

## Implementation Sequence (locked-in priorities)

Tasks MUST be generated and ordered to this sequence (user-locked). Each step builds on the prior;
`ObservationEvent` is the only analytics contract throughout (storage formats stay behind
`EventSource`), and every aggregate must remain reproducible from immutable events (no derived metric
becomes a source of truth).

1. **Observation Foundation** — scaffolding for the canonical event + storage seam.
2. **Canonical `ObservationEvent` schema** — TS type + Zod mirror of `contracts/observation-event.schema.json`.
3. **`EventSource` abstraction** — interface + `JsonlEventSource` (read-only, dedup, skip-and-count,
   deterministic order, cached tail-refresh).
4. **Python emitter updates** (TokenHelm + tokenhelm-prompt) — emit canonical `ObservationEvent`
   fields directly (see field list below); keep BOTH run-path seams synced; preserve thinking-fold.
5. **Legacy JSONL normalization** — tolerant `normalize()` mapping legacy lines → `ObservationEvent`
   with `attribution_status = "missing"`; equivalent analytics to canonical.
6. **Analytics engine** — pure decimal-precise aggregators over `ObservationEvent[]` (overview/cost),
   reconciliation invariants, **replay** (`replay.ts`) as a first-class rebuild-from-events capability.
7. **Backend APIs** — Route Handlers per `contracts/rest-api.md` (thin adapters over aggregators).
8. **Next.js dashboard** — overview/cost pages + shared nav, KPI cards, charts, empty state.
9. **Prompt analytics (PromptOps)** — leaderboard/stats/trend/compare/version.
10. **Agent & workflow analytics (AgentOps)** — per-agent + hierarchy; workflow tracing/graph; model/
    provider comparison; session explorer.
11. **Recommendations & alerts** — deterministic, event-referenced rules; search & export.
12. **Performance optimization** — `DbEventSource` (DuckDB/PostgreSQL) behind the SAME `EventSource`
    interface to satisfy SC-009/SC-010, with zero analytics changes.

**Canonical fields the emitter (step 4) MUST produce**: `event_id`, `request_id`, `session_id`,
`provider`, `model`, `agent`, `prompt`, `prompt_hash`, `prompt_version`, `workflow_id` (optional),
`tool_name` (optional), `input_tokens`, `output_tokens`, `total_tokens`, `latency_ms`, `cost`,
`currency`, `attribution_status`, `metadata` (plus `timestamp`, `status`, `raw` per the schema).

**UI honesty rule (carried into steps 8–10)**: the dashboard MUST visually distinguish **missing
attribution** (`attribution_status != complete` — an event we counted but cannot attribute) from
**zero usage** (no events for an entity). The "unattributed" bucket is shown explicitly, never folded
into a named entity and never rendered as if it were absent data. [refines FR-029]

## Verification (extend `verify_tracking.py` — Constitution IV gate)

`verify_tracking.py` MUST be extended to assert all five, offline (no API key):

1. **Cost reconciliation unchanged** — existing token/cost totals and `all_priced` still hold.
2. **Prompt attribution 100% accurate** — per-prompt attribution matches expected (no loss/misattribution).
3. **Canonical fields emitted correctly** — each emitted record carries a valid `event_id`,
   `attribution_status`, and the full canonical field set; `input + output == total` preserved.
4. **Legacy normalization equivalence** — a legacy-shaped record and its canonical equivalent produce
   the same analytics aggregates (cost/tokens/calls).
5. **Replay equals live ingestion** — re-deriving aggregates from the immutable events (replay)
   yields identical results to the in-line ingestion path.

## Complexity Tracking

> No constitution violations — section intentionally empty. The three obligations under Constitution
> III/IV (synced lossless seams, preserved thinking-fold, extended-and-passing `verify_tracking.py`)
> are tracked as mandatory tasks in Phase 2, not as justified violations.
