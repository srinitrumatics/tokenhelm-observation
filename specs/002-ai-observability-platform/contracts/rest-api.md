# Contract: REST API (Next.js Route Handlers)

All endpoints are read-only GET (except `PATCH /api/alerts/:id` which mutates only alert state, never
a raw event). Each handler: selects the active `EventSource`, runs the relevant pure aggregator over
`ObservationEvent[]`, and returns JSON. Responses are computed fresh per request (`no-store`) so newly
appended events appear within SC-007. Common query params: `from`, `to` (ISO date range — drives all
views, FR-012), `currency`.

Every response includes a `meta` block:

```text
meta: {
  source: string,        // EventSource.describe()
  present: boolean,      // false on cold start
  skipped: number,       // malformed records skipped (surfaced honestly, FR-029)
  duplicates: number,    // deduped count
  unattributedCalls: number,  // events with attribution_status != complete
  generatedAt: string
}
```

## Endpoints

### GET /api/overview  — Epic 3
KPIs + cost analytics. Returns `summary` (totalCost by currency, totalCalls, totalTokens, averages,
successRate, failureRate, prompt/agent/workflow/model/provider counts), `costByDay[]`, `costByModel[]`,
`costByProvider[]`. **Reconciliation**: totals equal decimal-exact sum of events in range (SC-001).

### GET /api/prompts  — Epic 4
`leaderboard[]` (PromptExecution ranked by cost), each with calls/tokens/cost/avgLatency/
avgResponseSize/outputInputRatio. Query `?prompt=a&prompt=b` → side-by-side `comparison`. Query
`?prompt=x&trend=1` → per-day `trend[]`. Unattributed grouped under `unattributed`.

### GET /api/agents  — Epic 5
`agents[]` (AgentExecution: calls/cost/tokens/avgLatency/toolInvocations/childExecutions/failureRate)
and `hierarchy` (parent→children with rolled-up totals).

### GET /api/workflows  — Epic 5
`workflows[]` (WorkflowExecution: duration/cost/successRate/avgLatency/complexity) and per-workflow
`graph` (nodes/edges) on `?workflow=id`.

### GET /api/sessions  — Epic 6
List `sessions[]` (id, start/end, calls, cost, hasFailure). `?session=id` → reconstructed `timeline`
of ordered steps, each exposing its `raw` event for the JSON inspector.

### GET /api/models  — Epic 5
`models[]` and `providers[]` comparison (avgLatency/avgTokens/avgCost/throughput/tokenEfficiency/
errorRate).

### GET /api/recommendations  — Epic 7
`recommendations[]` (type/target/rationale/estimatedSaving/evidenceEventIds). Generated automatically
(no trigger param required), each referencing the raw events that justify it (SC-012).

### GET /api/alerts  /  PATCH /api/alerts/:id  — Epic 7
GET: `active[]` and `resolved[]` alerts (type/severity/entity/magnitude/evidenceEventIds). PATCH body
`{ status: "resolved" }`: flips alert state only; MUST NOT touch any raw event (FR-026).

### GET /api/search  — Epic 7 (cross-cutting)
`?q=` → matches across prompts, agents, workflows, sessions, models, providers; target < 500ms
(SC-008).

### GET /api/export  — Epic 7 (cross-cutting)
`?view=overview|prompts|…&format=json|csv` → exported analytics for the current filter.

## Error & honesty rules
- Missing/empty source → 200 with `present:false` and zeroed views (not 500).
- I/O/permission error reading the source → 500.
- Unpriced models → counted in tokens/calls, zero cost, flagged (never invented figures; Constitution V).
- Incompleteness (`skipped`, `unattributedCalls`, unpriced) is always surfaced in `meta`/views (FR-029).
