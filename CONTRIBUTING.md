# Contributing

This project is **an Observation Platform for AI Systems**, not a single dashboard.
TokenHelm is the instrumentation layer, **`ObservationEvent`** is the protocol,
**`EventSource`** is the storage abstraction, and everything else (analytics, dashboards,
recommendations, alerts, integrations) is built on top. Contributions should *extend that
ecosystem*, not introduce a parallel model.

Read [`docs/adr/0001-core-architecture.md`](docs/adr/0001-core-architecture.md) first — it
records the architectural invariants and the runtime evidence behind them.

## The one question every contribution must answer

> **Does this extend the `ObservationEvent` ecosystem, or does it introduce a parallel model?**

- **Extends** (accepted): an SDK that emits `ObservationEvent`s, an `EventSource`
  implementation, a consumer of the immutable stream, or developer tooling on the protocol.
- **Parallel model** (rejected or redesigned): a second source of truth, a storage-specific
  schema leaking into analytics, a materialized-analytics store, or anything that mutates an
  `ObservationEvent`.

## v1.x compatibility commitments

From `v1.0.0` these are compatibility commitments for the whole `v1.x` series:

1. `ObservationEvent` remains the canonical event contract.
2. `EventSource` remains the only storage abstraction.
3. Existing `ObservationEvent` fields stay backwards compatible within `v1.x` (add optional
   fields; never repurpose or remove an existing one).
4. Replay and reconciliation remain release-gating requirements.
5. Analytics remain derived from immutable `ObservationEvent`s.

Any change that would break one of these is a **major-version (v2) discussion**, not a
routine enhancement — open an ADR and a compatibility review before writing code.

## Governance process (lightweight)

| Change | Required |
|--------|----------|
| Any **architectural** change | A new **ADR** under `docs/adr/` (copy `docs/adr/TEMPLATE.md`) |
| Changes touching **`ObservationEvent`** or **`EventSource`** | An ADR **+ compatibility review** against the commitments above |
| A new **analytics module** (`lib/analytics/*`) | **Reconciliation tests** — its totals must reconcile to the global totals (extend `lib/__tests__/reconcile.test.ts`) |
| A new **storage backend** (`EventSource` impl) | A test proving **identical analytics** vs the reference JSONL fixtures (mirror `lib/__tests__/db-source.test.ts`: `JSON.stringify` equality + reconciliation) |

"Architectural change" = anything affecting the protocol, the storage seam, replay
determinism, the reconciliation gate, or how analytics are derived. Bug fixes, UI tweaks,
docs, and new dashboard views over existing analytics do **not** need an ADR.

## Release gates (enforced by CI)

These gates are **enforced automatically by CI** (`.github/workflows/ci.yml`) on every pull
request and every push to `main` — they are no longer just local recommendations. Once branch
protection is enabled, the `gates` check (and/or the three job checks below) is **required**,
so a PR cannot merge unless every gate is green.

| CI job | Gate |
|--------|------|
| `python-sdk` | `pip install -e "./sdk/python[test]"` → `pytest` (protocol validation + SDK reconciliation) |
| `typescript-sdk` | `npm ci` → `npm test` (protocol / context / transport / reconciliation + fixture drift guard) → `npm run typecheck` → `npm run build` |
| `frontend` | `npm ci` → `npm test` (incl. `reconcile.test.ts`, `sdk-events.test.ts`, `sdk-parity.test.ts`) → `npm run typecheck` → `npm run build` |
| `platform-verification` | `pip install -r requirements.txt` → `python verify_tracking.py` (5-point canonical validation) |
| `gates` | Aggregate — succeeds only if the four above succeed (the stable check to require in branch protection) |

Run them locally before pushing (all offline, no API key):

```bash
cd sdk/python && pytest -q && cd ../..
cd sdk/typescript && npm ci && npm test && npm run typecheck && npm run build && cd ../..
cd frontend && npm ci && npm test && npm run typecheck && npm run build && cd ..
.venv/Scripts/python.exe verify_tracking.py
```

The reconciliation gate is non-negotiable: **the dashboard totals must equal the events,
decimal-exact, for cost and tokens.** If a change can't keep it green, it needs an ADR.

## Pull-request checklist

- [ ] Answers the gate question above (extends the ecosystem, no parallel model).
- [ ] If architectural: an ADR is added/updated under `docs/adr/`.
- [ ] If it touches `ObservationEvent`/`EventSource`: compatibility review done; `v1.x` field
      compatibility preserved (new fields optional).
- [ ] New analytics module: reconciliation tests added and green.
- [ ] New storage backend: identical-analytics test vs the JSONL fixtures added and green.
- [ ] All release gates pass (`npm test` + `typecheck` + `build` + `verify_tracking.py`).
- [ ] No secrets or generated artifacts committed (see `.gitignore`).
- [ ] Docs updated where relevant (`docs/`, `README.md`, `CHANGELOG.md`).

## Versioning

Semantic Versioning. Additive, backwards-compatible work (SDKs, connectors, tooling, new
derived analytics) is `v1.x`. Breaking an invariant or an `ObservationEvent` field contract
is `v2.0.0` and requires an ADR with a migration path.

## Commit / branch conventions

- Branch off `main`; keep PRs focused.
- Reference the relevant ADR or epic in the description.
- The architecture is frozen as of `v1.0.0` — extend the layers, don't bypass them.
