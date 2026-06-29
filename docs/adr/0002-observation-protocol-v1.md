# ADR 0002 — Observation Protocol v1

- **Status:** Accepted
- **Date:** 2026-06-29
- **Supersedes:** none (formalizes the contract introduced in ADR 0001)
- **Context:** v1.1 Epic 2 (Observation Protocol) + Epic 1 (Observation SDK)

## Context / forces

ADR 0001 established `ObservationEvent` as the canonical contract, but it was defined *inside*
the platform (`frontend/lib/observation/event.ts` + the Python emitter in `cost_tracking.py`).
To grow an ecosystem of producers (SDKs in Python, TypeScript, Go, …) and consumers
(dashboards, Prometheus, Grafana, eval tools), the event shape must be a **language-neutral,
versioned protocol** that any implementation can target independently.

This ADR promotes `ObservationEvent` to **Observation Protocol v1** — the single contract
between producers and consumers — without changing the runtime architecture. It is the
contract the v1.1 SDKs implement.

## Decision

### What an ObservationEvent is

An `ObservationEvent` is the **canonical, immutable record of one model invocation** (one
LLM round-trip), enriched with the attribution context in which it occurred (session, agent,
prompt, workflow, tool). It is the atomic unit every analytics view is derived from. Higher
concepts — sessions, agents, workflows, prompt versions — are *not* separate record types;
they are **derived** from the attribution fields across many events.

### Protocol version

- **Version:** `1.0` (constant `PROTOCOL_VERSION`).
- Producers SHOULD stamp `metadata.protocol_version = "1.0"`.
- The version is the canonical-schema version, independent of any SDK package version.

### Required fields (a valid v1 event MUST carry all of these)

| Field | Type | Notes |
|-------|------|-------|
| `event_id` | string (non-empty) | Stable unique id; the deduplication key. |
| `timestamp` | string | ISO-8601, parseable. Ordering key for trends/sessions. |
| `provider` | string (non-empty) | e.g. `gemini`, `openai`. |
| `model` | string (non-empty) | e.g. `gemini-3-flash-preview`. |
| `request_id` | string (non-empty) | Model round-trip id; defaults to `event_id`. |
| `session_id` | string (non-empty) | Session grouping; sentinel `"unknown"` when absent. |
| `agent` | string (non-empty) | Producing agent; sentinel `"unknown"` when absent. |
| `prompt` | string (non-empty) | Attributed prompt; sentinel `"unknown"` when absent. |
| `input_tokens` | integer ≥ 0 | |
| `output_tokens` | integer ≥ 0 | Includes folded thinking/reasoning tokens. |
| `total_tokens` | integer ≥ 0 | Taken as recorded; never recomputed by consumers. |
| `latency_ms` | number ≥ 0 | Milliseconds. |
| `cost` | string | Decimal string `^[0-9]+(\.[0-9]+)?$`; `"0"` when unpriced. **Never a float.** |
| `currency` | string (non-empty) | e.g. `USD`. |
| `status` | enum | `success` \| `error`. |
| `attribution_status` | enum | `complete` \| `partial` \| `missing` — **derived**, see below. |

### Optional fields (absent ⇒ the documented default)

| Field | Type | Default |
|-------|------|---------|
| `conversation_id` | string \| null | `null` |
| `workflow_id` | string \| null | `null` |
| `parent_agent` | string \| null | `null` (a root agent) |
| `prompt_hash` | string \| null | `null` (producers SHOULD set `ph_<sha256(prompt)[:12]>`) |
| `prompt_version` | string \| null | `null` |
| `tool_name` | string \| null | `null` |
| `environment` | string \| null | `null` |
| `application_name` | string \| null | `null` |
| `application_version` | string \| null | `null` |
| `tenant_id` | string \| null | `null` |
| `tags` | string[] | `[]` |
| `correlation_id` | string \| null | `null` |
| `metadata` | object | `{}` — MUST carry `priced: boolean`; MAY carry `protocol_version`, producer tags. |
| `raw` | object | `{}` — original source record (for the JSON inspector / replay). |

### Derived fields (consumers compute, producers SHOULD pre-compute consistently)

- **`attribution_status`** = `complete` if `prompt`, `agent`, and `session_id` are all
  present (non-empty, not `"unknown"`); `missing` if none are; `partial` otherwise. Producers
  and consumers apply the **same deterministic rule**, so an emitted value always agrees with
  the field presence. No attribution is ever guessed.

### The priced flag (money rule)

`metadata.priced` is the source of truth for whether `cost` should be summed. An **unpriced**
event (`metadata.priced = false`) still counts tokens but contributes **zero** cost. `cost`
is summed with decimal precision from the string — never parsed to a float.

### How producers emit events

1. Maintain attribution context (session → workflow → agent → prompt → tool), ideally via
   context propagation so nested agents/tools inherit it automatically.
2. On each model round-trip, build an event from the current context + the call's
   tokens/cost/latency/status.
3. Derive `attribution_status` and `prompt_hash`; assign `event_id` (UUID) and `request_id`.
4. **Validate against this protocol**, then hand the event to a transport. Producers never
   talk to storage or analytics directly — only the protocol.

### How consumers validate events

Consumers MUST tolerate optional/absent fields (apply the documented defaults) and MUST treat
`raw` and unknown `metadata` keys as opaque pass-through. A consumer reads only the protocol;
it never depends on which producer or transport created the event. The reference consumer is
the platform's `normalize()` (`frontend/lib/observation/normalize.ts`), which accepts both
canonical v1 events and legacy 001-era records.

### Reserved extension points (forward compatibility)

- **`metadata`** (open object) and **`tags`** (string array) — the sanctioned places to add
  producer- or domain-specific context without a schema change.
- The operational fields `environment`, `application_name`, `application_version`,
  `tenant_id`, `correlation_id` are reserved and already in the schema (optional/defaulted).
- New **optional** top-level fields may be added in a later v1.x minor version.

## Compatibility review

- **v1.x guarantee:** required fields and their meanings are stable for the whole `v1.x`
  series. New fields are added only as **optional** (defaulted). An existing field is never
  removed or repurposed within `v1.x`.
- A consumer written against v1.0 keeps working against any v1.x event (it ignores unknown
  optional fields).
- A producer emitting v1.0 events keeps satisfying any v1.x consumer.
- **Breaking the required-field set, an enum, the cost-as-string rule, or the attribution
  rule is a v2.0.0 change** requiring a new ADR and a migration path.
- Preserves the reconciliation gate (cost/token totals reconcile decimal-exact) and replay
  determinism — both unaffected because this ADR only *names and documents* the existing
  shape.

## Rationale

Producers and consumers must agree on one contract for the ecosystem to scale. Pinning the
shape as a versioned protocol — with explicit required/optional/derived/reserved sections and
a v1.x compatibility promise — lets SDKs and connectors be built independently and in parallel
while guaranteeing the platform consumes their output unchanged.

## Consequences

- (+) SDKs (Epic 1) have one precise target; connectors (Epic 3) one precise source.
- (+) The dependency direction is clean: Application → SDK → **Protocol** → ObservationEvent
  → Transport → Platform. Neither side depends on the other beyond the protocol.
- (−) The protocol is now a public contract: changes carry compatibility obligations (by
  design — that is the point of versioning).
- Note: the older JSON-schema draft
  (`specs/002-ai-observability-platform/contracts/observation-event.schema.json`) lists `raw`
  as required; this protocol clarifies `raw` as **optional/defaulted**, matching the
  reference consumer `normalize()` (which defaults it). The protocol definition here is
  authoritative for v1.

## Validation

- The Python SDK (`sdk/python/observation_sdk`) implements this protocol and ships
  `validate()`; its tests assert every emitted event is protocol-valid.
- **Identical-analytics gate:** `frontend/lib/__tests__/sdk-events.test.ts` feeds an
  SDK-emitted JSONL fixture through the platform and asserts 0 skipped + all five
  reconciliation identities (global `0.017` / `1560`) — proving the platform consumes
  SDK-produced events with identical results.
- `verify_tracking.py` continues to pass unchanged (the SDK is an additive producer; the
  in-platform emitter is untouched).
