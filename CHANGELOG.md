# Changelog

All notable changes to the AI Observability Platform (TokenHelm Analytics).

## [Unreleased] — v1.2 (branch `feat/observation-sdk-typescript`)

### Added
- **Observation SDK (TypeScript / Node)** under `sdk/typescript/`
  ([ADR 0003](docs/adr/0003-typescript-observation-sdk.md)) — a standalone, dependency-free
  producer SDK targeting **protocol parity** with the Python SDK: `ObservationClient`,
  `ObservationContext`, `ObservationEventBuilder`, `ObservationEmitter`, transports
  (JSONL / in-memory / HTTP), **`AsyncLocalStorage`-based** attribution propagation, and
  protocol validation before transport. The API is idiomatic for Node (callback scopes), not a
  transliteration of Python.
- Cross-**language** parity gate `frontend/lib/__tests__/sdk-parity.test.ts` — the Python- and
  TypeScript-emitted fixtures are field-for-field identical except `metadata.sdk`, and the
  platform produces identical analytics from both (5 reconciliation identities, global
  `0.017` / `1560`). New SDK Vitest suite (24 tests); platform suite now 125 tests.
- CI gains a stable `typescript-sdk` job, added to the `gates` aggregate (existing job names
  unchanged, so branch protection stays valid).

### Unchanged (compatibility preserved)
- No `ObservationEvent`/`EventSource` changes — a new producer only, additive within `v1.x`.

## v1.1.1 — CI enforcement (merged)

### Added
- **GitHub Actions CI** (`.github/workflows/ci.yml`) enforcing the governance release gates on
  every PR and push to `main`: `python-sdk`, `frontend`, `platform-verification`, aggregated by
  a stable `gates` check (the one to require in branch protection).

## v1.1 — Observation SDK (Python) (merged)

### Added
- **Observation Protocol v1** ([ADR 0002](docs/adr/0002-observation-protocol-v1.md)) — the
  `ObservationEvent` contract formalized as a versioned, language-neutral protocol with
  explicit required/optional/derived/reserved fields and `v1.x` compatibility guarantees.
- **Observation SDK (Python)** under `sdk/python/` — a standalone, dependency-free producer
  SDK implementing the protocol: `ObservationClient`, `ObservationContext`,
  `ObservationEventBuilder`, `ObservationEmitter`, transports (JSONL / in-memory / HTTP),
  `contextvars`-based attribution propagation, and protocol validation before transport.
- Cross-stack gate `frontend/lib/__tests__/sdk-events.test.ts` — the platform consumes an
  SDK-emitted fixture with identical analytics (5 reconciliation identities, global
  `0.017` / `1560`). SDK pytest suite (22 tests) + the platform suite now at 120 Vitest tests.

### Unchanged (compatibility preserved)
- `verify_tracking.py` passes without modification; the in-platform emitter is untouched.
- No `ObservationEvent`/`EventSource` breaking changes — additive only, within the `v1.x`
  commitments.

## [1.0.0] — 2026-06-29

**Observation Platform foundation.** Architecture frozen — see
[`docs/adr/0001-core-architecture.md`](docs/adr/0001-core-architecture.md).

### Added
- Canonical `ObservationEvent` model and tolerant `normalize()` (legacy + canonical).
- Storage-agnostic `EventSource` abstraction with `JsonlEventSource` (v1) and
  `DuckDbEventSource` (scale), selectable via `EVENT_SOURCE`; verified storage-independent
  under a live server.
- First-class deterministic `replay`.
- Analytics (all derived, pure functions): overview, prompts, agents, sessions, workflows,
  models/providers, plus recommendations, alerts, cross-entity search, and export.
- Alert lifecycle (acknowledge/resolve) in a separate store that never mutates events.
- Reconciliation **release gate**: five identities asserted decimal-exact for cost and
  tokens (`lib/__tests__/reconcile.test.ts`).
- Canonical emitter in `cost_tracking.py`; `verify_tracking.py` 5-point offline validation.
- Docs: ADR 0001, architecture, API, EventSource plugin, deployment, roadmap.
- Offline end-to-end demo (`demo/run_demo_e2e.py`).

### Validation
- 116/116 Vitest, typecheck clean, production build, `verify_tracking.py` 5/5 — all offline.
- DuckDB-backed server returns byte-identical analytics to the JSONL path.

### Architectural invariants (frozen)
ObservationEvent is the canonical contract · EventSource is the only storage abstraction ·
events are immutable · replay is deterministic & first-class · analytics are derived, not
stored · reconciliation is a mandatory release gate.

[1.0.0]: #100--2026-06-29
