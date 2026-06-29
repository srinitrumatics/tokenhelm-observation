# AI Observability Platform — REST API Reference

The observability dashboard (`frontend/`, Next.js 15 / React 19) exposes a small REST API
under `/api/*`. Every endpoint is a thin HTTP wrapper over the storage-agnostic analytics
layer (`lib/analytics/`, `lib/observation/`). The dashboard itself consumes these routes;
they are also stable enough to call directly from scripts or other tools.

This document is generated from the route handlers in `frontend/app/api/` and the type
sources in `frontend/lib/`. It documents the exact query/path params, response shapes, and
status codes — nothing is invented beyond the code.

## Table of contents

- [Conventions](#conventions)
- [GET /api/overview](#get-apioverview)
- [GET /api/usage](#get-apiusage-legacy)
- [GET /api/prompts](#get-apiprompts)
- [GET /api/agents](#get-apiagents)
- [GET /api/workflows](#get-apiworkflows)
- [GET /api/sessions](#get-apisessions)
- [GET /api/models](#get-apimodels)
- [GET /api/recommendations](#get-apirecommendations)
- [GET /api/recommendations/{id}](#get-apirecommendationsid)
- [GET /api/alerts](#get-apialerts)
- [GET /api/alerts/{id}](#get-apialertsid)
- [PATCH /api/alerts/{id}/acknowledge](#patch-apialertsidacknowledge)
- [PATCH /api/alerts/{id}/resolve](#patch-apialertsidresolve)
- [GET /api/search](#get-apisearch)
- [GET /api/export](#get-apiexport)
- [The ObservationEvent shape](#the-observationevent-shape)

---

## Conventions

These rules hold across every endpoint unless noted otherwise.

**Read-only over immutable events.** With the sole exception of the two alert-lifecycle
PATCH endpoints, every route is read-only. They read normalized `ObservationEvent`s fresh
on each request and compute analytics in memory. The event stream is never mutated
(Constitution III).

**Storage backend is transparent.** The active store is chosen by the `EVENT_SOURCE`
environment variable, resolved by `getEventSource()` (`lib/observation/source.ts`):

| `EVENT_SOURCE` | Backend | Notes |
|----------------|---------|-------|
| `jsonl` (default) | `JsonlEventSource` | append-only `usage_log.jsonl` |
| `duckdb` | `DuckDbEventSource` | columnar engine for large datasets, lazily loaded |

Every route depends only on the `EventSource` interface, so switching backends needs zero
analytics changes and is invisible to API consumers. The `meta.source` field reports which
backend served the response.

**`meta` block.** Read endpoints return a `meta` object alongside their payload:

| Field | Type | Meaning |
|-------|------|---------|
| `source` | string | `EventSource.describe()` — where the events came from |
| `present` | boolean | `false` on cold start (no events yet) |
| `skipped` | number | malformed source records skipped (surfaced honestly) |
| `duplicates` | number | records collapsed by deduplication |
| `generatedAt` | string | ISO-8601 time the response was generated |

(`/api/search` returns a trimmed meta — `source`, `present`, `count`, `generatedAt` — and
`/api/usage` uses a legacy meta described in its section.)

**Date filtering.** Most endpoints accept `from` and `to` query params, ISO-8601
timestamps, applied via `filterByRange`. Both are optional and may be supplied
independently (only `from`, only `to`, both, or neither).

**Caching.** Every response sets `Cache-Control: no-store`; routes are
`dynamic = "force-dynamic"` with `revalidate = 0`, so data is always read fresh from the
active source.

**Errors.** Unexpected failures return `500` with `{ "error": "<message>" }`. Not-found
lookups return `404`; an unknown export view returns `400`. Bodies are always JSON except
the CSV export attachment.

---

## GET /api/overview

Returns the full set of normalized `ObservationEvent`s plus a `meta` block. This is the
primary feed backing the dashboard (consumed by `useObservations`); the client recomputes
KPIs and cost breakdowns in memory per date range, so this route stays storage-agnostic.

It takes **no query params** — the entire event set is returned and filtered client-side.

### Request

```bash
curl -s http://localhost:3000/api/overview
```

### Response `200`

```json
{
  "events": [
    {
      "event_id": "evt_01H...",
      "timestamp": "2026-06-28T14:03:11.482Z",
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "request_id": "req_8a1c",
      "session_id": "sess_42",
      "conversation_id": null,
      "workflow_id": "pipeline_agent",
      "agent": "summarizer",
      "parent_agent": "coordinator",
      "prompt": "summarizer",
      "prompt_hash": "9f2b...",
      "prompt_version": "v2",
      "tool_name": null,
      "input_tokens": 812,
      "output_tokens": 240,
      "total_tokens": 1102,
      "latency_ms": 631,
      "cost": "0.0004821",
      "currency": "USD",
      "status": "success",
      "attribution_status": "complete",
      "metadata": { "priced": true }
    }
  ],
  "meta": {
    "source": "jsonl:../usage_log.jsonl",
    "present": true,
    "skipped": 0,
    "duplicates": 0,
    "generatedAt": "2026-06-29T09:00:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `events` | `ObservationEvent[]` | every normalized event (see [shape](#the-observationevent-shape)) |
| `meta` | object | standard meta block |

---

## GET /api/usage (legacy)

The **older 001 Cost Analytics Dashboard** endpoint. It predates the observability
platform and reads the raw `usage_log.jsonl` records directly (Zod-validated, malformed
lines skipped and counted) rather than normalized `ObservationEvent`s. Prefer
`/api/overview` and the entity endpoints for new work; this route is kept for the legacy
cost dashboard.

It takes **no query params**.

### Request

```bash
curl -s http://localhost:3000/api/usage
```

### Response `200`

```json
{
  "records": [
    {
      "provider": "google",
      "model": "gemini-3-flash-preview",
      "input_tokens": 812,
      "output_tokens": 240,
      "total_tokens": 1102,
      "latency": 631,
      "cost": "0.0004821",
      "timestamp": "2026-06-28T14:03:11.482Z",
      "usage_complete": true,
      "priced": true,
      "currency": "USD",
      "agent": "summarizer"
    }
  ],
  "summary": {
    "callCount": 128,
    "inputTokens": 91234,
    "outputTokens": 30122,
    "totalTokens": 121356,
    "costByCurrency": { "USD": "0.0612430" },
    "pricedCount": 120,
    "unpricedCount": 8,
    "skippedLines": 0,
    "firstTimestamp": "2026-06-01T08:00:00.000Z",
    "lastTimestamp": "2026-06-28T14:03:11.482Z"
  },
  "meta": { "source": "../usage_log.jsonl", "logPresent": true }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `records` | `UsageRecord[]` | raw validated log rows (note `latency`, not `latency_ms`) |
| `summary` | `UsageSummary` | aggregate counts; `costByCurrency` maps currency → decimal string |
| `meta.source` | string | resolved log path |
| `meta.logPresent` | boolean | `false` if the log file does not exist yet |

> Note: this legacy meta has only `source`/`logPresent` — it does **not** carry the
> `present`/`skipped`/`duplicates`/`generatedAt` fields of the observability `meta` block.

---

## GET /api/prompts

Prompt analytics (US2). Two modes depending on the `prompt` param.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `prompt` | query | no | when present, returns the detail view for that prompt name; when absent, returns the leaderboard + recommendation flags |

### Request — leaderboard

```bash
curl -s "http://localhost:3000/api/prompts?from=2026-06-01T00:00:00Z&to=2026-06-29T00:00:00Z"
```

### Response `200` — leaderboard

```json
{
  "leaderboard": { "prompts": [ { "key": "summarizer", "calls": 40, "cost": "0.018", "totalTokens": 44120, "avgTokensPerCall": 1103, "avgLatencyMs": 620 } ] },
  "flags": [ { "type": "expensive", "prompt": "summarizer", "value": 0.018, "threshold": 0.01, "detail": "..." } ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

### Request — detail

```bash
curl -s "http://localhost:3000/api/prompts?prompt=summarizer"
```

### Response `200` — detail

```json
{
  "detail": { "timeline": [], "executions": [], "trend": [], "versions": [], "attribution": {} },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

| Field | Description |
|-------|-------------|
| `leaderboard` | per-prompt rollups (cost/tokens/calls/latency) — present in list mode |
| `flags` | recommendation flags derived from the leaderboard — present in list mode |
| `detail` | timeline, executions, trend, versions and attribution for one prompt — present in detail mode |

---

## GET /api/agents

Agent analytics / AgentOps (US3). The execution hierarchy is derived from
`parent_agent`/`tool_name` edges in the events, never from UI structures.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `agent` | query | no | when present, returns the detail view for that agent; when absent, returns the leaderboard + execution tree + recommendation flags |

### Request

```bash
curl -s "http://localhost:3000/api/agents?agent=coordinator"
```

### Response `200` — detail

```json
{
  "detail": { "timeline": [], "executions": [], "trend": [], "parent": "root", "children": ["summarizer"], "attribution": {} },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

### Response `200` — leaderboard (no `agent`)

```json
{
  "leaderboard": { "agents": [ { "key": "coordinator", "parent": null, "depth": 0, "calls": 60, "cost": "0.02", "rolledCost": "0.05", "rolledTotalTokens": 90000, "failureRate": 0.0, "toolInvocations": 12 } ] },
  "flags": [ { "type": "deep-hierarchy", "agent": "coordinator", "value": 4, "threshold": 3, "detail": "..." } ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

---

## GET /api/workflows

Workflow analytics (US5).

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `workflow` | query | no | when present, returns the detail view (graph, trace, participation, trends) for that workflow id; when absent, returns the leaderboard + recommendation flags |

### Request

```bash
curl -s "http://localhost:3000/api/workflows?workflow=pipeline_agent"
```

### Response `200` — detail

```json
{
  "detail": { "graph": {}, "trace": [], "participation": {}, "durationTrend": [] },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

### Response `200` — leaderboard (no `workflow`)

```json
{
  "leaderboard": { "workflows": [ { "key": "pipeline_agent", "executions": 8, "totalCost": "0.031", "totalTokens": 52000, "avgDurationMs": 4200, "successRate": 1.0, "avgAgents": 3, "avgPrompts": 3, "avgToolCalls": 1 } ] },
  "flags": [ { "type": "long-running", "workflow": "pipeline_agent", "value": 4200, "threshold": 3000, "detail": "..." } ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

---

## GET /api/sessions

Session Explorer (US4). Sessions are reconstructed from `ObservationEvent`s only; ordering
comes from timestamps and event relationships, never UI state.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `session` | query | no | when present, returns the reconstructed session (summary, timeline, execution trace) for that session id; when absent, returns the session list + analytics |

### Request

```bash
curl -s "http://localhost:3000/api/sessions?session=sess_42"
```

### Response `200` — single session

```json
{
  "session": { "summary": {}, "timeline": [], "executionTrace": [] },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

### Response `200` — explorer (no `session`)

```json
{
  "explorer": { "sessions": [ { "sessionId": "sess_42", "cost": "0.004", "totalTokens": 9000, "eventCount": 12, "workflowIds": ["pipeline_agent"], "prompts": ["summarizer"] } ] },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

---

## GET /api/models

Model & Provider analytics (US5). Returns per-model and per-provider stats for comparison.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |

### Request

```bash
curl -s "http://localhost:3000/api/models?from=2026-06-01T00:00:00Z"
```

### Response `200`

```json
{
  "analytics": {
    "models": [ { "key": "gemini-3-flash-preview", "calls": 128, "cost": "0.061", "totalTokens": 121356, "avgLatencyMs": 640, "successRate": 0.98, "failureRate": 0.02, "providers": ["google"] } ],
    "providers": [ { "key": "google", "calls": 128, "cost": "0.061", "totalTokens": 121356, "avgLatencyMs": 640, "successRate": 0.98, "failureRate": 0.02, "models": ["gemini-3-flash-preview"] } ]
  },
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

---

## GET /api/recommendations

Rule-based optimization recommendations (US6). Derived purely from validated analytics
flags; this route never mutates the event log. Recommendations are deterministic — ids are
derived from `(flag, entity)` and `created_at` is the latest related-event timestamp, so
replay over the same events reproduces identical output.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `category` | query | no | filter by `RecommendationCategory` (e.g. `Cost Optimization`, `Prompt Optimization`, `Workflow Optimization`, `Agent Optimization`, `Reliability`, `Performance`, `Model Selection`) |
| `severity` | query | no | filter by severity: `low`, `medium`, `high`, `critical` |

### Request

```bash
curl -s "http://localhost:3000/api/recommendations?category=Cost%20Optimization&severity=high"
```

### Response `200`

```json
{
  "recommendations": [
    {
      "recommendation_id": "rec:prompt:expensive:prompt:summarizer",
      "category": "Cost Optimization",
      "severity": "high",
      "title": "Expensive prompt",
      "description": "Expensive prompt for prompt \"summarizer\": ...",
      "evidence": "...",
      "affected_entity": { "type": "prompt", "id": "summarizer" },
      "estimated_impact": { "type": "cost_saving", "value": "0.008000" },
      "suggested_action": "Cache repeated calls or switch to a cheaper model",
      "related_event_ids": ["evt_01H...", "evt_02H..."],
      "created_at": "2026-06-28T14:03:11.482Z"
    }
  ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

`Recommendation` fields:

| Field | Type | Description |
|-------|------|-------------|
| `recommendation_id` | string | deterministic `rec:<source>:<flag>:<entityType>:<entityId>` |
| `category` | string | one of the `RecommendationCategory` values |
| `severity` | string | `low` \| `medium` \| `high` \| `critical` |
| `title` | string | short label |
| `description` | string | human-readable explanation |
| `evidence` | string | the detail text the flag was raised on |
| `affected_entity` | `{ type, id }` | `type` is `prompt` \| `agent` \| `workflow` \| `model` \| `provider` |
| `estimated_impact` | `{ type, value }` | e.g. `cost_saving` / `token_saving` / `latency`, value as string |
| `suggested_action` | string | recommended remediation |
| `related_event_ids` | string[] | up to 25 backing event ids |
| `created_at` | string \| null | latest related-event timestamp (data-derived) |

---

## GET /api/recommendations/{id}

Returns a single recommendation by id (US6). The `{id}` path segment is URL-decoded before
lookup, so url-encode `:` and other reserved characters.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `id` | path | yes | the `recommendation_id` (URL-encoded) |

### Request

```bash
curl -s "http://localhost:3000/api/recommendations/rec%3Aprompt%3Aexpensive%3Aprompt%3Asummarizer"
```

### Response `200`

```json
{ "recommendation": { "recommendation_id": "rec:prompt:expensive:prompt:summarizer", "category": "Cost Optimization", "severity": "high", "title": "Expensive prompt" } }
```

> This route returns only `{ recommendation }` — no `meta` block.

### Response `404`

```json
{ "error": "Recommendation not found" }
```

---

## GET /api/alerts

Rule-based operational alerts with a lifecycle overlay (US6). Alerts are recomputed from
immutable events on every request; the acknowledged/resolved overlay comes from a
**process-local alert store** (`lib/alert-state.ts`), never the event log. `triggered_at`
is data-derived (latest related-event timestamp), so the same events reproduce identical
alerts.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `severity` | query | no | filter: `low` \| `medium` \| `high` \| `critical` |
| `entity_type` | query | no | filter: `global` \| `model` \| `provider` \| `agent` \| `prompt` \| `workflow` |
| `status` | query | no | lifecycle filter: `active` \| `acknowledged` \| `resolved` |

### Request

```bash
curl -s "http://localhost:3000/api/alerts?severity=critical&status=active"
```

### Response `200`

```json
{
  "alerts": [
    {
      "alert_id": "alert:cost-spike:global:all",
      "rule_id": "cost-spike",
      "severity": "critical",
      "status": "active",
      "entity_type": "global",
      "entity_id": "all",
      "metric": "daily_cost",
      "threshold": 0.012,
      "observed_value": 0.048,
      "evidence": "Daily cost on 2026-06-28 was 0.048000 vs a 0.004000 prior-day average (3× threshold).",
      "triggered_at": "2026-06-28T23:11:02.001Z",
      "resolved_at": null,
      "acknowledged_at": null,
      "related_event_ids": ["evt_01H...", "evt_02H..."]
    }
  ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "skipped": 0, "duplicates": 0, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

`Alert` fields:

| Field | Type | Description |
|-------|------|-------------|
| `alert_id` | string | deterministic `alert:<rule>:<entityType>:<entityId>` |
| `rule_id` | string | `cost-spike` \| `token-spike` \| `latency-spike` \| `failure-spike` \| `prompt-regression` \| `workflow-regression` \| `model-degradation` \| `provider-degradation` |
| `severity` | string | `low` \| `medium` \| `high` \| `critical` |
| `status` | string | `active` \| `acknowledged` \| `resolved` (from the lifecycle overlay) |
| `entity_type` | string | `global` \| `model` \| `provider` \| `agent` \| `prompt` \| `workflow` |
| `entity_id` | string | the affected entity key (`all` for global) |
| `metric` | string | metric that tripped the rule (e.g. `daily_cost`, `failure_rate`) |
| `threshold` | number | the threshold compared against |
| `observed_value` | number | the observed metric value |
| `evidence` | string | human-readable explanation |
| `triggered_at` | string \| null | latest related-event timestamp |
| `resolved_at` | string \| null | set when resolved via the lifecycle store |
| `acknowledged_at` | string \| null | set when acknowledged via the lifecycle store |
| `related_event_ids` | string[] | up to 50 backing event ids |

---

## GET /api/alerts/{id}

Returns a single alert (with lifecycle overlay) by id (US6). The `{id}` path segment is
URL-decoded before lookup.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `id` | path | yes | the `alert_id` (URL-encoded) |

### Request

```bash
curl -s "http://localhost:3000/api/alerts/alert%3Acost-spike%3Aglobal%3Aall"
```

### Response `200`

```json
{ "alert": { "alert_id": "alert:cost-spike:global:all", "rule_id": "cost-spike", "status": "active", "severity": "critical" } }
```

> Returns only `{ alert }` — no `meta` block.

### Response `404`

```json
{ "error": "Alert not found" }
```

---

## PATCH /api/alerts/{id}/acknowledge

Moves an alert to the `acknowledged` state (US6).

**This mutates ONLY the alert lifecycle store — it never touches `ObservationEvent`s.**
The underlying immutable event stream is untouched; only the process-local overlay records
the acknowledgement (with an `acknowledged_at` timestamp). The alert itself is still
recomputed from events on the next read.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `id` | path | yes | the `alert_id` (URL-encoded) |

No request body is required.

### Request

```bash
curl -s -X PATCH "http://localhost:3000/api/alerts/alert%3Acost-spike%3Aglobal%3Aall/acknowledge"
```

### Response `200`

```json
{
  "alert": {
    "alert_id": "alert:cost-spike:global:all",
    "rule_id": "cost-spike",
    "status": "acknowledged",
    "acknowledged_at": "2026-06-29T09:05:00.000Z",
    "resolved_at": null
  }
}
```

### Response `404`

```json
{ "error": "Alert not found" }
```

---

## PATCH /api/alerts/{id}/resolve

Moves an alert to the `resolved` state (US6).

**This mutates ONLY the alert lifecycle store — it never touches `ObservationEvent`s.**
Only the process-local overlay is updated (setting `resolved_at`); the event stream stays
immutable.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `id` | path | yes | the `alert_id` (URL-encoded) |

No request body is required.

### Request

```bash
curl -s -X PATCH "http://localhost:3000/api/alerts/alert%3Acost-spike%3Aglobal%3Aall/resolve"
```

### Response `200`

```json
{
  "alert": {
    "alert_id": "alert:cost-spike:global:all",
    "rule_id": "cost-spike",
    "status": "resolved",
    "resolved_at": "2026-06-29T09:06:00.000Z"
  }
}
```

### Response `404`

```json
{ "error": "Alert not found" }
```

---

## GET /api/search

Cross-entity search (US-Polish, FR-027). Substring-matches a query across prompts, agents,
workflows, sessions, models and providers, returning a unified result list ranked by cost
descending. Read-only over events.

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `q` | query | no | search string; an empty/missing `q` returns no results |
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |
| `limit` | query | no | max results; coerced to a positive integer, capped at 200, defaults to 50 |

### Request

```bash
curl -s "http://localhost:3000/api/search?q=summar&limit=20"
```

### Response `200`

```json
{
  "query": "summar",
  "results": [
    {
      "type": "prompt",
      "id": "summarizer",
      "label": "summarizer",
      "cost": "0.018",
      "totalTokens": 44120,
      "calls": 40,
      "href": "/prompts/summarizer",
      "matched": "summarizer"
    }
  ],
  "meta": { "source": "jsonl:../usage_log.jsonl", "present": true, "count": 1, "generatedAt": "2026-06-29T09:00:00.000Z" }
}
```

`SearchResult` fields:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `prompt` \| `agent` \| `workflow` \| `session` \| `model` \| `provider` |
| `id` | string | entity key |
| `label` | string | display label |
| `cost` | string | decimal cost string (also the ranking key) |
| `totalTokens` | number | total tokens for the entity |
| `calls` | number | call/event count |
| `href` | string | dashboard route for the entity |
| `matched` | string | the field text that matched the query |

> This route's `meta` is trimmed: `source`, `present`, `count`, `generatedAt` (no
> `skipped`/`duplicates`).

---

## GET /api/export

Exports a computed analytics view as JSON or a CSV file attachment (FR-028). Read-only over
events; rows are exactly the leaderboard/recommendation/alert values (no re-derivation).

| Param | In | Required | Description |
|-------|----|----------|-------------|
| `view` | query | yes | one of: `prompts`, `agents`, `workflows`, `sessions`, `models`, `providers`, `recommendations`, `alerts` |
| `format` | query | no | `json` (default) or `csv` |
| `from` | query | no | ISO start of date range |
| `to` | query | no | ISO end of date range |

### Request — JSON

```bash
curl -s "http://localhost:3000/api/export?view=prompts&format=json"
```

### Response `200` — JSON

```json
{
  "view": "prompts",
  "columns": ["prompt", "attributed", "calls", "cost", "totalTokens", "avgTokensPerCall", "avgLatencyMs"],
  "rows": [
    { "prompt": "summarizer", "attributed": true, "calls": 40, "cost": "0.018", "totalTokens": 44120, "avgTokensPerCall": 1103, "avgLatencyMs": 620 }
  ]
}
```

The `columns` array gives a stable column order per view, so even an empty export emits a
header. The JSON body is the `ExportTable` (`{ view, columns, rows }`) — note there is **no
`meta` block** on this endpoint.

### Request — CSV

```bash
curl -s -OJ "http://localhost:3000/api/export?view=alerts&format=csv"
```

### Response `200` — CSV (file attachment)

When `format=csv`, the response is a CSV file, **not** JSON:

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="<view>.csv"` (e.g. `alerts.csv`)
- `Cache-Control: no-store`

```csv
alert_id,rule_id,severity,status,entity,metric,observed_value,threshold,triggered_at
alert:cost-spike:global:all,cost-spike,critical,active,global:all,daily_cost,0.048,0.012,2026-06-28T23:11:02.001Z
```

### Response `400` — unknown view

```json
{ "error": "Unknown view. Use one of: prompts, agents, workflows, sessions, models, providers, recommendations, alerts" }
```

---

## The ObservationEvent shape

Every read endpoint operates on the canonical `ObservationEvent` (`lib/observation/event.ts`),
the only domain model the analytics layer consumes. No route reads a storage-specific
format directly — that lives behind the `EventSource` seam.

| Field | Type | Notes |
|-------|------|-------|
| `event_id` | string | unique event id |
| `timestamp` | string | ISO-8601, parseable date |
| `provider` | string | e.g. `google` |
| `model` | string | e.g. `gemini-3-flash-preview` |
| `request_id` | string | upstream request id |
| `session_id` | string | session this event belongs to |
| `conversation_id` | string \| null | defaults `null` |
| `workflow_id` | string \| null | workflow this event participated in |
| `agent` | string | agent that produced the call |
| `parent_agent` | string \| null | parent in the execution hierarchy (`null` for a root agent) |
| `prompt` | string | prompt/agent instruction name |
| `prompt_hash` | string \| null | content hash of the prompt |
| `prompt_version` | string \| null | version label |
| `tool_name` | string \| null | tool invoked, if any |
| `input_tokens` | number | non-negative integer |
| `output_tokens` | number | non-negative integer |
| `total_tokens` | number | taken as recorded, never recomputed; may exceed input+output (reasoning tokens folded in) |
| `latency_ms` | number | non-negative, defaults `0` |
| `cost` | string | **decimal string**, never parsed to a float; summed with `decimal.js` downstream |
| `currency` | string | e.g. `USD` |
| `status` | string | `success` \| `error`, defaults `success` |
| `attribution_status` | string | `complete` \| `partial` \| `missing` (derived during normalization) |
| `environment` | string \| null | forward-looking operational metadata; defaults `null` |
| `application_name` | string \| null | forward-looking; defaults `null` |
| `application_version` | string \| null | forward-looking; defaults `null` |
| `tenant_id` | string \| null | forward-looking; defaults `null` |
| `tags` | string[] | forward-looking; defaults `[]` |
| `correlation_id` | string \| null | forward-looking; defaults `null` |
| `metadata` | object | arbitrary; `metadata.priced === false` marks unpriced events |
| `raw` | object | original source record, defaults `{}` |

**Pricing rule:** unpriced events (`metadata.priced === false`) still count tokens but
contribute **zero cost**, the same honesty rule applied throughout the platform.
