# Phase 1 Data Model: AI Observability Platform

The platform has exactly **one canonical entity** — `ObservationEvent` — that is persisted/ingested.
Everything else is a **derived view** computed by the aggregation engine from a stream of
`ObservationEvent`s. Derived views are never stored as source of truth; they are reproducible from
events (FR-006, FR-031, SC-004).

```text
ObservationEvent[]  ──(pure aggregation)──▶  PromptExecution / AgentExecution / WorkflowExecution
                                             / Session / Model / Provider / Recommendation / Alert
```

---

## 1. ObservationEvent (canonical, immutable)

The normalized record of one model invocation and the single contract every analytics module
consumes. See `contracts/observation-event.schema.json` for the machine-readable schema.

| Field | Type | Req? | Notes / validation |
|-------|------|------|--------------------|
| `event_id` | string | yes | Stable unique id; dedup key. Legacy records get a deterministic content-hash id (research D5). |
| `timestamp` | string (ISO-8601) | yes | Parseable date; ordering key for trends/sessions. |
| `provider` | string | yes | Non-empty (e.g. `gemini`). |
| `model` | string | yes | Non-empty. |
| `request_id` | string | yes | Underlying model request/round-trip id (ADK invocation-derived). |
| `session_id` | string | yes | Session/conversation grouping. Legacy → `"unknown"` + `attribution_status` reflects it. |
| `conversation_id` | string \| null | no | Finer thread within a session. |
| `workflow_id` | string \| null | no | Workflow/invocation grouping. |
| `agent` | string | yes | Producing agent; legacy default `"unknown"`. |
| `parent_agent` | string \| null | no | Parent agent in the execution hierarchy (coordinator → sub-agent); null for a root. Agent tree derives from these edges + `tool_name`. |
| `prompt` | string | yes | Attributed prompt (tokenhelm-prompt scope); legacy default `"unknown"`. |
| `prompt_hash` | string \| null | no | Hash of resolved prompt text; groups identical prompts. |
| `prompt_version` | string \| null | no | Tracked prompt version (regression detection). |
| `tool_name` | string \| null | no | Tool invoked on this round-trip, if any. |
| `input_tokens` | integer ≥ 0 | yes | Prompt tokens. |
| `output_tokens` | integer ≥ 0 | yes | Includes folded thinking tokens (project rule). |
| `total_tokens` | integer ≥ 0 | yes | As recorded; may exceed input+output upstream. |
| `latency_ms` | number ≥ 0 | yes | Observed latency. Legacy `latency` (seconds) is converted on normalize. |
| `cost` | string (decimal) | yes | Decimal string; summed with decimal.js. `0` when unpriced. |
| `currency` | string | yes | Non-empty (e.g. `USD`). |
| `status` | enum | yes | `success` \| `error`; default `success` for a tracked response. |
| `attribution_status` | enum | yes | `complete` \| `partial` \| `missing` (derived — see rule below). |
| `environment` | string \| null | no | Deployment env (development/staging/production/…). Operational metadata contract. |
| `application_name` | string \| null | no | Instrumented application name. |
| `application_version` | string \| null | no | Instrumented application version. |
| `tenant_id` | string \| null | no | Tenant id for multi-tenant deployments. |
| `tags` | string[] | no | Free-form labels for filtering/grouping (default []). |
| `correlation_id` | string \| null | no | Cross-system correlation id for distributed tracing. |
| `metadata` | object | no | Open key/value bag; carried through uninterpreted. |
| `raw` | object | yes | Original source record, preserved for the JSON inspector & replay. |

> **Operational metadata contract** (`environment`…`correlation_id`): reserved in the schema now so
> adding deployment/multi-tenant/correlation context later is never a breaking change. All optional;
> emitters MAY populate them, analytics default absent values to null/[] and keep functioning.

**`attribution_status` derivation rule** (deterministic):
- `complete` — `prompt`, `agent`, and `session_id` are all present and not the `"unknown"` sentinel.
- `missing` — none of `prompt`/`agent`/`session_id` is present (all sentinel/absent).
- `partial` — otherwise (some present, some absent).

**Immutability & precision invariants**:
- The source store is never mutated by the platform (Constitution III).
- `cost` stays a string end-to-end; aggregation uses decimal.js (Constitution V; SC-001).
- Unpriced events (`cost == "0"` with a stored unpriced flag in `raw`/`metadata`) count tokens/calls
  but contribute zero cost and are flagged.

---

## 2. Derived views (computed, not stored)

Each is produced by a pure aggregator in `lib/analytics/**` over a filtered `ObservationEvent[]`. The
sum of any partitioned breakdown (per-prompt, per-agent, …) **plus the `unattributed` bucket** equals
the global total (reconciliation property, asserted in tests).

### PromptExecution (Epic 4)
Group key: `prompt` (+ `prompt_version` when present). Fields: `calls`, `inputTokens`,
`outputTokens`, `totalTokens`, `costByCurrency`, `avgLatencyMs`, `avgResponseSize`,
`outputInputRatio`, `trend[]` (per-day cost/tokens). Comparison = two or more PromptExecutions side
by side. Unattributed prompts grouped under an explicit `unattributed` key (FR-016).

### AgentExecution (Epic 5)
Group key: `agent`. Fields: `calls`, `cost`, `tokens`, `avgLatencyMs`, `toolInvocations`,
`childExecutions`, `failureRate` (errors ÷ attempts). Hierarchy: parent→children edges with rolled-up
totals (parent total = own + Σ children).

### WorkflowExecution (Epic 5)
Group key: `workflow_id`. Fields: `durationMs` (last−first timestamp), `cost`, `successRate`,
`avgLatencyMs`, `complexity` (e.g. distinct steps/agents/tools), `graph` (nodes/edges of the
execution). 

### Session (Epic 6)
Group key: `session_id`. A chronological reconstruction: ordered `steps[]` (user input → agent →
prompt → tool → model response → final response), each step linking its `ObservationEvent.raw` for the
JSON inspector. Failed steps flagged via `status`.

### Model / Provider (Epic 5)
Group key: `model` / `provider`. Fields: `avgLatencyMs`, `avgTokens`, `avgCost`, `throughput`,
`tokenEfficiency` (output ÷ total), `errorRate`. Supports cross-group comparison.

### Recommendation (Epic 7)
Derived suggestion: `{ type, target (prompt/agent/workflow/model), rationale, estimatedSaving (decimal,
computed from events), evidenceEventIds[] }`. Types: reduce-prompt-size, switch-model, cache-repeated,
remove-redundant, optimize-workflow.

### Alert (Epic 7)
Detected anomaly: `{ id, type, severity, entityType, entityId, magnitude, detectedAt, status
(active|resolved), evidenceEventIds[] }`. Types: cost-spike, latency-spike, token-spike,
prompt-explosion, failure-spike. Resolving an alert changes only alert state — never a raw event
(FR-026).

### PromptVersion (Epic 4, Phase 3)
`{ prompt, version, prompt_hash, firstSeen, metricsByWindow }` — enables regression comparison across
versions when version metadata is emitted (FR-017).

---

## 3. Cross-cutting invariants (tested)

- **Reconciliation** (decimal-exact; automated via `assertReconciles()`, not just documented): [SC-001]
  - Σ prompt cost + unattributed == global cost
  - Σ workflow cost == global cost
  - Σ provider cost == global cost
  - Σ model cost == global cost
  - Σ agent rollups == global cost (parent total = own + Σ children; children not double-counted)
- **No double counting**: dedup by `event_id` (or content-hash for legacy). [SC-003]
- **Zero loss**: every source event is counted or explicitly reported as skipped/unattributed. [SC-011]
- **Replay determinism**: aggregation is a pure function of `ObservationEvent[]` — identical input ⇒
  identical output; sink swap ⇒ identical analytics. [SC-014, FR-031]
- **Attribution fidelity**: no attributed event is lost or misattributed; absent attribution surfaces
  as `missing`/`partial`, never guessed. [SC-002, FR-016]
