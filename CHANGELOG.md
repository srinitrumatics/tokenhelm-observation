# Changelog

All notable changes to the AI Observability Platform (TokenHelm Analytics).

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
