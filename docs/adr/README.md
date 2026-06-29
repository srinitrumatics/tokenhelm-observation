# Architecture Decision Records

ADRs capture significant architectural decisions and the evidence behind them. They are the
disciplined record that keeps the platform's invariants intact as contributors grow.

## When an ADR is required

Per [`CONTRIBUTING.md`](../../CONTRIBUTING.md), open an ADR for any **architectural** change —
anything affecting the `ObservationEvent` protocol, the `EventSource` storage seam, replay
determinism, the reconciliation gate, or how analytics are derived. Routine work (bug fixes,
UI tweaks, docs, new dashboard views over existing analytics) does not.

## How to add one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-short-title.md` (next number).
2. Fill in Context, Decision, Rationale, Consequences, and **Validation** (cite the tests).
3. If it touches `ObservationEvent`/`EventSource`, complete the **Compatibility review**.
4. Set status `Proposed`; flip to `Accepted` when merged (or `Superseded by ADR-XXXX`).

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-core-architecture.md) | Core architecture of the AI Observability Platform | Accepted (v1.0) |
