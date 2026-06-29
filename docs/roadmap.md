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

Highest-value next milestone is **adoption**, not more analytics. Every item below
*extends* the protocol/abstractions rather than bypassing them (the v1.1 contribution gate
in ADR 0001). Four workstreams, in priority order:

### 1. Observation SDK (highest priority)

Reusable SDKs that emit canonical `ObservationEvent`s directly, exposing a minimal
instrumentation API while hiding storage/transport.

- Python SDK
- TypeScript / Node.js SDK
- Go SDK (optional, if there is demand)

The SDK boundary **is** the `ObservationEvent` spec — the Python emitter
(`cost_tracking.py`) and the TS `normalize()` already agree on it; the SDK formalizes and
packages that contract.

### 2. Observation Protocol

Promote `ObservationEvent` from an internal model to a **versioned protocol** — the contract
between producers and consumers.

- Required vs. optional fields
- Versioning strategy + compatibility guarantees
- Validation rules
- Lives alongside the schema in `frontend/lib/observation/event.ts` and the
  `specs/.../contracts/observation-event.schema.json`

### 3. Connector ecosystem

Expand reach through the existing abstractions — **never** by changing the analytics engine.

- **EventSource implementations** (storage/ingest): PostgreSQL, Redis Streams, Kafka,
  OpenTelemetry, S3, BigQuery — each behind `getEventSource()` via `EVENT_SOURCE`. See
  [`docs/event-source-plugin.md`](event-source-plugin.md).
- **Analytics consumers** (read the immutable stream): Prometheus, Grafana, Opik, Langfuse —
  consumers of `ObservationEvent`s, never a competing source of truth.

### 4. Productization

Developer adoption and one-command onboarding.

- Docker / Docker Compose deployment + Helm chart
- Sample applications + quick-start templates
- CLI tooling
- API client libraries

---

## Positioning

**An Observation Platform for AI Systems.** TokenHelm is the instrumentation layer,
`ObservationEvent` is the protocol, `EventSource` is the storage abstraction, and everything
else is built on top. The aim is infrastructure, not a single dashboard.
