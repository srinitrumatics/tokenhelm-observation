# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Three minimal **Google ADK 2.3.0** agent demos, each illustrating one pattern, plus a shared
cost/token-tracking layer that prices every model call. All agents use `gemini-3-flash-preview`.

| Package | Pattern | Key mechanism |
|---------|---------|---------------|
| `single_agent/` | One LLM + Python function tools | Function docstring + type hints become the tool schema; tools write to `tool_context.state` |
| `multi_agent/` | Coordinator + LLM-driven delegation | `sub_agents=[...]`; the model reads each sub-agent's `description` to decide who handles the turn |
| `pipeline_agent/` | Deterministic `SequentialAgent` | Each stage writes via `output_key`; the next stage reads it with a `{placeholder}` in its instruction |

## Commands

The virtualenv at `.venv` already has ADK installed. Use it directly (Windows: `.venv/Scripts/python.exe`).

```bash
# Run a single agent from plain Python (defaults to single_agent)
python run_demo.py "What's the weather in Tokyo?"

# Interactive web UI — pick any of the three agents, inspect state/traces/events
adk web .

# CLI chat with one agent
adk run single_agent

# Verify the cost-tracking pipeline end-to-end WITHOUT an API key
# (feeds fake LlmResponses through the tracker + asserts the log/summary)
python verify_tracking.py
```

The Python side has no lint/test suite — `verify_tracking.py` is the closest thing to a test and is
the fastest way to validate changes to the tracking layer offline. (The `frontend/` app *does* have
a Vitest suite — see its section below.)

**Credentials:** agents need `GOOGLE_API_KEY` (from https://aistudio.google.com/apikey) in `.env`.
`run_demo.py` reads `.env` at the project root; `adk web`/`adk run` read a `.env` from **each agent
folder**, so copy/symlink the root `.env` into `single_agent/`, `multi_agent/`, `pipeline_agent/`.

## Cost tracking — the cross-cutting architecture

This is the part that spans multiple files and is easy to break. Everything funnels through
`cost_tracking.py`, which is built on the `tokenhelm` package:

- **`CostTrackingPlugin`** is an ADK `BasePlugin` whose `after_model_callback` fires on **every**
  model response from **every** agent (including the extra round-trips from tool calls and
  sub-agent delegation). This single seam is why "everything is tracked" holds for all three patterns.
- It is wired in **two** places so all run paths are covered — keep both in sync:
  - `run_demo.py` registers it on the `Runner`.
  - each package `__init__.py` exposes `app = App(root_agent=..., plugins=[CostTrackingPlugin()])`.
    `adk web`/`adk run` prefer a module-level `app` over a bare `root_agent`, so this is what makes
    the UI/CLI track calls.
- **Thinking tokens:** `gemini-3-flash-preview` is a reasoning model. `_fold_thinking_into_output()`
  rolls Gemini's `thoughts_token_count` into `candidates_token_count` (on a copy of the response)
  before tracking, so `input + output == total` and reasoning tokens get priced at the output rate.
  This is why reported `output_tokens` is larger than Gemini's raw `candidates_token_count`.
- **Pricing** comes from `pricing.yaml`, layered on top of tokenhelm's bundled rates (entries here
  win by `(provider, model)`). The Gemini 3 rates are **placeholder estimates** — replace with
  official numbers before trusting dollar figures. Unlisted models are still token-tracked but
  reported `priced=false`, cost 0.
- Output sinks: a `[tokenhelm] …` console line + a summary box, plus an append-only audit trail at
  `usage_log.jsonl`. `summarize()`/`print_summary()` aggregate the in-memory `STORAGE`.
- **Per-prompt attribution** (`tokenhelm-prompt`): the console/JSONL/`STORAGE` pipeline is built
  explicitly as a `DefaultEventDispatcher` (`_sinks`) and wrapped by `make_dispatcher(inner=_sinks,
  store=PROMPT_STORE)`, which is passed to `TokenHelm(dispatcher=…)`. **Gotcha:** an explicit
  `dispatcher` *replaces* tokenhelm's `logger=`/`storage=` pipeline, so those sinks must be wired
  through `_sinks` — not the `TokenHelm` kwargs. The wrapper records each event against the active
  prompt scope (forwarding the unmodified event onward), so it's purely additive. The plugin opens
  `PROMPT_TRACKER.prompt(agent_name)` around `track()` — each demo agent has one instruction, so
  **agent == prompt**. Read it back with `summarize_prompts()`/`print_prompt_summary()` (via
  `tokenhelm_prompt.analytics.by_prompt()`). These costs are floats for breakdown only — the
  Decimal-precise totals stay in `summarize()` and the JSONL log. Both the prompt scope and
  `_current_agent` are contextvar-based, so attribution survives ADK's concurrent agent tasks.

### Gotchas

- Cost prints to the **terminal running `adk web`**, *not* the browser page (the trace view shows
  token counts but not tokenhelm's cost line).
- After editing tracking wiring, **restart `adk web`** — the agent loader caches modules.
- A call is tracked only once it **succeeds**; a failed call (e.g. bad API key) errors before
  producing usage, so nothing is recorded until the key works.

## Frontend dashboard (`frontend/`)

A read-only **Next.js 15 / React 19** app (`cost-analytics-dashboard`) that turns the
backend's `usage_log.jsonl` into cost/token analytics. It is a separate npm project — run all
commands from inside `frontend/`:

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
npm test             # Vitest — the real test suite for this repo (lib/__tests__)
npx vitest run lib/__tests__/aggregate.test.ts   # one test file
npx vitest run -t "summary"                       # one test by name pattern
npm run test:watch   # single-run is `npm test`; this watches
npm run lint         # next lint
npm run typecheck    # tsc --noEmit
npm run build && npm run start   # production
```

`usage_log.jsonl` is the **contract between the two halves of the repo**: the Python tracker
appends to it (write-only), the dashboard reads it (read-only, never writes — by design).
`USAGE_LOG_PATH` (in `frontend/.env.local`, copy from `.env.local.example`) resolves relative to
`frontend/` and defaults to `../usage_log.jsonl`.

Architecture:
- `app/api/usage/route.ts` — `GET /api/usage`, reads the log fresh per request (`no-store`),
  Zod-validates each line, **skips malformed lines** (but counts them), returns `{ records, summary, meta }`.
- `lib/aggregate.ts` — summaries/trends/breakdowns. Cost is summed with **`decimal.js` from the
  original strings, never floats**, mirroring the backend's `Decimal` use so totals match exactly.
- `app/page.tsx` — client dashboard; fetches once via `useUsage()`, filters by date range and
  recomputes every view in-memory.
- The pure `lib/` parser/aggregator is the unit-tested seam — tests run **offline, no API key**.

Unpriced calls are surfaced honestly: they count tokens but contribute **zero cost** (same rule as
the backend's `priced=false`).

### Observability platform (spec 002, on top of the 001 dashboard)

The `frontend/` app has grown into the full **AI Observability Platform** while keeping the 001
dashboard intact (`/api/usage` + `lib/aggregate.ts` are untouched). Key additions:

- **Canonical model & analytics:** `lib/observation/` (the `ObservationEvent` schema, `EventSource`
  interface, `normalize`, `replay`) + `lib/analytics/` (overview, prompts, agents, sessions,
  workflows, models, **recommendations**, **alerts**, **search**, **export**). Every analytics
  module partitions all events into named groups + an explicit `unattributed` bucket, so the five
  reconciliation identities hold by construction — gated by `lib/__tests__/reconcile.test.ts`.
- **Pages:** Overview `/`, `/prompts`, `/agents`, `/sessions`, `/workflows`, `/models`,
  `/recommendations`, `/alerts` (nav in `app/layout.tsx`).
- **Recommendations & alerts are CONSUMERS** of the validated analytics (no independent
  aggregates). Alert lifecycle (acknowledge/resolve) lives in `lib/alert-state.ts` and **never**
  mutates `ObservationEvent`s; ids are deterministic and timestamps are data-derived, so replay
  reproduces identical recs/alerts.
- **Storage selector:** every API route reads through `getEventSource()` (`lib/observation/source.ts`),
  chosen by `EVENT_SOURCE` (`jsonl` default | `duckdb` | `postgres`). `DuckDbEventSource`
  (`lib/observation/db-source.ts`) is the scale path; `PostgresEventSource` (`lib/observation/pg-source.ts`,
  v1.4/ADR 0005) is the first connector — both behind the same interface, each driver lazy-loaded and
  externalized in `next.config.ts`, only loaded when selected. Ingest: `scripts/ingest-duckdb.mjs` /
  `scripts/ingest-postgres.mjs`; benchmark: `scripts/bench.mjs` (honest numbers: JSONL full-parse
  ~22s/10M, DuckDB SQL GROUP BY ~5.7s/10M). Each new backend must prove byte-identical analytics vs
  the JSONL fixtures (`pg-source.test.ts` uses in-memory `pg-mem`, fully offline).
- **End-to-end demo:** `demo/run_demo_e2e.py` drives the **real** pipeline offline to emit a
  multi-agent trace to `demo/demo_usage_log.jsonl` (point the dashboard at it via `USAGE_LOG_PATH`).
- **Docs:** `docs/adr/0001-core-architecture.md` (the v1.0 ADR — the canonical record of the five
  validated architectural decisions; read it before changing the foundation), `docs/architecture.md`,
  `docs/api.md`, `docs/event-source-plugin.md`, `docs/deployment.md`.

## Other notes

- `SequentialAgent` (in `pipeline_agent`) is marked deprecated in ADK 2.3.0 in favor of the
  graph-based `Workflow` API but still works and is the simplest linear-pipeline expression.
  Migrate only if you need branching/parallel graphs.
- A model `404` is almost always a location issue, not the model name — set
  `GOOGLE_CLOUD_LOCATION=global` (Vertex) or use AI Studio.
- This repo is also initialized for **Spec Kit** (`/speckit-*` slash commands, `.specify/`); the
  managed block below points future work at the active plan when one exists.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/002-ai-observability-platform/plan.md` (AI Observability Platform — turns
TokenHelm/tokenhelm-prompt events into a unified observability platform around a canonical
`ObservationEvent` contract: a Python emitter enrichment in `cost_tracking.py` plus a storage-agnostic
analytics layer in `frontend/` (`lib/observation/` + `lib/analytics/`). Builds on the shipped Cost
Analytics Dashboard at `specs/001-cost-analytics-dashboard/plan.md`).
<!-- SPECKIT END -->
