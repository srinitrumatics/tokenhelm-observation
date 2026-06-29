# ADR 0001 — Core Architecture of the AI Observability Platform

- **Status:** Accepted — locked for **v1.0**
- **Date:** 2026-06-29
- **Supersedes:** none
- **Context:** TokenHelm Analytics / AI Observability Platform (`specs/002-ai-observability-platform/`)
- **Audience:** future contributors. This ADR is the reference for the architectural
  principles that must be preserved as the platform grows into SDKs, packaging, and
  ecosystem integrations (v1.1+).

---

## Summary

The platform turns immutable TokenHelm / tokenhelm-prompt events into operational
intelligence (cost, prompts, agents, sessions, workflows, models, recommendations,
alerts, search, export). Five architectural decisions define it. They were not just
designed — each was **validated under test and at runtime** during the v1.0 build, and
this ADR records both the decision and the evidence so the principles survive future
change.

| # | Decision | One-line rationale |
|---|----------|--------------------|
| 1 | `ObservationEvent` is the canonical contract | One domain model everything agrees on |
| 2 | `EventSource` is the storage abstraction | Storage is swappable; analytics never change |
| 3 | Events are immutable; replay is first-class | The log is the truth; views are rebuildable |
| 4 | All analytics are **derived**, never stored | No second source of truth to drift |
| 5 | Reconciliation is a **release gate** | "Totals match the events" is enforced, not hoped |

---

## Project positioning

This project is **an Observation Platform for AI Systems**, not "another observability
dashboard." The layering makes the distinction concrete and is the north star for every
future decision:

- **TokenHelm** is the *instrumentation* layer (it captures usage/cost).
- **`ObservationEvent`** is the *protocol* (the contract between producers and consumers).
- **`EventSource`** is the *storage abstraction* (where the protocol's events live).
- **Everything else** — analytics, dashboards, recommendations, alerts, search, export,
  and future evaluation/observability integrations — is *built on top of that protocol*.

The goal is infrastructure (a protocol + abstractions others build on), not a single
application. The dashboard shipped in v1.0 is the *first consumer* of the protocol, not the
product itself.

---

## Decision 1 — `ObservationEvent` is the canonical contract

**Decision.** A single typed model, `ObservationEvent`
(`frontend/lib/observation/event.ts`), is the only domain object that analytics, APIs,
dashboards, recommendations, and alerts operate on. The Python emitter
(`cost_tracking.py::build_observation_event`) writes canonical records directly; the
TypeScript `normalize()` tolerantly upgrades legacy and partial records into the same
shape. No module imports a storage-specific schema.

**Context / forces.** Modern AI apps emit cost/usage from many places — agents, prompts,
tools, sub-agent delegation, multiple providers. Without one contract, every analytics
view would re-interpret raw records differently and answers would disagree. The original
TokenHelm JSONL records already existed and could not be broken.

**Rationale.**
- A single contract makes every view *comparable by construction* — a "prompt" means the
  same thing to the prompt leaderboard, the session trace, and the recommendation engine.
- Attribution is made **honest, not hidden**: `attribution_status` ∈
  `complete | partial | missing` is a first-class field, so unattributable events are
  surfaced (an explicit `unattributed` bucket) rather than silently dropped.
- Money is always a **decimal string** with an explicit `metadata.priced` flag, so
  token-tracked-but-unpriced calls count tokens and contribute **zero** cost rather than a
  fabricated number.

**Consequences.**
- (+) New producers (future Python/TS SDKs) have exactly one thing to emit.
- (+) Backward compatibility is a normalization concern, isolated in one file.
- (−) Schema changes are high-leverage and must be deliberate (see Decision 5 — they must
  pass reconciliation). This is intended friction.

**Validation.** `verify_tracking.py` validation #3 asserts canonical fields are emitted,
ids are unique, and `input + output == total`. Validation #4 proves a legacy-shaped record
and its canonical counterpart aggregate identically. The 001 cost dashboard still parses
the canonical superset unchanged.

---

## Decision 2 — `EventSource` is the storage abstraction

**Decision.** All reads go through the `EventSource` interface
(`frontend/lib/observation/event-source.ts`: `read()`, `fingerprint()`, `describe()`).
Concrete bindings — `JsonlEventSource` (v1) and `DuckDbEventSource` (scale) — implement it.
Every API route resolves its source via `getEventSource()`
(`frontend/lib/observation/source.ts`), selected by the `EVENT_SOURCE` env var. Analytics
depend only on the interface and `ObservationEvent[]`, never on a storage format.

**Context / forces.** JSONL is perfect for a local demo and append-only auditing but does
not scale to millions of events. We needed a path to scale **without** rewriting the
analytics layer, and without committing prematurely to one database.

**Rationale.**
- The seam isolates *where events live* from *what we compute*. Storage can evolve
  (DuckDB, PostgreSQL, OTel, Redis Streams) while the analytics stay fixed.
- Every implementation honors the same invariants — read-only, normalize, dedupe by
  `event_id`, deterministic order (`sortEvents`), skip-and-count malformed, cold-start =
  `present: false` — so any conformant source yields identical analytics.

**Consequences.**
- (+) Adding a backend is a documented, contained task (`docs/event-source-plugin.md`).
- (+) Native/optional drivers are lazy-loaded and externalized (`next.config.ts`
  `serverExternalPackages`), so the default path never pays for them.
- (−) **Honest scale caveat:** the interface returns the full event set, so the v1 DuckDB
  binding swaps *storage/ingest*, not aggregation. Hitting the 2s-at-10M target needs a
  future `AggregatingEventSource` that pushes the analytics GROUP BYs into SQL — an
  *extension* of this seam, not a redesign. Bench (200k): JSONL full-parse ~22s/10M;
  DuckDB SQL GROUP BY ~5.7s/10M (`frontend/scripts/bench.mjs`).

**Validation.** `frontend/lib/__tests__/db-source.test.ts` ingests the shared fixture into
DuckDB and asserts `JSON.stringify(duckEvents) === JSON.stringify(jsonlEvents)` and that
reconciliation still holds. At runtime, the full dashboard was served from
`EVENT_SOURCE=duckdb` and returned byte-identical analytics to the JSONL path — storage
independence proven under a real server, not just unit tests.

---

## Decision 3 — Events are immutable; replay is first-class

**Decision.** The event log is append-only and never mutated by the platform. Because every
view is a pure function of `ObservationEvent[]`, "replay" is simply re-reading the source
and recomputing (`frontend/lib/observation/replay.ts`: `replay`, `migrate`). Mutable
operational state that genuinely must change — alert lifecycle (acknowledged/resolved) —
lives in a **separate** store (`frontend/lib/alert-state.ts`) and never touches an event.

**Context / forces.** Observability data is an audit trail. If the platform could rewrite
events, every derived number would be suspect and history could not be trusted. Yet some
state (an operator acknowledging an alert) must change.

**Rationale.**
- Immutability makes the log the **single trustworthy record**; derived views can be
  thrown away and rebuilt at any time with no app rerun.
- Determinism (no wall-clock or randomness inside aggregation; ids derived from data;
  timestamps data-derived) means replay is **reproducible** — the same events always
  produce the same analytics, recommendations, and alerts.
- Separating lifecycle state preserves immutability *without* losing necessary mutability.

**Consequences.**
- (+) Storage migrations are safe: copy events to a new sink, recompute, compare.
- (+) Recommendations/alerts are reproducible across restarts and machines.
- (−) Alert lifecycle state is currently in-process and ephemeral (resets on restart) — a
  deliberate v1.0 limitation documented in `docs/deployment.md`; it can later be persisted
  *outside* the event log without violating this principle.

**Validation.** Replay-equivalence is asserted in `verify_tracking.py` #5 (replay == live
totals), in the recommendations/alerts tests (identical output after `migrate`+`replay`),
and in `reconcile.test.ts` (all five identities survive a storage migration). The US6 tests
prove acknowledging/resolving an alert changes only lifecycle state and leaves the event
log byte-identical (md5 verified at runtime).

---

## Decision 4 — All analytics are derived, never stored

**Decision.** There are no pre-computed/materialized analytics tables. Overview, prompts,
agents, sessions, workflows, models, recommendations, alerts, search, and export are all
pure functions over the event stream (`frontend/lib/analytics/*`). Recommendations and
alerts are **consumers** of the other analytics' validated outputs — they compute no
independent aggregates.

**Context / forces.** The classic failure mode of observability systems is a derived store
that drifts from the source. We explicitly wanted "every dashboard number is reproducible
from raw events" to be true, not aspirational.

**Rationale.**
- With one source of truth and pure derivation, there is **nothing to drift**.
- Each analytics module partitions *all* events into named groups + an explicit
  `unattributed` bucket, so totals add up *by construction*.
- Making recommendations/alerts consumers (not new engines) means a rule can never disagree
  with the leaderboard it summarizes — evidence (`related_event_ids`) always traces back to
  real events.

**Consequences.**
- (+) Adding a view never adds a sync/migration burden.
- (+) Recommendation/alert rules stay thin and explainable.
- (−) Heavy aggregation happens at read time — the motivation for the
  `AggregatingEventSource` extension noted in Decision 2 (push GROUP BYs into storage)
  rather than caching derived results in a second store.

**Validation.** The per-story reconciliation tests plus the consolidated
`reconcile.test.ts` prove derived totals equal the global totals. US6 tests prove every
recommendation references ≥1 existing event and every alert is derived from an existing
aggregator.

---

## Decision 5 — Reconciliation is a release gate

**Decision.** Five identities are enforced as **automated tests**, not documentation, and
must pass for cost *and* tokens, decimal-exact:

1. Σ prompt cost + unattributed = global
2. Σ agent root rollups + unattributed = global (parent/child-aware)
3. Σ workflow cost + unattributed = global
4. Σ model cost = global
5. Σ provider cost = global

They live in `frontend/lib/__tests__/reconcile.test.ts` (consolidated, one shared fixture)
and in each per-story test, using `decimal.js` from the original cost strings — never
floats — mirroring the Python `Decimal` path so the two halves of the repo agree.

**Context / forces.** "The dashboard totals match the events" is the platform's core
promise. A promise that isn't tested is a promise that breaks silently.

**Rationale.**
- Turning the promise into a gate means any change that breaks a total fails CI, not
  production. It is the executable expression of Decisions 1–4.
- Decimal-exact (not "close enough") catches floating-point drift that would otherwise
  accumulate over millions of events.

**Consequences.**
- (+) Refactors and new backends are safe — break a total and the gate stops you (it caught
  real issues during the build).
- (+) The gate is the single check that proves Decisions 1–4 still hold together.
- (−) New entity dimensions must add their reconciliation identity. Intended friction.

**Validation.** `reconcile.test.ts` (6 tests, all five identities for cost and tokens, plus
a post-migration replay check) is green; the consolidated and per-story suites run on every
`npm test`. Full v1.0 gate: **116/116 Vitest**, typecheck clean, production build, and
`verify_tracking.py` (5/5) — all offline.

---

## Implications for v1.1+ (preserving these principles as we grow)

The next milestone (SDKs, packaging, integrations, real-world validation) must extend this
architecture, not bypass it:

- **Observation SDKs (Python/TS)** are *producers* — their only job is to emit valid
  `ObservationEvent`s (Decision 1). The SDK boundary is the `ObservationEvent` spec.
- **New backends (PostgreSQL, OTel bridge, Redis Streams)** are `EventSource`
  implementations behind `getEventSource()` (Decision 2) — they add a value to
  `EVENT_SOURCE`, never a new analytics path.
- **Prometheus / Grafana / evaluation tools (e.g. Opik)** are *consumers* of the same
  immutable stream and derived analytics (Decisions 3–4) — they read events, they do not
  become a competing source of truth.
- **Any schema change** to `ObservationEvent` must keep the reconciliation gate green and
  preserve legacy normalization (Decisions 1 & 5). Refine the schema only when real usage
  exposes a genuine gap.
- **Performance work** is the `AggregatingEventSource` extension (push aggregation into
  storage), not a materialized-analytics cache (which would reintroduce drift — Decision 4).

### The v1.1 contribution gate

From v1.0 onward the six principles above are **architectural invariants** — they change
only on compelling evidence from production deployments, never for convenience. Every new
contribution must answer one question before it is accepted:

> **Does this extend the `ObservationEvent` ecosystem, or does it introduce a parallel model?**

- If it introduces a **parallel model** (a second source of truth, a storage-specific
  schema leaking into analytics, a materialized-analytics store, or an event mutation) it is
  **rejected or redesigned**.
- If it **extends the ecosystem** — an SDK that emits `ObservationEvent`s, an `EventSource`
  implementation, a consumer of the immutable stream, or developer tooling on top of the
  protocol — it fits the long-term direction.

---

## References

- Spec & constraints: `specs/002-ai-observability-platform/plan.md`, `tasks.md`
- Architecture: `docs/architecture.md`
- API: `docs/api.md` · EventSource plugins: `docs/event-source-plugin.md` · Ops: `docs/deployment.md`
- Canonical model: `frontend/lib/observation/event.ts`
- Storage seam: `frontend/lib/observation/event-source.ts`, `source.ts`, `jsonl-source.ts`, `db-source.ts`
- Reconciliation gate: `frontend/lib/__tests__/reconcile.test.ts`
- Offline pipeline proof: `verify_tracking.py` · End-to-end demo: `demo/run_demo_e2e.py`
