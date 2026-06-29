# Phase 0 Research: AI Observability Platform (TokenHelm Analytics)

This document resolves the unknowns in the plan's Technical Context. Each decision records what was
chosen, why, and the alternatives rejected. Decisions are constrained by the project constitution
(v1.0.0) and the existing two-half repo (Python tracker + Next.js `frontend/`).

---

## D1. Where the aggregation engine and REST API live

**Decision**: Extend the existing Next.js `frontend/` app. The **REST API** is implemented as
App-Router Route Handlers under `frontend/app/api/**`; the **aggregation engine** is pure,
framework-agnostic TypeScript in `frontend/lib/**`. No separate backend service.

**Rationale**: Mirrors the shipped Cost Analytics Dashboard (spec 001), keeps the analytics layer
unit-testable offline (Constitution IV), and avoids standing up a second runtime/service for a
local-first v1. The pure `lib/` core is the tested seam; Route Handlers are thin adapters.

**Alternatives considered**:
- *Separate Python/FastAPI analytics backend* — rejected: adds a second service and deployment
  surface, duplicates the decimal-cost logic that already exists in TS, and splits the analytics
  contract across two languages for no v1 benefit.
- *Client-only (parse log in browser)* — rejected: can't keep file access server-side, won't scale,
  and leaks the storage format to the client (violates "analytics never parse storage directly").

---

## D2. Storage-as-a-sink abstraction (the key architectural seam)

**Decision**: Define an `EventSource` interface that yields normalized `ObservationEvent`s, with a
`JsonlEventSource` as the v1 implementation reading the append-only log. The aggregation engine
depends **only** on `ObservationEvent[]` / the `EventSource` interface — never on a file format.
Additional sinks (DuckDB/SQLite, PostgreSQL, Redis Streams, OpenTelemetry) implement the same
interface later without touching analytics.

**Rationale**: Directly satisfies the user's "storage independent from analytics" requirement
(FR-007a) and makes replay/sink-migration (FR-031, SC-014) a matter of swapping `EventSource`
implementations. The interface is the contract; everything above it is storage-agnostic.

**Alternatives considered**:
- *Hard-code JSONL reads in the API* (status quo of 001) — rejected: couples analytics to one
  format and blocks the multi-sink requirement.
- *Adopt a DB now* — deferred: unnecessary for local-first v1 scale; introduced behind the same
  interface when the 10M/concurrency targets are activated (see D6).

---

## D3. Who emits the ObservationEvent fields (two-sided normalization)

**Decision**: Normalize on **both** sides.
- **Backend (canonical emit)**: replace/extend `AgentJSONLogger` with an `ObservationEvent`
  normalizer in `cost_tracking.py` that stamps `event_id`, `request_id`, `session_id`,
  `conversation_id`, `workflow_id`, `agent`, `prompt`, `prompt_hash`, `prompt_version`, `tool_name`,
  `status`, `attribution_status`, and `metadata` in addition to the existing token/cost/latency
  fields, then writes through the sink(s).
- **Frontend (tolerant normalize)**: a `normalize()` function maps any raw record — new canonical
  records **and** legacy 001-era records — into the `ObservationEvent` model, defaulting absent
  attribution to `attribution_status = "missing"`.

**Rationale**: New events are born canonical; historical `usage_log.jsonl` lines (which carry only
`provider/model/tokens/latency/cost/timestamp/priced/currency [+ optional agent]`) still ingest and
function, marked `missing`. This honors FR-007/FR-030 (backward compatibility) and keeps the platform
useful from day one before/while the emitter is enriched.

**Alternatives considered**:
- *Only enrich the emitter* — rejected: breaks on all existing history until a full re-run.
- *Only normalize in the frontend* — rejected: throws away attribution the backend already knows
  (agent, prompt scope, invocation id), permanently capping `complete` attribution.

---

## D4. Sourcing attribution fields from ADK at emit time

**Decision**: Derive attribution from the ADK callback context the plugin already holds:
- `agent` — `callback_context.agent_name` (already captured today).
- `session_id` / `conversation_id` — from the ADK session/invocation on the callback context.
- `workflow_id` / `request_id` — ADK `invocation_id` (groups the model round-trips of one user turn /
  workflow run).
- `prompt` — the active tokenhelm-prompt scope name (today: the agent name).
- `prompt_hash` — stable hash of the resolved instruction text for that prompt.
- `prompt_version` — optional, read from agent/app metadata when present; else null.
- `tool_name` — captured via the plugin's tool callbacks (ADK `before_tool_callback` /
  `after_tool_callback`) so tool round-trips can be attributed.
- `status` — `success` for a tracked response; failure paths record no usage (see edge cases) and are
  represented as `status = error` only where an error is observable.
- `attribution_status` — `complete` when prompt+agent+session present; `partial` when some are
  missing; `missing` when none.

**Rationale**: Uses ADK-native context (Constitution II) rather than bespoke plumbing, and reuses the
existing contextvar-based, concurrency-safe attribution seam. Keeps the NON-NEGOTIABLE tracking guarantee
intact: attribution is additive metadata layered on the same `after_model_callback` that already fires
for every call.

**Open follow-ups (non-blocking, recorded for tasks)**: exact accessor for session id on the ADK
callback context, and whether tool attribution needs the tool callbacks wired in this change or a
follow-up — both are local additions that must keep `verify_tracking.py` green.

---

## D5. event_id and deduplication

**Decision**: `event_id` is a UUID stamped at emit. Deduplication keys on `event_id`. For **legacy**
records with no `event_id`, the normalizer derives a deterministic synthetic id by hashing the stable
tuple `(timestamp, provider, model, input_tokens, output_tokens, total_tokens, cost, agent)`.

**Rationale**: Real ids make dedup exact (SC-003) for new data; the content-hash fallback prevents
double-counting of replayed/duplicated legacy lines without requiring a backfill. Deterministic by
construction, so replay stays reproducible (SC-014).

**Alternatives considered**:
- *Line-number identity* — rejected: not stable across rotation/migration between sinks.
- *Refuse legacy records without ids* — rejected: violates "zero data loss" (SC-011).

---

## D6. Performance, scale, and the 10M / 100-concurrent targets

**Decision**: v1 ships the `JsonlEventSource` behind a **cached, incrementally-tailed index**: read
the log once into normalized `ObservationEvent[]`, cache keyed by file size+mtime, and on refresh read
only the appended tail (SC-007). Aggregations run over the in-memory index. This comfortably serves the
local-first scale (thousands → low hundreds of thousands of events) within the <2s/<5s targets
(SC-006/SC-007) and search <500ms (SC-008) via prebuilt indexes.

The **10M-event (SC-009)** and **100-concurrent (SC-010)** targets are met by adding a database
`EventSource` (DuckDB/SQLite for embedded columnar scans, or PostgreSQL) behind the **same** D2
interface — no analytics changes. This is documented as a capability staged with that sink, not a
claim about the JSONL path.

**Rationale**: Honesty over hand-waving (Constitution V spirit): a per-request 10M-line JSONL scan
cannot hit 2s, so we don't pretend it does. The sink abstraction is exactly what lets the scale target
be satisfied later without rework, which is the architectural point of this feature.

**Alternatives considered**:
- *Claim JSONL meets 10M* — rejected: false.
- *Build the DB sink in v1* — deferred: out of proportion to local-first Phase 1–3 scope; the
  interface keeps the door open.

---

## D7. Replay and sink migration (FR-031 / SC-014)

**Decision**: Replay = re-running the pure aggregation engine over an `EventSource`. Because
aggregation is a deterministic pure function of `ObservationEvent[]` (no wall-clock, no randomness),
re-deriving over an unchanged source yields byte-identical analytics. Sink migration = stream events
from source `EventSource` A into sink B, then assert aggregates over A and B are equal.

**Rationale**: Makes FR-031 a property of the architecture rather than a bespoke subsystem. Mirrors the
project's offline-verifiability value — replay determinism is asserted in unit tests over fixtures.

---

## D8. Decimal-precise cost (carried from 001)

**Decision**: Continue summing `cost` from the original decimal **strings** with `decimal.js`; never
parse to float in aggregation. Unpriced events (`priced=false`) contribute zero cost but are counted
in token/call totals and flagged.

**Rationale**: Reconciliation-to-the-cent (SC-001) and pricing transparency (Constitution V). Reuses
the proven approach and `lib/aggregate.ts` decimal patterns from 001.

---

## D9. Recommendations & alerts method

**Decision**: Deterministic, explainable rule/threshold logic over the aggregated series (e.g.
baseline-vs-window deltas for spike alerts; repeated high-token `prompt_hash` for cache
recommendations). Every alert/recommendation carries references to the raw events that justify it. No
ML/model calls.

**Rationale**: Keeps outputs reproducible (SC-004/SC-012), offline-verifiable (Constitution IV), and
free of new external dependencies or cost. Estimated savings are computed arithmetically from raw
events, not predicted.

**Alternatives considered**:
- *LLM-as-judge / ML anomaly detection* — rejected for v1: non-deterministic, needs credentials,
  conflicts with offline verifiability and reproducibility guarantees.

---

## D10. UI stack

**Decision**: Reuse the 001 stack — Next.js 15 App Router, React 19, Tailwind, Recharts; Vitest +
React Testing Library for tests. Add new pages/components for prompt, agent, workflow, session, model,
provider, recommendations, and alerts.

**Rationale**: Consistency, zero new framework risk, existing test harness extends naturally.

---

## Resolved unknowns summary

| Unknown | Resolution |
|---------|-----------|
| Analytics/API host | Next.js `frontend/` (Route Handlers + pure `lib/`) — D1 |
| Storage independence | `EventSource` interface; `JsonlEventSource` v1 — D2 |
| Field emission | Two-sided normalize (backend canonical + frontend tolerant) — D3 |
| ADK attribution source | callback context: agent/session/invocation/prompt scope — D4 |
| Dedup identity | `event_id` UUID; content-hash fallback for legacy — D5 |
| 10M / 100-concurrent | Cached JSONL index v1; DB sink behind same interface for scale — D6 |
| Replay determinism | Pure aggregation over immutable `EventSource` — D7 |
| Cost precision | decimal.js over strings; unpriced honest — D8 |
| Recs/alerts | Deterministic rules over aggregates, event-referenced — D9 |
| UI | Reuse 001 stack — D10 |

All NEEDS CLARIFICATION items from Technical Context are resolved. Ready for Phase 1.
