# Changelog

All notable changes to the AI Observability Platform (TokenHelm Analytics).

## [Unreleased] — v1.1 (branch `feat/observation-sdk-python`)

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
