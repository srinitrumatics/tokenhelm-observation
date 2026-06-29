# ADR 0003 — TypeScript/Node Observation SDK (protocol parity)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Supersedes:** none
- **Context:** v1.2 — second producer for Observation Protocol v1 (`sdk/typescript/`)

## Context / forces

The Python Observation SDK (v1.1, ADR 0002) proved that a standalone producer can emit
canonical `ObservationEvent`s the platform consumes unchanged. Observation Protocol v1 was
deliberately defined as **language-neutral**. The forces here:

- A large share of AI applications are instrumented in TypeScript/Node, not Python.
- The protocol's value is only realized if it is genuinely portable across runtimes — a claim
  that must be *demonstrated*, not asserted.
- The SDK must not become a second source of truth: it depends only on the protocol, never on
  the dashboard, analytics, or storage (the dependency direction in ADR 0001/0002).

## Decision

Add a standalone **TypeScript/Node Observation SDK** at `sdk/typescript/`
(`@tokenhelm/observation-sdk`), targeting **protocol parity, not feature parity**: it produces
semantically identical `ObservationEvent`s, but its API is idiomatic for Node rather than a
line-by-line port of the Python surface.

Concrete shape (mirrors the Python module boundaries):

- `src/protocol.ts` — Observation Protocol v1: `validate`, `deriveAttributionStatus`,
  `promptHash` (`ph_` + `sha256(prompt)[:12]`), the `ObservationEvent` type. Zero dependencies.
- `src/context.ts` — attribution propagation via **`AsyncLocalStorage`** (the idiomatic Node
  analogue of Python's `contextvars`).
- `src/builder.ts`, `src/emitter.ts`, `src/transport.ts` (`InMemory` / `Jsonl` / experimental
  `Http`), `src/client.ts` — the `ObservationClient` instrumentation API.

**Key API divergence (idiomatic, intentional):** scopes are **callbacks**
(`client.session("s1", () => …)`), the natural `AsyncLocalStorage.run` shape, rather than
Python's `with`-statement context managers. Nesting and automatic `parent_agent` resolution are
preserved exactly.

**Producer identification:** events carry `metadata.sdk = "observation-sdk-typescript"` (Python
uses `"observation-sdk-python"`). This is the *only* field that differs between the two SDKs'
output for the same logical scenario.

CI gains a stable `typescript-sdk` job, added to the `gates` aggregate (existing job names
unchanged — branch protection stays valid).

## Compatibility review

This ADR adds a **producer**; it does not change `ObservationEvent` or `EventSource`.

- **`v1.x` field compatibility:** preserved — the TS SDK emits the exact v1 field set; no field
  added, repurposed, or removed.
- **Reconciliation gate:** green — the TS-emitted fixture satisfies all five identities
  (`frontend/lib/__tests__/sdk-parity.test.ts`), decimal-exact, global `0.017` / `1560`.
- **Replay determinism:** unaffected — events are immutable; analytics remain derived.

No `v2` concerns.

## Rationale

- **Idiomatic over literal.** A `with`-statement transliteration would be unnatural in Node.
  Callback scopes + `AsyncLocalStorage` are what a TypeScript developer expects and keep
  attribution correct across `await`. The *contract* is the protocol; the *ergonomics* are the
  language's.
- **Parity is provable, not asserted.** Because the protocol is deterministic (sha256 hashes,
  derived `attribution_status`, explicit ids/timestamps in the scenario), the two SDKs emit
  field-for-field identical events — so parity is enforced by a test, not a promise.
- **No parallel model.** The SDK depends only on the protocol; the platform consumes its output
  through the same `EventSource` → analytics path as every other source.

## Consequences

- (+) Demonstrates the Observation Protocol is **language-independent**: same scenario, two
  runtimes, identical analytics. The platform becomes a producers/protocol/transports/sources/
  analytics ecosystem rather than "a dashboard with instrumentation."
- (+) A standalone, dependency-free npm package developers can adopt without pulling in the
  dashboard.
- (−) Two producers now track the protocol; a future protocol change must update both SDKs (and
  the shared fixtures) in lockstep. The drift guards make a missed update a test failure, not a
  silent divergence.
- (−) The experimental `HttpTransport` is not exercised offline (same caveat as Python).

## Validation

- **`sdk/typescript` (CI `typescript-sdk`):** `npm test` runs protocol / context / transport /
  reconciliation suites (24 tests), including a **fixture drift guard** that regenerates the
  cross-stack fixture and deep-equals the committed copy. `npm run typecheck` + `npm run build`
  prove the package compiles to distributable ESM.
- **Cross-language parity (CI `frontend`):** `frontend/lib/__tests__/sdk-parity.test.ts` proves
  (1) the Python- and TS-emitted fixtures are **field-for-field identical except `metadata.sdk`**,
  and (2) the platform produces **identical analytics** from the TS fixture — all five
  reconciliation identities, agent hierarchy, and the unattributed bucket — exactly as for the
  Python fixture and the in-platform emitter.
