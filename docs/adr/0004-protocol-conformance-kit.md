# ADR 0004 — Observation Protocol Conformance Kit + `observe` CLI

- **Status:** Accepted
- **Date:** 2026-06-29
- **Supersedes:** none
- **Context:** v1.3 — protocol tooling / validation utilities (`protocol/conformance/`, `observe` CLI)

## Context / forces

With two SDKs now emitting `ObservationEvent`s (Python — ADR 0002, TypeScript — ADR 0003) plus
the platform's tolerant `normalize()`, the protocol's validation rules are expressed in **four**
places: `sdk/python/observation_sdk/protocol.py`, `sdk/typescript/src/protocol.ts`, the platform
zod schema (`frontend/lib/observation/event.ts`), and the JSON Schema contract
(`specs/.../observation-event.schema.json`). Two pressures:

1. **Drift risk.** Nothing forced these four to agree. ADR 0002 already noted one divergence: the
   JSON Schema marked `raw` required and did not require `metadata.priced`, while the SDK
   validators treat `raw` optional and require a boolean `metadata.priced`.
2. **No producer-facing tool.** A team instrumenting a new app (or a non-SDK producer) had no way
   to check "does my event log actually conform to Observation Protocol v1?" before shipping it
   to the platform.

## Decision

Add a **conformance kit** and a **CLI**, both consumers of the *single* validator the SDKs
already implement (no new/4th validation implementation):

1. **`protocol/conformance/`** — language-neutral canonical fixtures: `valid/*.json` (must
   accept), `invalid/*.json` (must reject, each breaking exactly one rule), and `manifest.json`
   pairing every case with its expected verdict and, for rejects, a `match` substring that every
   conformant validator's error MUST contain. This is the cross-language **agreement gate**.
2. **Cross-language conformance tests** — `sdk/python/tests/test_conformance.py` and
   `sdk/typescript/tests/conformance.test.ts` load the **same** manifest and assert their
   `validate()` agrees on every case (verdict *and* reason). They run inside the existing
   `python-sdk` / `typescript-sdk` CI gates — **no new CI job**.
3. **`observe` CLI** — shipped as a `bin` of `@tokenhelm/observation-sdk`, reusing its `validate()`
   and `normalizeRecord()` (no second implementation). Six intentionally-small, protocol-focused
   commands; anything analytics-shaped stays in the platform:
   - `observe validate <log>` — protocol-validate every line; exit 1 on any violation.
   - `observe lint <log>` — non-fatal warnings (attribution gaps, unpriced, missing app name).
   - `observe normalize <log>` — canonicalize arbitrary/legacy records → protocol-valid events.
   - `observe stats <log>` — attribution breakdown + **decimal-exact** (BigInt) cost/token reconcile.
   - `observe replay <log>` — deterministic canonical stream (normalize + dedupe + stable sort);
     idempotent, embodying the immutable-events / deterministic-replay invariant.
   - `observe diff <a> <b> --ignore <path>` — field-level diff keyed by `event_id`; makes
     cross-SDK parity a one-liner (`observe diff py.jsonl ts.jsonl --ignore metadata.sdk`).
4. **JSON Schema drift fix** — align `observation-event.schema.json` to the validators: `raw`
   becomes optional (`["object","null"]`, defaults `{}`); `metadata` becomes required with a
   required boolean `priced`. Stamp `x-protocol-version` / `x-schema-version`.
5. **Version separation** — three independently-evolvable versions, made explicit:
   `PROTOCOL_VERSION` (contract), `SCHEMA_VERSION` (schema artifact), and the SDK package version.
   Declared in `protocol/protocol.json` and surfaced by `observe --version`.
6. **Certification** — `protocol/protocol.json` + `protocol/README.md` define "Observation Protocol
   v1 Certified": an implementation that accepts every valid and rejects every invalid manifest
   case. Because the SDK conformance suites assert exactly this, certification is continuous, not a
   one-time audit — and a new-language SDK certifies purely by passing the shared manifest.

## Compatibility review

Touches the documented `ObservationEvent` **JSON Schema**, not the runtime model or `EventSource`.

- **`v1.x` field compatibility:** preserved. No field added, repurposed, or removed. The schema
  edit makes it *describe the validators more faithfully* (`raw` was always optional in the SDKs;
  `metadata.priced` was always required by them) — it does not change any event's shape.
- **`observe normalize`** uses the **protocol's** definitions (sha256 `prompt_hash`; sha256-based
  `obs_…` synthetic ids for records lacking `event_id`). This intentionally differs from the
  platform's tolerant `normalize()` (which uses FNV `ph_…` / `leg_…` ids for raw legacy ingest):
  the CLI canonicalizes to what a *producer* would emit, before the platform sees it. Both remain
  within v1.x — `prompt_hash` and `event_id` are opaque grouping/dedup keys, not cross-tool joins.
- **Reconciliation gate:** unaffected — green. `observe stats` independently reproduces the
  reconciliation totals (`0.0170` / `1560`) over the SDK fixture.
- **Replay determinism:** unaffected — the kit and CLI are read-only over events.

No `v2` concerns.

## Rationale

- **One validator, proven to agree.** The fixtures make divergence a *test failure*. Adding a
  protocol rule now means adding a fixture first; both SDK suites fail until they implement it —
  the SDKs stay in lockstep with the spec by construction.
- **Reuse, don't re-implement.** The CLI imports the SDK's `validate()`, so it cannot drift from
  the SDK; bundling it as the SDK's `bin` avoids a brittle cross-package dependency and needs no
  new CI gate.
- **Producer-facing.** `observe validate` gives *any* producer a CI check against Protocol v1,
  regardless of how its events were generated — the protocol becomes independently verifiable.

## Consequences

- (+) The protocol is now independently checkable and the four rule-expressions are pinned to one
  shared definition. New producers get a ready-made conformance gate.
- (+) `observe stats` is a quick, dependency-free reconciliation/attribution report over any log.
- (−) The CLI lives inside the SDK package (pragmatic) rather than a standalone `tools/` package;
  if a non-SDK distribution is later wanted, it extracts cleanly (the core is pure).
- (−) Conformance fixtures must be maintained alongside the spec — but that is the point, and the
  no-orphan test keeps the manifest and files in sync.

## Validation

- **`sdk/python` (CI `python-sdk`):** `test_conformance.py` runs all manifest cases (20) — every
  `valid` accepted, every `invalid` rejected with the expected substring. Python suite 22 → 42.
- **`sdk/typescript` (CI `typescript-sdk`):** `conformance.test.ts` runs the same manifest (20);
  `cli.test.ts` (14) covers `sumDecimals` exactness, `validateLog`, `computeStats` reconciliation
  over the real SDK fixture (`0.0170` / `1560`), `normalizeLog` (legacy → valid), `replayLog`
  determinism/idempotence, `diffLogs` cross-SDK parity (only `metadata.sdk` differs), version
  separation, and `run()` exit codes. TS suite 24 → 58.
- **Cross-SDK parity, now executable:** `observe diff <py> <ts> --ignore metadata.sdk` reports
  `equivalent` — the v1.2 parity claim reduced to a single CLI command.
- Both suites consume the **identical** `protocol/conformance/manifest.json`, so a validator
  divergence fails CI in at least one language.
