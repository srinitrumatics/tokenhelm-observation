# Roadmap

## v1.0.0 — Observation Platform foundation (shipped)

The canonical-event architecture, validated end to end. See
[`docs/adr/0001-core-architecture.md`](adr/0001-core-architecture.md) for the five
architectural invariants and their runtime evidence. **The foundation is frozen** — the
invariants change only on compelling evidence from production deployments.

Delivered: `ObservationEvent` model, `EventSource` abstraction (JSONL + DuckDB), replay,
overview/prompt/agent/session/workflow/model analytics, recommendations, alerts, search,
export, the reconciliation release gate, docs, and an offline end-to-end demo.

---

## v1.1 — From product to platform

Highest-value next milestone is **adoption**, not more analytics. Success metrics shift from
"more features" to "more adoption" — SDKs, integrations, docs, and real-world deployments.
Every epic below *extends* the protocol/abstractions rather than bypassing them (the
contribution gate in [`CONTRIBUTING.md`](../CONTRIBUTING.md) / ADR 0001). All work stays
within the `v1.x` compatibility commitments. Four epics, in priority order:

### Epic 1 — Observation SDK (highest priority)

Standalone SDKs that emit canonical `ObservationEvent`s directly. Begin with Python and
TypeScript / Node.js. Deliverables:

- Instrumentation API (minimal surface; hides storage + transport)
- `ObservationEvent` builder
- Automatic context propagation (agent/session/workflow/parent — mirrors the contextvars in
  `cost_tracking.py`)
- Transport abstraction
- SDK documentation
- Example integrations

The SDK boundary **is** the `ObservationEvent` spec — `cost_tracking.py` and the TS
`normalize()` already agree on it; the SDK formalizes and packages that contract.

**Status:** Python SDK shipped (`sdk/python/`, ADR 0002). TypeScript/Node SDK shipped
(`sdk/typescript/`, ADR 0003) — protocol parity proven by `sdk-parity.test.ts`. Both run under
CI (`python-sdk` / `typescript-sdk` gates).

### Epic 2 — Observation Protocol

Extract the `ObservationEvent` schema into a versioned, language-neutral specification — the
contract between producers and consumers. Include:

- Schema versioning
- Compatibility guarantees (the `v1.x` commitments)
- Validation rules
- Migration guidance
- Language-neutral documentation
- Anchored to `frontend/lib/observation/event.ts` and
  `specs/002-ai-observability-platform/contracts/observation-event.schema.json`

### Epic 3 — Connector ecosystem

New `EventSource` implementations **without changing analytics** — each must demonstrate
identical analytics against the reference JSONL fixtures (the gate in `CONTRIBUTING.md`). See
[`docs/event-source-plugin.md`](event-source-plugin.md).

- PostgreSQL
- Redis Streams
- Kafka
- OpenTelemetry bridge

Analytics consumers (Prometheus, Grafana, Opik, Langfuse) read the same immutable stream —
never a competing source of truth.

### Epic 4 — Operational tooling

Developer experience and one-command onboarding.

- Docker Compose
- Helm chart
- CLI utilities
- Health checks
- Sample applications
- Benchmark suite (build on `frontend/scripts/bench.mjs`)

---

## Positioning

**An Observation Platform for AI Systems.** TokenHelm is the instrumentation layer,
`ObservationEvent` is the protocol, `EventSource` is the storage abstraction, and everything
else is built on top. The aim is infrastructure, not a single dashboard.
