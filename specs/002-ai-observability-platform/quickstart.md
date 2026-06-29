# Quickstart & Validation: AI Observability Platform

Runnable scenarios that prove the platform works end to end. The correctness-critical paths
(normalization, dedup, reconciliation, replay) validate **offline** with no API key, per the
project's offline-verifiability principle.

## Prerequisites

- Python side: project `.venv` (ADK 2.3.0 installed) — for the Epic 1 emitter gate.
- Analytics side: Node.js 20+, dependencies installed in `frontend/` (`npm install`).
- An event store: the repo-root `usage_log.jsonl` (existing). For deterministic tests, fixtures live
  in `frontend/lib/__tests__/fixtures/` (canonical events, legacy events, and an anomaly set).

## Scenario 1 — Observation Foundation gate (Epic 1, Python, offline)

Proves the emitter writes a canonical `ObservationEvent` without breaking the NON-NEGOTIABLE tracking
guarantee.

```bash
.venv/Scripts/python.exe verify_tracking.py
```

Expected:
- All existing assertions pass (calls, token totals, all_priced, per-agent attribution).
- New assertions pass: each emitted record carries a non-empty `event_id`, a valid
  `attribution_status`, and the canonical fields; legacy lines normalize to `attribution_status =
  missing`.
- `input + output == total` still holds (thinking-fold preserved).

> After any tracking-wiring change, restart `adk web` (loader caches modules) before a live run.

## Scenario 2 — Reconciliation & cold start (Epic 2–3, offline)

Proves displayed totals equal the raw events exactly, malformed lines are skipped-and-counted, and an
empty source is a clean empty state.

```bash
cd frontend
npx vitest run lib/__tests__/overview.test.ts lib/__tests__/event-source.test.ts
```

Expected: total cost equals the decimal-exact sum of fixture events (zero discrepancy, SC-001);
duplicate fixtures collapse to one (SC-003); malformed lines increment `skipped` without aborting;
absent source returns `present:false` with zeroed views; unpriced events count tokens but add zero
cost.

## Scenario 3 — Attribution & per-domain analytics (Epics 4–6, offline)

```bash
cd frontend
npx vitest run lib/__tests__/normalize.test.ts lib/__tests__/prompts.test.ts \
  lib/__tests__/agents.test.ts lib/__tests__/workflows.test.ts lib/__tests__/sessions.test.ts
```

Expected: legacy→canonical normalization sets `attribution_status` correctly; per-prompt / per-agent
sums plus the `unattributed` bucket reconcile to the global total; agent hierarchy roll-up = own + Σ
children; workflow duration/cost/success computed; a session reconstructs steps in chronological order
with each step's `raw` event inspectable.

## Scenario 4 — Replay determinism & sink swap (FR-031 / SC-014, offline)

```bash
cd frontend
npx vitest run lib/__tests__/event-source.test.ts -t "replay"
```

Expected: aggregating the same event set twice yields byte-identical analytics; copying events to a
second (in-memory) `EventSource` produces identical aggregates — proving storage independence.

## Scenario 5 — Recommendations & alerts (Epic 7, offline)

```bash
cd frontend
npx vitest run lib/__tests__/recommend.test.ts lib/__tests__/alerts.test.ts
```

Expected: the anomaly fixture (a known cost spike for one prompt) raises a cost-spike alert naming the
prompt and magnitude; the repeated high-token prompt fixture yields a cache/optimize recommendation
with an estimated saving computed from the raw events; each alert/recommendation lists its
`evidenceEventIds`.

## Scenario 6 — Full dashboard (manual, end to end)

```bash
cd frontend
npm run dev   # http://localhost:3000
```

Walk the pages and confirm against the spec's user stories:
- **Overview** (US1): KPIs + cost-by-day/model/provider; totals match `usage_log.jsonl`.
- **Prompts** (US2): leaderboard ranks by cost; compare two prompts; view a prompt's trend.
- **Agents** (US3): per-agent metrics + hierarchy; failure rate reflects errors.
- **Sessions** (US4): pick a session → chronological timeline + JSON inspector.
- **Workflows / Models / Providers** (US5): comparisons and the execution graph.
- **Recommendations / Alerts** (US6): auto-generated items; resolve an alert and confirm no raw event
  changed.

Use `?from=&to=` on any page to confirm date-range filtering recomputes views without re-ingesting.

## Gate checklist before marking the feature done

- [ ] `verify_tracking.py` passes with the new field assertions (Constitution IV).
- [ ] Plugin remains wired in BOTH `run_demo.py` and each package `app=App(...)` (Constitution III,
      sync-both-seams).
- [ ] `npm test` (Vitest) green: reconciliation, dedup, normalize, replay, per-domain, recs/alerts.
- [ ] `npm run typecheck` clean.
- [ ] `usage_log.jsonl` unchanged in shape-compat: existing 001 dashboard still parses it.
