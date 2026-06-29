# Observation Protocol

The language-neutral contract at the center of the ecosystem. Producers (SDKs) emit
`ObservationEvent`s that satisfy this protocol; the platform (EventSources, analytics, dashboard)
consumes them. Neither side depends on the other beyond this contract.

```
Producers (SDKs)  →  Observation Protocol  →  Observation Platform
  Python, TS, …         spec + schema +           EventSources, analytics,
                        conformance + CLI          dashboard, recs, alerts
```

## What lives here

| Artifact | Path | Role |
|----------|------|------|
| **Specification** | [`../docs/adr/0002-observation-protocol-v1.md`](../docs/adr/0002-observation-protocol-v1.md) | The normative prose: fields, rules, compatibility. |
| **JSON Schema** | [`../specs/002-ai-observability-platform/contracts/observation-event.schema.json`](../specs/002-ai-observability-platform/contracts/observation-event.schema.json) | Machine-readable shape, kept in lockstep with the validators. |
| **Conformance Kit** | [`conformance/`](conformance/) | The **executable** spec: canonical valid/invalid fixtures every validator must agree on. |
| **CLI** | `observe` (bin of `@tokenhelm/observation-sdk`) | Validate / lint / normalize / stats / replay / diff any JSONL log. |
| **Version manifest** | [`protocol.json`](protocol.json) | Declares the three versions, compatibility range, and certification. |

The **Conformance Kit — not any SDK — is the reference implementation.** An SDK is correct insofar
as it agrees with the kit.

## Three versions, evolved independently

| Version | What it tracks | Bumps when |
|---------|----------------|-----------|
| **Protocol version** (`1.0`) | The semantic contract (fields, rules, derivation) | The contract changes. Within `v1.x`: add optional fields only — never repurpose/remove. |
| **Schema version** (`1.0.0`) | The JSON Schema *artifact* revision | Editorial/clarity fixes to the schema, **without** changing the protocol version. |
| **SDK version** | An individual SDK package (e.g. `0.1.0`) | That SDK ships changes. Orthogonal to the protocol it implements. |

`observe --version` prints all three; `protocol.json` and the schema's `x-protocol-version` /
`x-schema-version` carry them in machine-readable form.

## Certification

> **Observation Protocol v1 Certified**

An implementation earns this claim for `protocol_version 1.0` when it **accepts every `valid` case
and rejects every `invalid` case** in [`conformance/manifest.json`](conformance/manifest.json), with
each rejection's error containing the case's `match` substring. That is exactly what the SDK
conformance suites assert, so certification is continuous and automated — not a one-time audit.

Currently certified (see [`protocol.json`](protocol.json)):

- `observation-sdk` (Python) — `sdk/python/tests/test_conformance.py`
- `@tokenhelm/observation-sdk` (TypeScript) — `sdk/typescript/tests/conformance.test.ts`

A new SDK (Go, Java, …) certifies by loading the same `manifest.json` and passing every case. Because
the kit is language-neutral data, the protocol is genuinely language-independent.

## The `observe` CLI

Six protocol-focused commands (intentionally small — anything analytics-shaped belongs in the
platform, not here):

```bash
observe validate  log.jsonl                 # protocol-validate every line; exit 1 on violation
observe lint      log.jsonl                 # non-fatal warnings (attribution gaps, unpriced, …)
observe normalize raw.jsonl                 # arbitrary/legacy record → canonical event (JSONL out)
observe stats     log.jsonl                 # attribution breakdown + decimal-exact reconciliation
observe replay    log.jsonl                 # deterministic canonical stream (normalize+dedupe+sort)
observe diff      a.jsonl b.jsonl --ignore metadata.sdk   # field-level diff keyed by event_id
```

`observe diff py.jsonl ts.jsonl --ignore metadata.sdk` → `equivalent: 7 events, no differences` —
cross-SDK parity proven from the command line.
