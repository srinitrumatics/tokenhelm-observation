# Feature Specification: AI Observability Platform (TokenHelm Analytics)

**Feature Branch**: `002-ai-observability-platform`

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "AI Observability Platform using TokenHelm & tokenhelm-prompt — an enterprise-grade observability layer that turns immutable TokenHelm / tokenhelm-prompt events into operational intelligence: prompt, agent, workflow, session, model, provider, and cost analytics, plus recommendations and alerts."

## Overview

Today the repository ships a read-only Cost Dashboard that aggregates `usage_log.jsonl` into
cost/token analytics. This feature elevates that into a unified **observability platform**: the
single place where anyone running TokenHelm-instrumented AI applications can answer "which prompt
costs the most?", "which agent caused the token spike?", "which workflow is slow?", and "which
session failed?" — with every number traceable back to immutable raw events.

The platform is grounded by one hard invariant from the project constitution and the user's design
principles: **TokenHelm events are the canonical source of truth, raw events are immutable, and
every displayed metric must be reproducible from those raw events.** The platform reads and derives;
it never mutates the audit trail.

**Canonical events, pluggable storage.** The source of truth is the stream of TokenHelm /
tokenhelm-prompt events, normalized into a single `ObservationEvent` contract — *not* any one file.
`usage_log.jsonl` becomes one storage **sink** produced by the dispatcher, alongside future sinks
(PostgreSQL, Redis Streams, OpenTelemetry, etc.). Every analytics module consumes the normalized
`ObservationEvent` model and never parses a storage format directly, so storage can change without
touching the analytics layer. The canonical pipeline is:

> Application → TokenHelm → tokenhelm-prompt → Dispatcher → Normalizer → Immutable Event Store →
> Aggregation Engine → REST API → Next.js Dashboard

## Clarifications

### Session 2026-06-29

The following decisions were resolved by informed default (see **Assumptions**) rather than blocking
questions, because the existing repository architecture and constitution establish reasonable
defaults:

- **Deployment model**: v1 is local-first / self-hosted and read-only over the immutable event
  store (extending the existing `frontend/` dashboard approach). Hosted multi-tenant SaaS, RBAC,
  SSO, and billing are explicitly deferred (see *Out of Scope*).
- **Attribution data dependency**: prompt/agent/workflow/session analytics require the audit trail
  to carry attribution fields (prompt name, agent name, session id, workflow/invocation id). The
  current `usage_log.jsonl` carries only `provider/model/tokens/cost/latency/timestamp`. Enriching
  the emitted event with attribution metadata is therefore an in-scope precondition, and events that
  lack attribution MUST still be ingested and counted as "unattributed" (backward compatibility).
- **Scope bounding**: this spec covers Roadmap **Phases 1–3** (ingestion, overview/cost/prompt,
  agent/workflow/session/model/provider, recommendations/alerts). Phases 4–5 (streaming,
  OpenTelemetry/Grafana/Prometheus/Langfuse integrations, multi-tenant SaaS, RBAC/SSO/billing/audit)
  are out of scope for this spec.

### Session 2026-06-29 (architecture refinement)

Following spec review, three foundational architectural decisions were adopted and supersede the
weaker "attribution as optional enrichment" framing above:

- **Canonical event model**: A single normalized `ObservationEvent` contract is the foundation every
  analytics module consumes. The aggregation engine operates on this model, never on a storage format
  directly. See the **ObservationEvent** key entity for the field contract.
- **Storage as a sink**: TokenHelm events (not `usage_log.jsonl`) are canonical. JSONL is one
  dispatcher-produced storage sink; the design must allow additional sinks (PostgreSQL, Redis
  Streams, OpenTelemetry) without changing analytics.
- **Attribution is first-class, not optional**: Every event carries an `attribution_status` of
  `complete`, `partial`, or `missing`. Events lacking attribution are ingested successfully, marked
  `missing`, and reported clearly; the platform keeps functioning with them present.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reconcilable cost & overview at a glance (Priority: P1)

A FinOps owner or engineering manager opens the platform and immediately sees executive KPIs (total
cost, total calls, total tokens, averages, success/failure rate) and cost analytics broken down by
day, model, and provider. Every total reconciles **exactly** to the underlying raw events, so the
numbers can be trusted for budgeting and chargeback.

**Why this priority**: Cost visibility is the foundational value and the reason the existing
dashboard exists. It is the minimal viable slice: ingest immutable events, deduplicate, aggregate,
and display reconcilable totals. Nothing else can be trusted until totals match raw events.

**Independent Test**: Point the platform at a fixed set of raw TokenHelm events (a sample
`usage_log.jsonl`), and verify the displayed total cost, call count, and token count equal a
hand-computed sum of those events to the cent, with duplicate lines counted once and malformed lines
skipped-but-reported.

**Acceptance Scenarios**:

1. **Given** a raw event log with N valid events, **When** the user opens the overview, **Then** the
   displayed total cost equals the decimal-exact sum of the events' cost strings and total calls
   equals N.
2. **Given** a log containing duplicate event records, **When** ingestion runs, **Then** each unique
   event is counted exactly once and the duplicate count is surfaced.
3. **Given** a log containing malformed lines, **When** ingestion runs, **Then** valid events are
   aggregated, malformed lines are skipped, and the count of skipped lines is reported (never
   silently dropped).
4. **Given** events for models without a known price, **When** cost is aggregated, **Then** those
   events contribute zero cost, are still counted in token/call totals, and are flagged as unpriced.
5. **Given** the user selects a date range, **When** the range changes, **Then** all KPIs and
   breakdowns recompute to that range without re-ingesting raw events.

---

### User Story 2 - Find the most expensive / regressed prompt (Priority: P2)

A prompt engineer opens Prompt Analytics to see a leaderboard of prompts ranked by cost and tokens,
each with calls, total/average cost, average latency, average response size, and output/input ratio,
plus a trend over time. They can compare two prompts side by side and spot when a prompt's cost or
token usage regressed.

**Why this priority**: "Which prompt costs the most / introduced a regression?" is the single most
requested question in the problem statement and the primary differentiator over a flat cost view.

**Independent Test**: With attributed events for several named prompts, verify the leaderboard ranks
them by cost, each per-prompt metric equals the hand-computed aggregate for that prompt's events, and
the sum of all per-prompt costs (plus unattributed) equals the global total from User Story 1.

**Acceptance Scenarios**:

1. **Given** attributed events across multiple prompts, **When** the user opens Prompt Analytics,
   **Then** prompts are ranked by total cost with per-prompt calls, tokens, cost, average latency,
   and output/input ratio displayed.
2. **Given** the user selects two prompts, **When** they request a comparison, **Then** the platform
   shows their metrics side by side.
3. **Given** events spanning multiple days, **When** the user views a prompt's timeline, **Then** a
   per-day trend of that prompt's cost and tokens is shown.
4. **Given** events with no prompt attribution, **When** prompt analytics is computed, **Then** they
   are grouped under an explicit "unattributed" bucket rather than distorting any named prompt.

---

### User Story 3 - Attribute a token/cost spike to an agent (Priority: P3)

An AI platform engineer investigating a token spike opens Agent Analytics to see each agent's calls,
cost, tokens, average latency, tool-invocation count, child-agent executions, and failure rate, with
the agent hierarchy (coordinator → sub-agents) made visible.

**Why this priority**: Multi-agent systems are a core driver of unexpected spend (extra round-trips
from delegation and tool calls). Attributing spend to a responsible agent is the next operational
question after prompt-level visibility.

**Independent Test**: With attributed events for a coordinator and its sub-agents (including
tool-call round-trips), verify each agent's totals match hand-computed aggregates and the parent's
roll-up equals the sum of its own plus its children's events.

**Acceptance Scenarios**:

1. **Given** events attributed to several agents, **When** the user opens Agent Analytics, **Then**
   each agent's calls, cost, tokens, latency, tool calls, and failure rate are displayed.
2. **Given** a coordinator with sub-agents, **When** the user views the hierarchy, **Then** the
   parent/child relationships and roll-up totals are shown.
3. **Given** an agent with failed calls, **When** its failure rate is computed, **Then** it reflects
   the ratio of failed to total attempts for that agent.

---

### User Story 4 - Trace and reconstruct a session (Priority: P3)

A support or platform engineer investigating a user complaint opens the Session Explorer, selects a
session, and sees the full reconstructed timeline: user input → agent execution → prompt execution →
tool calls → model responses → final response, with a raw JSON inspector for any step.

**Why this priority**: When a specific conversation fails or behaves oddly, engineers need to replay
exactly what happened end to end. This is high-value for debugging but depends on attribution
(P1–P3) being in place first.

**Independent Test**: With a set of events sharing a session id, verify the explorer reconstructs the
steps in timestamp order and that each step's raw event is inspectable and matches the source log.

**Acceptance Scenarios**:

1. **Given** events sharing a session id, **When** the user opens that session, **Then** the steps
   are shown in chronological order from user input to final response.
2. **Given** any step in the timeline, **When** the user inspects it, **Then** the raw underlying
   event JSON is displayed unchanged.
3. **Given** a session with a failed step, **When** it is displayed, **Then** the failure is clearly
   marked in the timeline.

---

### User Story 5 - Workflow, model, and provider analytics (Priority: P4)

An engineer compares workflows (duration, cost, success rate, latency, complexity) and compares
models and providers (cost, latency, throughput, token efficiency, error rate) to make routing and
optimization decisions.

**Why this priority**: These comparisons inform optimization but are secondary to establishing
trustworthy attribution and cost. They reuse the same aggregation foundation.

**Independent Test**: With attributed multi-step workflow events and multi-model events, verify each
workflow's duration/cost/success-rate and each model's/provider's aggregates match hand-computed
values, and per-group sums reconcile to global totals.

**Acceptance Scenarios**:

1. **Given** workflow-attributed events, **When** the user opens Workflow Analytics, **Then** each
   workflow's duration, cost, success rate, and latency are displayed, with its execution graph.
2. **Given** events across models and providers, **When** the user opens Model/Provider Analytics,
   **Then** cost, latency, throughput, token efficiency, and error rate are compared per group.

---

### User Story 6 - Automated recommendations and alerts (Priority: P5)

The platform automatically surfaces optimization opportunities (e.g., reduce prompt size, switch to
a cheaper model, cache repeated prompts, remove redundant instructions, optimize a workflow) with
estimated savings, and raises alerts when it detects cost, latency, token, prompt-explosion, or
failure spikes.

**Why this priority**: Recommendations and alerts turn analytics into action, but they are only
meaningful once attribution and aggregation are trustworthy. They build directly on P1–P5.

**Independent Test**: With a crafted event set that contains a known anomaly (e.g., a sudden cost
spike for one prompt) and a known optimization (e.g., a high-token repeated prompt), verify the
corresponding alert fires and the corresponding recommendation appears with a plausible estimated
saving derived from the raw events.

**Acceptance Scenarios**:

1. **Given** events where one prompt's daily cost jumps beyond a defined threshold, **When**
   detection runs, **Then** a cost-spike alert is raised identifying the prompt and the magnitude.
2. **Given** a repeated identical high-token prompt, **When** recommendation generation runs, **Then**
   a "cache/optimize" recommendation appears with an estimated saving computed from the raw events.
3. **Given** an alert, **When** the user resolves it, **Then** it moves from active to resolved
   without altering any raw event.

---

### Edge Cases

- **Malformed records**: invalid/partial JSONL lines are skipped and counted, never silently
  dropped, and never abort ingestion.
- **Missing / partial attribution**: events lacking some or all prompt/agent/workflow/session fields
  are ingested successfully, marked `attribution_status = missing` (or `partial`), and counted under
  an explicit "unattributed" bucket so global totals stay complete.
- **Unpriced models**: events for models with no known rate count tokens/calls but contribute zero
  cost and are flagged unpriced (never assigned a guessed dollar figure).
- **Duplicate events**: identical records are deduplicated so totals are not inflated.
- **Out-of-order / skewed timestamps**: events arriving out of chronological order are still placed
  correctly in trends and session timelines.
- **Failed model calls**: a failed call records no usage; the platform must not invent an event for
  it, but where failure is recorded it must be reflected in failure-rate metrics.
- **Large logs**: ingestion and aggregation must remain correct and performant at the target event
  volume without exhausting resources.
- **Concurrent appends / log rotation**: new events appended while the platform is running are picked
  up on refresh; a rotated/truncated log does not corrupt previously ingested state.
- **Empty / cold start**: with no events yet, dashboards render an explicit empty state rather than
  erroring.

## Requirements *(mandatory)*

### Functional Requirements

**Event ingestion (foundation)**

- **FR-001**: System MUST ingest every TokenHelm / tokenhelm-prompt event from the immutable event
  store (JSONL today; pluggable sources later).
- **FR-002**: System MUST treat raw events as immutable and MUST NOT modify, reorder, or delete the
  source audit trail.
- **FR-003**: System MUST validate each record, skip malformed records, and report the count of
  skipped records rather than failing the whole ingest.
- **FR-004**: System MUST deduplicate events so that no event is counted more than once.
- **FR-005**: System MUST normalize every ingested event into the canonical **ObservationEvent**
  contract (see Key Entities) while preserving the original raw record for inspection and replay. All
  analytics MUST consume the normalized model and MUST NOT parse a storage format directly.
- **FR-006**: System MUST support re-deriving all analytics from raw events so that any metric is
  reproducible from the source (see also FR-031, Event Replay).
- **FR-007**: System MUST assign every event an `attribution_status` of `complete`, `partial`, or
  `missing`, MUST ingest events that lack attribution metadata successfully (marked `missing`), and
  MUST account for them under an explicit "unattributed" grouping — keeping global totals complete
  and preserving backward compatibility with existing TokenHelm logs.
- **FR-007a**: System MUST treat the TokenHelm event stream (not any single storage file) as
  canonical, and MUST allow `usage_log.jsonl` to be one of several interchangeable storage sinks
  (e.g. JSONL, PostgreSQL, Redis Streams, OpenTelemetry) without changes to the analytics layer.

**Cost & overview**

- **FR-008**: System MUST compute and display total cost, total calls, total tokens, average cost,
  average tokens, average latency, and success/failure rate.
- **FR-009**: System MUST compute cost broken down by day, week, and month, and by model, provider,
  prompt, agent, and workflow.
- **FR-010**: System MUST sum cost with decimal precision from the original event cost values so that
  displayed totals exactly match the raw events (no floating-point drift).
- **FR-011**: System MUST count tokens and calls for unpriced models while reporting their cost as
  zero and flagging them as unpriced.
- **FR-012**: Users MUST be able to filter all views by a selected date range, recomputing metrics
  in-memory without re-ingesting raw events.

**Prompt analytics**

- **FR-013**: System MUST compute, per prompt, the number of calls, total tokens, total/average
  cost, average latency, average response size, and output/input ratio.
- **FR-014**: System MUST rank prompts (leaderboard) and show each prompt's trend over time.
- **FR-015**: Users MUST be able to compare two or more prompts side by side.
- **FR-016**: System MUST attribute each event to a prompt using tokenhelm-prompt attribution and
  preserve attribution with 100% fidelity (no attributed event is lost or misattributed); events
  without prompt attribution are surfaced via `attribution_status = missing`, never silently dropped
  or guessed.
- **FR-017**: System SHOULD track prompt versions so that regressions between versions are
  identifiable. *(Phase 3; depends on version metadata being emitted.)*

**Agent analytics**

- **FR-018**: System MUST compute, per agent, calls, cost, tokens, average latency, tool-invocation
  count, child-agent executions, and failure rate.
- **FR-019**: System MUST represent the agent hierarchy (coordinator and sub-agents) and roll up
  child metrics into parents.

**Workflow analytics**

- **FR-020**: System MUST compute, per workflow, duration, cost, success rate, latency, and a
  complexity measure, and MUST present the workflow execution graph.

**Session analytics**

- **FR-021**: System MUST reconstruct complete sessions, displaying user input, agent execution,
  prompt execution, tool calls, model responses, and final response in chronological order.
- **FR-022**: System MUST provide a raw JSON inspector that shows any step's underlying event
  unchanged.

**Model & provider analytics**

- **FR-023**: System MUST compute, per model and per provider, average latency, average tokens,
  average cost, throughput, token efficiency, and error rate, and support comparison across them.

**Recommendations & alerts**

- **FR-024**: System MUST automatically generate optimization recommendations (e.g., reduce prompt
  size, switch model, cache repeated prompts, remove redundant instructions, optimize workflow) with
  an estimated saving derived from raw events.
- **FR-025**: System MUST detect operational anomalies and raise alerts for cost spikes, latency
  spikes, token spikes, prompt explosions, and failure spikes, identifying the responsible
  prompt/agent/workflow and the magnitude.
- **FR-026**: Users MUST be able to view active and resolved alerts and resolve an alert without
  altering any raw event.

**Cross-cutting**

- **FR-027**: System MUST provide search across prompts, agents, workflows, sessions, models, and
  providers.
- **FR-028**: System MUST support exporting analytics views/results.
- **FR-029**: System MUST surface honestly when data is incomplete (skipped records, unattributed
  events, unpriced models) rather than presenting a falsely complete picture.
- **FR-030**: System MUST remain backward compatible with existing TokenHelm integrations: no change
  to an instrumented application is required for it to be observed, and the existing append-only
  `usage_log.jsonl` contract MUST not be made lossy.
- **FR-031 (Event Replay)**: The platform MUST support replaying immutable observation events to
  rebuild analytics without re-running the AI application — enabling regeneration of analytics after
  schema changes, correction of aggregation bugs, and migration between storage sinks without losing
  historical data. A replay over an unchanged event set MUST produce identical analytics
  (deterministic).

### Key Entities *(include if feature involves data)*

- **ObservationEvent**: the canonical, immutable, normalized record of one model invocation and the
  single contract every analytics module consumes. The atomic unit from which all analytics derive.
  Field contract:
  - `event_id` — stable unique identifier for the event (basis for deduplication)
  - `timestamp` — when the invocation occurred
  - `provider` — model provider (e.g. gemini)
  - `model` — model name
  - `request_id` — identifier of the underlying model request/round-trip
  - `session_id` — the session/conversation grouping this event belongs to
  - `conversation_id` *(optional)* — finer-grained conversation thread within a session
  - `workflow_id` *(optional)* — the workflow/invocation this event is part of
  - `agent` — the agent responsible for the invocation
  - `prompt` — the attributed prompt (per tokenhelm-prompt)
  - `prompt_hash` — content hash of the prompt, for grouping identical prompts
  - `prompt_version` — tracked version of the prompt (regression detection)
  - `tool_name` *(optional)* — tool invoked on this round-trip, if any
  - `input_tokens`, `output_tokens`, `total_tokens` — token counts (output includes folded thinking
    tokens, consistent with the project's tracking rule)
  - `latency_ms` — observed latency of the invocation
  - `cost` — decimal-precise cost string (zero and flagged when the model is unpriced)
  - `currency` — currency of `cost`
  - `status` — outcome of the invocation (e.g. success / failure)
  - `attribution_status` — `complete` | `partial` | `missing`; derived from presence of attribution
    fields, drives the "unattributed" grouping
  - `metadata` — open key/value bag for sink-specific or future fields, carried through without
    interpretation
  - `raw` — the original unmodified source record, preserved for inspection and replay
- **PromptExecution**: a derived view aggregating events attributed to a single prompt (and version),
  including calls, tokens, cost, latency, and ratios.
- **AgentExecution**: a derived view aggregating events attributed to a single agent, including tool
  invocations, child executions, and failure rate; participates in a parent/child hierarchy.
- **WorkflowExecution**: a derived view of a multi-step workflow run, including its step graph,
  duration, cost, and success state.
- **Session**: an ordered reconstruction of one user conversation, linking its events, prompts,
  agents, tool calls, and responses by session id and timestamp.
- **PromptVersion**: a tracked version of a prompt, enabling regression comparison across versions.
- **Recommendation**: a derived, actionable optimization suggestion with an estimated saving and a
  reference to the events that justify it.
- **Alert**: a detected anomaly (type, severity, responsible entity, magnitude, status
  active/resolved) derived from event patterns.
- **Model / Provider**: aggregation groupings for cross-model and cross-provider comparison.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Displayed dashboard totals (cost, tokens, calls) match the underlying raw events
  exactly — reconciliation difference is zero — for any fixed event set.
- **SC-002**: 100% of attributed events are correctly attributed to their prompt; no attributed event
  is lost or misattributed.
- **SC-003**: No event is double-counted; duplicate records produce no inflation in any total.
- **SC-004**: Every displayed metric is reproducible by re-deriving it from raw events (same input →
  same output).
- **SC-005**: A user can identify the single most expensive prompt, agent, and model in under 30
  seconds from opening the platform.
- **SC-006**: The main dashboard becomes usable (interactive) within 2 seconds on the target dataset.
- **SC-007**: Analytics views refresh to reflect newly appended events within 5 seconds.
- **SC-008**: Search returns results in under 500 milliseconds.
- **SC-009**: The platform handles the target volume of 10 million events without data loss or
  incorrect totals.
- **SC-010**: The platform serves 100 concurrent viewers without degraded correctness.
- **SC-011**: Zero data loss — every event present in the source store is accounted for (counted or
  explicitly reported as skipped/unattributed).
- **SC-012**: Recommendations and alerts are generated automatically (no manual trigger) and each
  references the raw events that justify it.
- **SC-013**: Onboarding a new TokenHelm-instrumented application requires zero changes to that
  application to begin observing it.
- **SC-014**: Replaying an unchanged event set reproduces byte-identical analytics, and switching the
  storage sink (e.g. JSONL → database) leaves all analytics unchanged.

## Assumptions

- **Local-first, read-only v1**: The platform extends the existing read-only dashboard approach,
  consuming the immutable event store and never writing to it. Hosted SaaS is deferred.
- **Attribution is first-class, degradation is graceful**: The normalized `ObservationEvent` carries
  attribution fields and an `attribution_status`. Where the dispatcher/emitter supplies attribution
  (prompt, agent, session, workflow), events are `complete`; where it does not, they are ingested as
  `missing`/`partial` and grouped as "unattributed". Today's `usage_log.jsonl` carries only
  `provider/model/tokens/latency/cost/timestamp/priced/currency`, so historical events normalize to
  `attribution_status = missing` until the emitter is enriched — the platform must remain fully
  functional on such data.
- **Storage is a sink, not the source**: The canonical source is the TokenHelm event stream; storage
  backends (JSONL today; PostgreSQL/Redis Streams/OpenTelemetry later) are interchangeable sinks
  behind the normalizer. The aggregation engine depends only on the `ObservationEvent` contract.
- **Decimal-precise cost**: Cost is summed from original string values with decimal precision,
  mirroring the backend's `Decimal` use, so totals reconcile exactly.
- **Offline verifiable**: Aggregation/attribution correctness is verifiable from fixture event sets
  without live model credentials, consistent with the project's offline-verifiability principle.
- **"Real-time" means near-real-time refresh**: New events appended to the store are reflected on the
  next refresh within the SC-007 window, not a streaming push pipeline (streaming is Phase 4).
- **Single workspace/tenant for v1**: Multi-tenant separation, users, and workspaces are modeled
  conceptually but enforced only in Phase 5.
- **Pricing source unchanged**: Pricing continues to come from the existing data-driven pricing
  source; unknown models remain `priced=false`.

## Dependencies

- The existing `usage_log.jsonl` append-only contract and the TokenHelm / tokenhelm-prompt event +
  attribution model.
- The existing data-driven pricing source (for cost) and its honest unpriced handling.
- For full (`complete`) prompt/agent/workflow/session attribution: emission of attribution metadata
  on each event by the dispatcher/emitter. The platform functions on `missing`/`partial` events
  regardless; richer emitter metadata raises the share of `complete` events.

## Delivery Epics

Implementation is organized into the following epics (drives the `/speckit-plan` phasing). The
**Observation Foundation** epic is the architectural base every other epic depends on.

| # | Epic | Delivers | Primary user stories / FRs |
|---|------|----------|----------------------------|
| 1 | **Observation Foundation** | Canonical `ObservationEvent` contract, dispatcher → normalizer → immutable event store, pluggable sinks, `attribution_status`, replay | FR-001–FR-007a, FR-031 |
| 2 | **Event Ingestion** | Validation, dedup, malformed-line reporting, backward-compatible JSONL sink, refresh-on-append | US1; FR-003, FR-004, FR-029, FR-030 |
| 3 | **Overview Dashboard** | Executive KPIs + cost analytics (by day/model/provider), decimal-exact reconciliation, date-range filtering | US1; FR-008–FR-012 |
| 4 | **Prompt Analytics (PromptOps)** | Prompt leaderboard, per-prompt stats, trends, comparison, version/regression tracking | US2; FR-013–FR-017 |
| 5 | **Agent & Workflow Analytics (AgentOps)** | Per-agent metrics + hierarchy, workflow tracing/graph/cost/success, model & provider comparison | US3, US5; FR-018–FR-020, FR-023 |
| 6 | **Session Explorer** | Full session reconstruction timeline + raw JSON inspector | US4; FR-021–FR-022 |
| 7 | **Recommendation & Alert Engine** | Auto recommendations with estimated savings, anomaly alerts, active/resolved management, search & export | US6; FR-024–FR-028 |
| 8 | **Enterprise Features** | Multi-tenant, RBAC, SSO, billing, audit, streaming/OTel integrations *(Phase 4–5 — out of scope for this spec; listed for roadmap continuity)* | — |

## Out of Scope

The following Roadmap Phase 4–5 items (Epic 8) are explicitly **out of scope** for this
specification:

- Real-time streaming ingestion and push pipelines.
- OpenTelemetry, Grafana, Prometheus, and Langfuse integrations.
- Multi-tenant SaaS hosting, RBAC, SSO, billing, audit logs, and enterprise deployment.
- Modifying or migrating the TokenHelm library itself (the platform consumes its events).
