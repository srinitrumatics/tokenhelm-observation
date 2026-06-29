# AI Observability Platform (TokenHelm Analytics)

A read-only Next.js 15 / React 19 app that turns the ADK demos' append-only
`usage_log.jsonl` into operational analytics over a canonical **`ObservationEvent`** model:
cost/overview, prompt, agent, session, workflow, and model/provider analytics, plus
rule-based **recommendations** and **alerts**, cross-entity **search**, and **export**.

It **never writes** to the event log (Constitution III) and surfaces unpriced calls
honestly — they count tokens but contribute no cost (Constitution V). Every analytics view
is a pure, deterministic function of `ObservationEvent[]`, so totals reconcile decimal-exact
and replay reproduces identical results.

## Pages

| Route | What it shows |
|-------|---------------|
| `/` | Overview — KPIs, spend-over-time, cost by model/provider |
| `/prompts`, `/prompts/[prompt]` | Prompt leaderboard, versions, flags, detail |
| `/agents`, `/agents/[agent]` | Agent leaderboard, execution tree, rolled-up cost, detail |
| `/sessions`, `/sessions/[session]` | Session explorer, timeline, execution trace, JSON inspector |
| `/workflows`, `/workflows/[workflow]` | Workflow leaderboard, execution graph, trends |
| `/models` | Model & provider analytics + comparison |
| `/recommendations` | Optimization recommendations (category/severity filters, evidence) |
| `/alerts` | Operational alerts (active / timeline / history, acknowledge & resolve) |

## Prerequisites

- Node.js 20+ and npm.
- A `usage_log.jsonl` produced by the ADK cost tracker (or the demo, below).

## Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # USAGE_LOG_PATH defaults to ../usage_log.jsonl
```

## Run

```bash
npm run dev                      # http://localhost:3000 (development)
npm run build && npm run start   # production
```

### Try it with the end-to-end demo

```bash
python ../demo/run_demo_e2e.py                                  # emits demo/demo_usage_log.jsonl
USAGE_LOG_PATH=../demo/demo_usage_log.jsonl npm run dev         # then open localhost:3000
```

The demo drives the **real** tracking pipeline (tokenhelm pricing + tokenhelm-prompt
attribution + the canonical emitter) to produce a multi-agent "research-pipeline" trace —
a coordinator delegating to researcher/writer/critic/translator sub-agents, including a
failing sub-agent that surfaces a Reliability recommendation and a `failure-spike` alert.

## Storage backends (`EVENT_SOURCE`)

All API routes read through `getEventSource()` (`lib/observation/source.ts`), so the storage
backend is swappable with one env var and **zero analytics changes**:

```bash
# Default — append-only JSONL
EVENT_SOURCE=jsonl   # (or unset)

# DuckDB for large datasets
node scripts/ingest-duckdb.mjs ../usage_log.jsonl ../usage.duckdb
EVENT_SOURCE=duckdb DUCKDB_PATH=../usage.duckdb npm run start

# Scale benchmark (default 200k events; pass 10000000 for the full target)
node scripts/bench.mjs 200000
```

## Verify

```bash
npm test         # Vitest: aggregation precision, the 5 reconciliation identities,
                 # recommendations/alerts, search/export, DuckDB sink equivalence
npm run typecheck
```

The pure `lib/` parser/analytics are unit-tested offline with no API key or network
(Constitution IV). The consolidated reconciliation gate is `lib/__tests__/reconcile.test.ts`.

## How it works

- **`ObservationEvent`** (`lib/observation/event.ts`) is the only domain model. The Python
  emitter writes canonical records; `lib/observation/normalize.ts` also tolerates legacy
  records for backward compatibility.
- **`EventSource`** (`lib/observation/event-source.ts`) is the storage-agnostic seam —
  `JsonlEventSource` (v1) and `DuckDbEventSource` (scale) both implement it. See
  `../docs/event-source-plugin.md` to add your own.
- **`lib/analytics/*`** are pure functions. Each partitions ALL events into named groups +
  an explicit `unattributed` bucket, so reconciliation holds by construction. Cost is summed
  with `decimal.js` from the original strings — never floats.
- **Recommendations & alerts** (`lib/analytics/recommendations.ts`, `alerts.ts`) are
  *consumers* of those analytics — no independent aggregates. Alert lifecycle
  (acknowledge/resolve) lives in `lib/alert-state.ts` and never mutates events.

## Docs

- `../CONTRIBUTING.md` — governance process, v1.x compatibility commitments, contribution gate
- `../docs/roadmap.md` — v1.1 epics (SDK, protocol, connectors, tooling)
- `../docs/adr/0001-core-architecture.md` — **ADR**: the five validated architectural decisions (start here)
- `../docs/architecture.md` — system architecture & the five locked constraints
- `../docs/api.md` — REST API reference (all endpoints)
- `../docs/event-source-plugin.md` — adding a storage backend
- `../docs/deployment.md` — deployment & operations
