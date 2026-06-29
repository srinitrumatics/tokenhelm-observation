# ADR 0005 — PostgreSQL EventSource (connector ecosystem begins)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Supersedes:** none
- **Context:** v1.4 — connector ecosystem, first backend (`frontend/lib/observation/pg-source.ts`)

## Context / forces

The platform has shipped two `EventSource`s — `JsonlEventSource` (v1) and `DuckDbEventSource`
(scale, ADR 0001). The storage-agnostic seam (constraint #2) was designed so additional backends
slot in WITHOUT touching analytics. v1.4 begins the **connector ecosystem** by adding the most
requested SQL backend, PostgreSQL, and in doing so exercises the `docs/event-source-plugin.md`
guide end to end. Forces:

- Teams already run Postgres; a Postgres sink lets them keep observability data beside their app
  data and query it with familiar tooling.
- The new backend must produce **byte-identical analytics** to JSONL (the governance gate for any
  storage backend) and stay **read-only** (Constitution III).
- The reconciliation gate must run **offline** in CI — no Docker, no live server, no API key
  (every other gate is offline; this one must be too).

## Decision

Add `PostgresEventSource` (`frontend/lib/observation/pg-source.ts`) implementing the same
`EventSource` interface, mirroring `DuckDbEventSource` exactly:

- Canonical events live one-per-row in `observation_events(event_id text, "timestamp" text, doc
  text)`; `doc` is the full canonical JSON. `read()` parses each `doc`, runs the **same**
  `normalize()`, then `dedupeEvents()` + `sortEvents()` — so the event stream (and every analytic)
  is identical across sinks.
- The `pg` driver is imported **lazily** (only when a real pool is opened); merely importing the
  module never loads it. Registered in `getEventSource()` behind `EVENT_SOURCE=postgres`; `pg`
  added to `serverExternalPackages` in `next.config.ts`.
- **Injectable pool.** The constructor accepts a pre-built pool. Production resolves a real `pg`
  Pool from `PG_DSN`; the gate test injects an in-memory **`pg-mem`** pool, so it runs offline.
  An injected pool is never closed by the source (the caller owns its lifetime).
- Writing is the separate, explicitly-named `ingestJsonlToPostgres()` (+ `scripts/ingest-postgres.mjs`),
  never part of `read()` — the read path is strictly `SELECT`-only.
- Cold start: a missing table (`undefined_table` / `42P01`) or empty table ⇒ `present: false`, not
  an error. Table identifiers are validated against `^[A-Za-z_][A-Za-z0-9_]*$`; all values use
  parameterized queries.

No CI job is added — the gate runs inside the existing `frontend` vitest job.

## Compatibility review

Touches **storage only** (a new `EventSource` impl); no `ObservationEvent`/analytics change.

- **`v1.x` field compatibility:** unaffected — the event contract is untouched.
- **Reconciliation gate:** extended, green. `pg-source.test.ts` asserts
  `JSON.stringify(pgEvents) === JSON.stringify(jsonlEvents)` and all **five** reconciliation
  identities over the Postgres sink (global `0.017` / `1560`).
- **Replay determinism:** preserved — `sortEvents`/`dedupeEvents` are reused unchanged; same
  events ⇒ same deterministic order.
- **Identical-analytics requirement (the storage-backend gate in CONTRIBUTING):** met — proven by
  the byte-identical assertion, exactly mirroring `db-source.test.ts`.

## Rationale

- **Mirror, don't reinvent.** `read()` is a near-mechanical copy of the DuckDB path; all the hard
  parts (`normalize`, dedupe, sort) are imported, so there is no place for analytics to diverge.
- **Offline gate via `pg-mem`.** A real Postgres in CI would add a service container and make the
  gate non-deterministic/slow. `pg-mem` keeps the proof a fast, hermetic unit test — matching the
  embedded-DuckDB precedent. Production uses the real driver; the injectable pool is the seam.
- **Read-only + no insecure default.** `read()` only `SELECT`s; `PG_DSN` has no default (fail fast)
  and `describe()` strips credentials — safe by construction.

## Consequences

- (+) First connector shipped; the plugin guide is now proven, not theoretical. The pattern
  (mirror DuckDB, inject a pool, test with an in-memory engine) is the template for Redis Streams /
  OpenTelemetry / Kafka next.
- (+) Operators can run the dashboard directly on a Postgres table with one env var.
- (−) `pg-mem` emulates a SQL subset; it proves the read/ingest contract, not full Postgres
  fidelity (e.g. JSONB, concurrency). A real-Postgres smoke test is a sensible later addition,
  gated behind an opt-in service container so the default CI stays offline.
- (−) `read()` currently pulls the full table (like DuckDB v1); SQL-side push-down (GROUP BY,
  time-range) is a future optimization behind the same interface, with no analytics change.

## Validation

- **`frontend` (CI `frontend`):** `pg-source.test.ts` (4 tests) — byte-identical event stream vs
  JSONL, all five reconciliation identities over the Postgres sink, malformed-row skip-and-count,
  and cold-start `present:false`. Backed by `pg-mem` → fully offline. Frontend suite 125 → 129.
- Typecheck clean; `npm run build` succeeds with `pg` externalized.
