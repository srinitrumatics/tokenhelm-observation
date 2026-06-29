# Deployment & Operations Guide

This repository has two halves that meet at a single file:

- **(a) Producers — Google ADK 2.3.0 Python agent demos.** `single_agent/`,
  `multi_agent/`, and `pipeline_agent/` run on `gemini-3-flash-preview`. Every model
  call is priced and recorded by the `CostTrackingPlugin`, which appends canonical
  observation events to `usage_log.jsonl`.
- **(b) Consumer — the Next.js 15 / React 19 dashboard (`frontend/`).** A read-only
  cost/observability dashboard (`cost-analytics-dashboard`) that reads those events
  and turns them into summaries, trends, and breakdowns.

`usage_log.jsonl` is the **contract** between the two halves: the Python tracker
appends to it (write-only), the dashboard reads it (read-only, never writes — by
design). Everything in this guide is organized around that boundary.

```
┌──────────────────────┐        append-only         ┌───────────────────────┐
│  ADK agent demos     │  ───────────────────────▶  │  usage_log.jsonl      │
│  (Python, .venv)     │   CostTrackingPlugin        │  (canonical events)   │
└──────────────────────┘                             └───────────┬───────────┘
                                                                  │ read-only
                                                      ┌───────────▼───────────┐
                                                      │  Next.js dashboard    │
                                                      │  (frontend/)          │
                                                      │  EVENT_SOURCE=jsonl|  │
                                                      │              duckdb   │
                                                      └───────────────────────┘
```

---

## 1. Prerequisites

### Producer side (Python / ADK)

- **Python virtualenv at `.venv`** with ADK 2.3.0 already installed. Use it directly:
  - Windows: `.venv/Scripts/python.exe`
  - macOS/Linux: `.venv/bin/python`
- A **`GOOGLE_API_KEY`** is required to actually run an agent against Gemini (see the
  env table below). It is **not** required to validate the tracking pipeline offline
  (`python verify_tracking.py`).

### Consumer side (Next.js / dashboard)

- **Node.js 18.18+ (Node 20 LTS or newer recommended).** Next.js 15 and React 19
  require a modern Node runtime; Node 20 LTS is the safe default for both `next dev`
  and `next build`/`next start`.
- **npm** (the project ships a standard `package.json`; install with `npm install`
  from inside `frontend/`).
- **DuckDB binding** — `@duckdb/node-api` is a **native addon that ships prebuilt
  binaries** for common platforms, so no local C++ toolchain is normally needed. It is
  only loaded when `EVENT_SOURCE=duckdb`; the default JSONL path never touches it. It
  is also held out of the Next.js server bundle via `serverExternalPackages`
  (see `frontend/next.config.ts`).

---

## 2. Environment variables

Variables belong to one half or the other. Keep them straight — the dashboard never
reads `GOOGLE_*`, and the agents never read `USAGE_LOG_PATH`/`EVENT_SOURCE`/`DUCKDB_PATH`.

| Variable | Half | Where it lives | Default | Purpose |
|----------|------|----------------|---------|---------|
| `USAGE_LOG_PATH` | Consumer (dashboard) | `frontend/.env.local` | `../usage_log.jsonl` | Path to the append-only audit log. **Resolved relative to `frontend/`** (the dashboard's cwd); absolute paths are used as-is. Read-only. |
| `EVENT_SOURCE` | Consumer (dashboard) | `frontend/.env.local` | `jsonl` | Storage backend selector. `jsonl` (default) reads `USAGE_LOG_PATH`; `duckdb` reads a DuckDB file. The analytics layer is identical either way. |
| `DUCKDB_PATH` | Consumer (dashboard) | `frontend/.env.local` | `../usage.duckdb` | Path to the DuckDB database file (used only when `EVENT_SOURCE=duckdb`). Resolved relative to `frontend/`; absolute paths used as-is. `:memory:` is also accepted. |
| `GOOGLE_API_KEY` | Producer (agents) | project-root `.env` **and** each agent folder's `.env` | — (required to run agents) | AI Studio API key (https://aistudio.google.com/apikey). Needed for live model calls; not needed for `verify_tracking.py`. |
| `GOOGLE_CLOUD_LOCATION` | Producer (agents) | agent `.env` | — | Set to `global` on Vertex if you hit a model `404` (a `404` is almost always a location issue, not a bad model name). |

Notes on the producer side:

- `run_demo.py` reads the **project-root** `.env`.
- `adk web` / `adk run` read a `.env` from **each agent folder**, so copy or symlink the
  root `.env` into `single_agent/`, `multi_agent/`, and `pipeline_agent/`.

On the consumer side, copy the example file and edit as needed:

```bash
cd frontend
cp .env.local.example .env.local   # then edit USAGE_LOG_PATH / EVENT_SOURCE if needed
```

`.env.local.example` ships with `USAGE_LOG_PATH=../usage_log.jsonl` and
`EVENT_SOURCE=jsonl`.

---

## 3. Producing events (Python / ADK side)

The agents emit canonical **ObservationEvents** to `usage_log.jsonl` automatically.
The seam is the `CostTrackingPlugin` (an ADK `BasePlugin`) whose `after_model_callback`
fires on **every** model response from **every** agent — including the extra
round-trips from tool calls and sub-agent delegation. That single hook is why "every
call is tracked" holds across all three demo patterns. It is wired in two places that
must stay in sync:

- `run_demo.py` registers the plugin on the `Runner` (plain-Python path).
- each package `__init__.py` exposes `app = App(root_agent=..., plugins=[CostTrackingPlugin()])`,
  which is what makes `adk web` / `adk run` track calls (they prefer a module-level
  `app` over a bare `root_agent`).

### Run an agent (live, needs `GOOGLE_API_KEY`)

```bash
# Plain Python, defaults to single_agent — reads project-root .env
python run_demo.py "What's the weather in Tokyo?"

# Interactive web UI — pick any of the three agents, inspect state/traces/events
adk web .

# CLI chat with one agent
adk run single_agent
```

Each successful call is priced from `pricing.yaml` and appended to `usage_log.jsonl`
as one JSON line. (The Gemini 3 rates in `pricing.yaml` are **placeholder estimates** —
replace them with official numbers before trusting dollar figures. Unlisted models are
still token-tracked but reported `priced=false` at cost 0.)

### Validate the pipeline offline (no API key)

```bash
python verify_tracking.py
```

This feeds fake `LlmResponse`s through the tracker and asserts the log/summary
end-to-end **without any API key**. It is the fastest way to validate changes to the
tracking layer.

### Gotcha: a call is tracked only once it succeeds

A failed call (e.g. a bad API key, or a model `404`) errors **before** producing usage,
so nothing is recorded until the key works. If you run an agent and the dashboard stays
empty, check that the call actually succeeded.

---

## 4. Running the dashboard (Next.js / consumer side)

All commands run from inside `frontend/`. The dashboard is **read-only** over the log:
it opens `usage_log.jsonl` (or the DuckDB file), validates and aggregates in memory, and
never writes back.

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev            # next dev — http://localhost:3000
```

### Production

```bash
npm run build          # next build
npm run start          # next start — serves the built app
```

### Quality gates

```bash
npm test               # vitest run — the real test suite (lib/__tests__), offline, no API key
npm run test:watch     # vitest in watch mode
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
```

The pure `lib/` parser/aggregator is the unit-tested seam, so `npm test` runs fully
offline. Malformed log lines are **skipped and counted**, never fatal — a single bad
line never breaks the dashboard.

> The only npm scripts that exist are `dev`, `build`, `start`, `lint`, `test`,
> `test:watch`, and `typecheck`. There are no other helper scripts beyond the two
> `.mjs` files in `scripts/` (below).

---

## 5. Switching to DuckDB for scale

For large event volumes you can swap the JSONL backend for a columnar DuckDB file
**without changing any analytics code** — every API route depends only on the
`EventSource` interface, and the backend is chosen by `EVENT_SOURCE` (see
`frontend/lib/observation/source.ts`).

### Runbook

```bash
cd frontend

# 1. Ingest the JSONL log into a DuckDB table (normalize-once-at-write).
#    Args: [jsonlPath] [dbPath]; both default from USAGE_LOG_PATH / DUCKDB_PATH.
node scripts/ingest-duckdb.mjs ../usage_log.jsonl ../usage.duckdb

# 2. Point the app at the DuckDB file.
EVENT_SOURCE=duckdb DUCKDB_PATH=../usage.duckdb npm run start
```

The ingest script creates an `observation_events(event_id, timestamp, doc)` table where
`doc` is the full canonical JSON line. The DuckDB source parses and normalizes `doc`
exactly as the JSONL source does, so results are byte-identical across backends. Re-run
`ingest-duckdb.mjs` to refresh the DuckDB file after new events are appended (it
`CREATE TABLE IF NOT EXISTS` and inserts; for a clean rebuild, delete the `.duckdb` file
first).

On Windows / PowerShell, set the env vars inline differently:

```powershell
$env:EVENT_SOURCE = "duckdb"; $env:DUCKDB_PATH = "../usage.duckdb"; npm run start
```

### Benchmarking

```bash
node scripts/bench.mjs            # default 200,000 synthetic events
node scripts/bench.mjs 10000000  # the full 10M-event target
```

`bench.mjs` generates synthetic events and compares two strategies over the **same**
data: the JSONL v1 path (read + `JSON.parse` every line + aggregate in JS) versus the
DuckDB path (push the `GROUP BY` into columnar SQL).

### Honest numbers and the current ceiling

- **JSONL full-parse:** ~22 s to read+parse+aggregate at 10M events.
- **DuckDB SQL `GROUP BY`:** ~5.7 s at 10M events.

DuckDB is a large win, but note that the v1 `DuckDbEventSource` still returns the **full
event set** through the `EventSource` interface and aggregates in JS like the JSONL
path — the benchmark's ~5.7s figure is the SQL aggregation pushed down, which the app
does not yet do at request time. Hitting the **2s-at-10M** dashboard target requires a
future **AggregatingEventSource** that pushes `GROUP BY` into SQL at request time
*without* touching the analytics layer. Until that lands, DuckDB mainly buys you faster
cold reads and headroom, not the 2s target.

---

## 6. Production notes & known limitations

- **The dashboard never writes the log (immutability).** Both the JSONL and DuckDB
  sources are strictly read-only. The producer (Python tracker) is the only writer.
  This is enforced by design and is what lets producer and consumer run independently.
- **Alert lifecycle state is in-process and ephemeral.** Acknowledge/resolve actions on
  alerts live only in server memory and **reset on restart** (and are not shared across
  multiple instances). This is a known limitation — it is purely UI/operational state
  and does **not** touch the underlying events, so no observability data is lost when it
  resets. If you run multiple replicas or restart frequently, expect alert ack/resolve
  state to be lost.
- **`Cache-Control: no-store`.** The usage API reads the log fresh on every request
  (no caching), so each request reflects newly appended events. New agent activity shows
  up on the next refresh — no dashboard restart required to see new data. (The
  `EventSource` layer additionally fingerprints the file by size+mtime, so an unchanged
  log re-reads cheaply while a changed log triggers a fresh parse.)
- **Restart `adk web` after editing tracking wiring.** The ADK agent loader **caches
  modules**, so changes to `cost_tracking.py` or the `app = App(...)` wiring in a
  package `__init__.py` are not picked up until you restart `adk web` / `adk run`.
- **Keep the two plugin registrations in sync.** If you add a run path or change the
  plugin, update **both** `run_demo.py` and the package `__init__.py` files, or some run
  paths will silently stop tracking.

---

## 7. Container / reverse-proxy sketch

The dashboard is a standard Next.js app; the only wrinkle is keeping the native DuckDB
binding **external** to the bundle (already configured via `serverExternalPackages` in
`next.config.ts`) and mounting the shared event store.

### Dockerfile outline (Next.js dashboard)

```dockerfile
# frontend/Dockerfile
FROM node:20-slim AS base
WORKDIR /app

# Install deps (includes @duckdb/node-api prebuilt binaries).
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Build the Next app. @duckdb/node-api stays external (next.config.ts
# serverExternalPackages) so it is never bundled into the server output.
COPY frontend/ ./
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Default backend; override at runtime to switch to DuckDB.
ENV EVENT_SOURCE=jsonl
ENV USAGE_LOG_PATH=/data/usage_log.jsonl
# ENV EVENT_SOURCE=duckdb
# ENV DUCKDB_PATH=/data/usage.duckdb

EXPOSE 3000
CMD ["npm", "run", "start"]
```

### Mounting the shared event store

The producer writes `usage_log.jsonl`; the dashboard container must be able to read it.
Mount the shared file (or DuckDB file) into the container and point the env var at the
mount:

```bash
# JSONL backend — mount the directory holding the log read-only.
docker run --rm -p 3000:3000 \
  -v /srv/observability:/data:ro \
  -e EVENT_SOURCE=jsonl \
  -e USAGE_LOG_PATH=/data/usage_log.jsonl \
  cost-analytics-dashboard

# DuckDB backend — ingest first (writes the .duckdb file), then serve it.
node frontend/scripts/ingest-duckdb.mjs /srv/observability/usage_log.jsonl /srv/observability/usage.duckdb
docker run --rm -p 3000:3000 \
  -v /srv/observability:/data:ro \
  -e EVENT_SOURCE=duckdb \
  -e DUCKDB_PATH=/data/usage.duckdb \
  cost-analytics-dashboard
```

Notes:

- A **read-only mount (`:ro`)** for the dashboard is correct and recommended — the
  consumer never writes, so denying writes at the mount enforces the contract.
- Because the API uses `Cache-Control: no-store` and fingerprints the file, the
  dashboard reflects appends to the mounted log on the next request — no container
  restart needed for the JSONL backend. For the DuckDB backend, re-run
  `ingest-duckdb.mjs` to refresh the file (its mount can be read-only for the
  dashboard; the ingest step writes it).
- The DuckDB binding releases its file lock after each read (important on Windows), so
  the same `.duckdb` file can be re-ingested between reads.

### Reverse proxy

Put any standard reverse proxy (nginx, Caddy, Traefik) in front of port 3000.
The app serves over plain HTTP; terminate TLS at the proxy. Example nginx location:

```nginx
location / {
    proxy_pass         http://dashboard:3000;
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

No special buffering or websocket config is required for the read-only dashboard.
```
