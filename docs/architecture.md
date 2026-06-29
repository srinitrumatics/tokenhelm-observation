# AI Observability Platform (TokenHelm Analytics) — Technical Architecture

This document describes the architecture of the **AI Observability Platform** built on top of the
three ADK demos in this repo. The platform turns every model call made by the agents into a
priced, attributed, replayable **`ObservationEvent`**, then derives cost/prompt/agent/workflow/
session/model analytics, recommendations, and alerts from that single contract.

It spans two halves of the repo that cooperate through one append-only file:

- **Python emitter** (`cost_tracking.py`) — enriches the TokenHelm tracking layer to write
  canonical `ObservationEvent` records.
- **TypeScript analytics platform** (`frontend/`) — a Next.js 15 / React 19 app whose pure `lib/`
  layer reads those records and computes every view.

Spec of record: `specs/002-ai-observability-platform/plan.md` and `tasks.md`. Builds on the shipped
Cost Analytics Dashboard (`specs/001-cost-analytics-dashboard/plan.md`).

---

## 1. High-level dataflow

The platform is a one-directional pipeline from a live model call to a rendered dashboard view.
The `usage_log.jsonl` file is the **contract between the two halves of the repo**: the Python side
appends (write-only), the TypeScript side reads (read-only, never writes).

```text
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PYTHON  (repo root) — the emitter half                                   │
  │                                                                           │
  │   ADK agent turn (single / multi-agent / pipeline)                        │
  │        │  every model response                                           │
  │        ▼                                                                  │
  │   CostTrackingPlugin.after_model_callback   (cost_tracking.py)            │
  │        │  - fold thinking tokens into output (input+output==total)        │
  │        │  - set agent / attribution / tool ContextVars                    │
  │        ▼                                                                  │
  │   TokenHelm.track()  ──prices via pricing.yaml──┐                         │
  │        │                                        │                         │
  │   tokenhelm-prompt dispatcher (per-prompt scope)│                         │
  │        ▼                                        ▼                         │
  │   _sinks: ConsoleLogger + AgentJSONLogger + InMemoryStorage               │
  │        │                                                                  │
  │   build_observation_event(LLMEvent) ── canonical ObservationEvent dict    │
  │        ▼                                                                  │
  └────────┼──────────────────────────────────────────────────────────────────┘
           │ append one JSON line per tracked call
           ▼
   ╔════════════════════════════╗   the cross-repo contract (append-only, additive,
   ║      usage_log.jsonl        ║   backward compatible with the 001 dashboard)
   ╚════════════════════════════╝
           │ read-only, fresh per request
           ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  TYPESCRIPT  (frontend/) — the analytics half                             │
  │                                                                           │
  │   getEventSource()              (lib/observation/source.ts)               │
  │        │  EVENT_SOURCE = jsonl (default) | duckdb                         │
  │        ▼                                                                  │
  │   EventSource.read()            (jsonl-source.ts | db-source.ts)          │
  │        │  per line: JSON.parse → normalize() → ObservationEvent           │
  │        │  dedupe by event_id, sort (timestamp, event_id), skip+count bad  │
  │        ▼                                                                  │
  │   ObservationEvent[]   ── the ONLY domain model ──┐                       │
  │        │                                          │ replay.ts re-derives  │
  │        ▼                                          │ (pure, deterministic) │
  │   analytics/*  (pure functions: overview, prompts, agents, workflows,     │
  │                sessions, models, recommendations, alerts, search, export) │
  │        ▼                                                                  │
  │   app/api/**/route.ts  (thin adapters: select source → aggregate → JSON)  │
  │        ▼                                                                  │
  │   app/page.tsx + pages  (client dashboard, recompute per date range)      │
  └─────────────────────────────────────────────────────────────────────────┘
```

Key files: `cost_tracking.py` (`build_observation_event`, `CostTrackingPlugin`),
`frontend/lib/observation/event.ts`, `frontend/lib/observation/event-source.ts`,
`frontend/lib/observation/jsonl-source.ts`, `frontend/lib/observation/normalize.ts`,
`frontend/lib/observation/replay.ts`, `frontend/lib/analytics/*`, `frontend/app/api/**/route.ts`.

---

## 2. The five locked architectural constraints

These are the locked constraints from the top of
`specs/002-ai-observability-platform/tasks.md` ("Locked architectural constraints"). Each is
enforced by code, not just convention.

### Constraint 1 — `ObservationEvent` is the only domain model

Every aggregator, API route, recommendation, and alert imports only
`frontend/lib/observation/event.ts`. No analytics module reads a storage-specific shape (JSONL line,
DuckDB row, Postgres tuple) directly — that is hidden behind the EventSource seam. The Zod schema
`observationEventSchema` is the single source of truth for the shape, and `normalize()` validates
every produced event against it (`safeParse`) so a malformed event can never reach analytics.

### Constraint 2 — `EventSource` is storage-agnostic

`frontend/lib/observation/event-source.ts` defines the `EventSource` interface
(`read()`/`fingerprint()`/`describe()`) and the `EventReadResult` it returns
(`events`, `skipped`, `duplicates`, `present`, `source`). Three implementations exist:

- `JsonlEventSource` (`jsonl-source.ts`) — the v1 binding over `usage_log.jsonl`.
- `DuckDbEventSource` (`db-source.ts`) — the scale-oriented binding (T059).
- `InMemoryEventSource` (`event-source.ts`) — used for replay/migration tests.

`getEventSource()` (`source.ts`) selects the implementation from the `EVENT_SOURCE` env var.
**All 14 API routes go through the selector**, so the storage backend is swappable with an env var
and zero analytics changes. The DuckDB native binding is imported lazily so the default JSONL path
never loads the native addon.

### Constraint 3 — canonical schema first

The Python emitter writes canonical `ObservationEvent` records directly via
`build_observation_event()` in `cost_tracking.py` — `event_id`, `attribution_status`, ids, status,
metadata are all emitted at write time. The TypeScript `normalize()` (`normalize.ts`) exists
**only for backward compatibility**: it maps legacy 001-era lines (provider/model/tokens/latency/
cost only) into the canonical shape, deriving `attribution_status` as `missing`/`partial` and
synthesizing a content-hash `event_id`. Crucially, the *same* deterministic
`deriveAttributionStatus` rule runs on both sides (`_attribution_status` in Python,
`deriveAttributionStatus` in TS) so canonical and normalized-legacy events agree.

### Constraint 4 — replay is first-class

Because every analytics view is a **pure, deterministic function of `ObservationEvent[]`**, replay
is simply re-reading the immutable source and recomputing — no AI app rerun is ever needed.
`frontend/lib/observation/replay.ts` exposes `replay(source)` (re-derive the event stream) and
`migrate(from)` (copy events into a fresh `InMemoryEventSource`, modelling a storage swap).
Determinism is guaranteed by stable ordering (`sortEvents`: timestamp asc, then `event_id`) and the
absence of wall-clock/randomness in aggregation. The reconcile test asserts that all five identities
survive a `migrate` + `replay` round-trip.

### Constraint 5 — deterministic reconciliation as automated tests

The five reconciliation identities are **automated assertions**, not docs, in
`frontend/lib/__tests__/reconcile.test.ts` using the shared helper
`frontend/lib/__tests__/reconcile.ts` (`assertReconciles` for decimal-exact cost,
`assertTokensReconcile` for integer tokens):

| Identity | Asserted as |
|----------|-------------|
| Σ prompt cost/tokens + unattributed == global | `computePromptLeaderboard` groups + `unattributed` |
| Σ agent root rollups + unattributed == global | `computeAgentLeaderboard` roots (parent/child-aware) + `unattributed` |
| Σ workflow cost/tokens + unattributed == global | `computeWorkflowLeaderboard` groups + `unattributed` |
| Σ model cost/tokens == global | `computeModelAnalytics.models` (no unattributed — every event has a model) |
| Σ provider cost/tokens == global | `computeModelAnalytics.providers` (every event has a provider) |

Cost is compared with `decimal.js` from the original strings (decimal-exact, never floats); tokens
are compared as integers. The agent identity additionally asserts the per-node invariant
`rolled == own + Σ(child rolled)`. The shared fixture `reconcile-events.jsonl` has a known global of
`0.017` USD / 1560 tokens / 7 calls so the test pins exact numbers.

(Constraints 6 — stable identifiers — and 7 — MVP = Phases 1–3 — also appear in the spec; this doc
focuses on the five that shape the runtime architecture.)

---

## 3. The `ObservationEvent` contract

Defined and validated in `frontend/lib/observation/event.ts` (Zod schema), mirrored by the Python
emitter and the JSON contract `contracts/observation-event.schema.json`. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `event_id` | string | Stable unique id; emitted by Python (`uuid4().hex`) or content-hashed for legacy. Dedup key. |
| `timestamp` | ISO string | Parseable date; primary sort key. |
| `provider` | string | e.g. `gemini`. Every event has one → no unattributed provider bucket. |
| `model` | string | e.g. `gemini-3-flash-preview`. Every event has one. |
| `request_id` | string | Groups model round-trips of one user turn (ADK `invocation_id`). |
| `session_id` | string | Session/trace grouping; `unknown` when unresolved. |
| `conversation_id` | string \| null | Optional higher-level grouping. |
| `workflow_id` | string \| null | Workflow grouping (ADK invocation id in the demos). |
| `agent` | string | Producing agent; `unknown` when absent. |
| `parent_agent` | string \| null | Coordinator → sub-agent edge; null = root. The agent tree is derived from these edges + `tool_name`. |
| `prompt` | string | Prompt scope; demos use `agent == prompt`. |
| `prompt_hash` | string \| null | Stable hash for grouping identical prompts. |
| `prompt_version` | string \| null | Enables version regression comparison. |
| `tool_name` | string \| null | Tool whose turn a model round-trip processed. |
| `input_tokens` / `output_tokens` / `total_tokens` | int ≥ 0 | `total_tokens` taken as recorded, never recomputed. |
| `latency_ms` | number ≥ 0 | Canonical ms; legacy `latency` seconds → ×1000 on normalize. |
| `cost` | **string** | Variable-precision decimal string. Summed with `decimal.js`, never parsed to float. |
| `currency` | string | e.g. `USD`. Cost is always tracked per currency. |
| `status` | `success` \| `error` | Drives failure-rate analytics. |
| `attribution_status` | `complete` \| `partial` \| `missing` | Derived, not trusted from input (see below). |
| `environment`, `application_name`, `application_version`, `tenant_id`, `tags[]`, `correlation_id` | optional | Forward-looking operational metadata; reserved now so adding deployment/multi-tenant context later is never a breaking change. |
| `metadata` | record | Carries `priced` (and `legacy` flag for normalized records). |
| `raw` | record | The original record, kept for the JSON inspector. |

**`attribution_status`** is the platform's honesty mechanism. It is derived from the presence of the
three core dimensions — `prompt`, `agent`, `session` — by the same rule on both sides:

- `complete` — all three present → the event belongs to a named entity.
- `missing` — none present (typical of legacy 001 lines).
- `partial` — some present.

No attribution is ever guessed. Analytics use `complete` to decide whether an event joins a named
prompt/agent group or falls into the explicit `unattributed` bucket.

**Money is always a decimal string.** Cost is summed with `decimal.js` from the original strings,
mirroring the backend's `Decimal` use, so totals reconcile to the raw events exactly (SC-001).
`metadata.priced` distinguishes **token-tracked-but-unpriced** events: `isPriced(event)` returns
false when `metadata.priced === false`, in which case the event still counts tokens and calls but
contributes **zero cost** — the same rule the Python backend applies for models missing from
`pricing.yaml`.

---

## 4. The analytics layer (`frontend/lib/analytics/`)

Every analytics module is a pure, framework-agnostic, offline-testable function over
`ObservationEvent[]`. The shared design principle — and the reason reconciliation holds *by
construction* — is that **each module partitions ALL events into named groups plus one explicit
`unattributed` bucket**. An event is placed in a named group only when it is attributable for that
dimension (`attribution_status === "complete"` for prompts/agents; a non-`unknown` id for
sessions/workflows); otherwise it goes to `unattributed`. Nothing is dropped or silently folded into
a named entity.

| Module | Output | Notes |
|--------|--------|-------|
| `overview.ts` | `Overview` = `summary` (KPIs: calls, tokens, cost-by-currency, success/failure rates, priced/unpriced + attributed/unattributed counts, distinct-entity counts) + `costByDay` trend + `byModel` / `byProvider` cost groups. | The reusable primitives `computeSummary`, `computeCostGroups`, `computeCostByDay`, `dominantCurrency`, `filterByRange`, `dayBucket` are shared by other modules. |
| `prompts.ts` | `PromptLeaderboard` (attributed prompts ranked by cost + `unattributed`), `PromptDetail` (executions, per-version stats, trend, attribution breakdown), and deterministic `PromptFlag`s (`expensive`, `high-input-output-ratio`, `high-token-usage`). | Group key = `prompt` when complete, else `unattributed`. Thresholds are relative to the prompt population (2× median). |
| `agents.ts` | `AgentLeaderboard` with own + rolled-up (own + descendants) cost/tokens/calls, the execution tree (`AgentTreeNode`, agents + tool leaves), depth, and `AgentFlag`s. | Hierarchy derived entirely from `parent_agent` edges + `tool_name`; rollups via cycle-safe post-order. Tool cost is part of the agent's own cost, not double-counted in rollups. |
| `sessions.ts` | `SessionExplorer` (per-session summaries + `unattributed` + session analytics) and `computeSession` (chronological `TraceStep[]` with OTel-style `spanId`/`parentSpanId`, framed `TimelineNode[]`). | Ordering from timestamps + `parent_agent`, never UI state. `reconstructTrace` is shared with workflows. |
| `workflows.ts` | `WorkflowLeaderboard` (per-`workflow_id` stats + `unattributed`) and `WorkflowDetail` (trace, execution graph, participation tables, cost/duration trends) + `WorkflowFlag`s. | Built entirely on the session/span + agent-tree models; an "execution" = a distinct session within a workflow. |
| `models.ts` | `ModelAnalytics` = `models[]` + `providers[]` (calls, cost, tokens, latency, success/failure, shares, related entities). | No `unattributed` bucket — every event has a model and provider, so Σ model == Σ provider == global. |
| `recommendations.ts` | `Recommendation[]` (see §5). | Consumer of prompt/agent/workflow flags. |
| `alerts.ts` | `Alert[]` (see §5). | Consumer of the validated aggregators. |
| `search.ts` | `SearchResult[]` — cross-entity substring search over the leaderboards (FR-027, target <500 ms). | A unified index over already-computed leaderboards; a result's metrics equal that entity's leaderboard row. |
| `export.ts` | `ExportTable` (8 views) + RFC-4180 CSV via `toCsv`. | Flattens leaderboard/recommendation/alert rows; no re-derivation. Stable column order so even an empty export emits a header. |

Each leaderboard also returns the global totals (`globalCost`, `globalTokens`, `globalCalls`) it
was computed against, and per-group `costShare`/`tokenShare` — making the partition explicit and the
reconciliation test trivial to write.

---

## 5. Recommendations & Alerts (US6)

Recommendations (`recommendations.ts`) and alerts (`alerts.ts`) are strictly **consumers of the
validated analytics**. They compute **no independent aggregates** — they read the already-tested
leaderboards/flags and re-express them with evidence.

- **Recommendations** map the prompt/agent/workflow `*Flag` types into rich `Recommendation`s
  (category, severity, suggested action, estimated impact, related event ids). `eventsForEntity()`
  is a *lookup* of the backing events, not a new aggregate.
- **Alerts** evaluate spike/degradation/regression rules, each reading an already-tested aggregator
  (`computeCostByDay`, `computeModelAnalytics`, agent/prompt/workflow leaderboards) against a
  named threshold (`SPIKE_FACTOR`, `FAILURE_THRESHOLD`, `LATENCY_FACTOR`, etc.).

**Determinism / replay reproducibility.** Both use deterministic ids and **data-derived
timestamps**:

- Recommendation id = `rec:<source>:<flagType>:<entityType>:<entityId>`; `created_at` = the latest
  related-event timestamp.
- Alert id = `alert:<rule>:<entityType>:<entityId>`; `triggered_at` = the latest related-event
  timestamp.

No wall-clock or randomness enters the computation, so replaying the same event stream reproduces
**identical** recommendations and alerts (both are sorted by id for stable order).

**Alert lifecycle is separated from the event stream.** `computeAlerts` always returns alerts in the
`active` state. Acknowledgement and resolution (`active` → `acknowledged` → `resolved`) live entirely
in a separate store, `frontend/lib/alert-state.ts` (`createAlertStore`, process-wide `alertStore`),
keyed by the deterministic `alert_id`. `apply()` merges the lifecycle overlay onto freshly computed
alerts; resolution is terminal (a late acknowledge cannot downgrade a resolved alert); unknown ids
are tolerated. This store **never mutates `ObservationEvent`s** — the immutable log is never touched.
The `PATCH /api/alerts/{id}/acknowledge` and `.../resolve` routes recompute alerts fresh, confirm the
alert exists, then mutate only the lifecycle store.

---

## 6. Storage scalability

Scalability lives entirely at the **EventSource seam** (constraint 2). Because analytics depend only
on the `EventSource` interface and `ObservationEvent`, the storage backend can change with zero
analytics changes.

- **`JsonlEventSource` (v1, default).** Reads the append-only `usage_log.jsonl`, normalizes every
  line, dedupes, and sorts. Results are cached by a `(size + mtime)` fingerprint, so an unchanged log
  re-reads for free and a changed log triggers a fresh full parse. Read-only by design.
- **`DuckDbEventSource` (T059).** Same interface, backed by a DuckDB table
  `observation_events(event_id, timestamp, doc)` where `doc` is the full canonical JSON. It parses
  and normalizes `doc` exactly as the JSONL path does, so analytics are byte-identical across sinks
  (proven by `lib/__tests__/db-source.test.ts`, SC-014). The native `@duckdb/node-api` module is
  imported lazily, only on `read()`.
- **`getEventSource()` selector.** `EVENT_SOURCE=jsonl` (default) → JSONL; `EVENT_SOURCE=duckdb` →
  DuckDB (lazily required). All API routes go through it.

**Honest scale story.** The current DuckDB v1 still returns the *full* event set through the
interface (it normalizes-once-at-write but does not yet push GROUP BYs into SQL). The benchmark
`frontend/scripts/bench.mjs` (200k synthetic events, linearly extrapolated to 10M) records:

- JSONL full-parse + aggregate in JS: **~22 s / 10M**.
- DuckDB columnar SQL `GROUP BY` (aggregation pushed into SQL): **~5.7 s / 10M**.

So DuckDB already provides a large speedup, but neither path hits the **2 s-at-10M** dashboard
target on its own. Reaching it requires a future **`AggregatingEventSource`** that pushes the
analytics-layer GROUP BYs down into SQL — addable behind the same `EventSource` interface, again
with no changes to the analytics modules. This is stated honestly in T059 and the spec's Performance
Goals: SC-009 (10M events) / SC-010 (100 concurrent) are met via the database EventSource staged
behind the storage interface, not the JSONL path.

---

## 7. API and rendering surface

API routes under `frontend/app/api/**/route.ts` are thin adapters: select an EventSource, read fresh
(`no-store`, `force-dynamic`), run an aggregator, return JSON. They never mutate the source
(Constitution III). The 14 routes cover `overview`, `prompts`, `agents`, `workflows`, `sessions`,
`models`, `recommendations` (+ `[id]`), `alerts` (+ `[id]`, `[id]/acknowledge`, `[id]/resolve`),
`search`, `export`, and the legacy `usage` route. The client dashboard (`app/page.tsx` + the per-
domain pages) fetches once and recomputes each view in-memory per selected date range, keeping the
endpoints storage-agnostic.

---

## 8. Why this design holds together

1. **One contract.** `ObservationEvent` is the only thing analytics know about, so storage, emitter,
   and UI evolve independently.
2. **Partition + explicit unattributed.** Every aggregator covers *all* events, which makes the five
   reconciliation identities true by construction — and they are pinned by automated decimal-exact
   tests.
3. **Purity + determinism.** No aggregator uses wall-clock or randomness, so replay and storage
   migration reproduce identical analytics, recommendations, and alerts.
4. **Honesty over convenience.** Unpriced events count tokens but cost zero; unattributed events are
   shown explicitly; legacy data is normalized, never guessed. The immutable audit trail is never
   mutated — even alert lifecycle lives in a separate store.
