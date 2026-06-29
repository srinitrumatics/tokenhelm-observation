# Observation Protocol v1 — Conformance Kit

Language-neutral, canonical test cases for **Observation Protocol v1** (the contract defined in
[`../../docs/adr/0002-observation-protocol-v1.md`](../../docs/adr/0002-observation-protocol-v1.md)).
This is the **cross-language agreement gate**: every protocol *validator* — the
[Python SDK](../../sdk/python), the [TypeScript SDK](../../sdk/typescript), and any future
producer — loads these exact fixtures and must agree on every verdict. A divergence between two
validators is a test failure, not a silent drift.

## Layout

```
protocol/conformance/
├── manifest.json     # the index: each case + expected verdict (+ error substring for invalids)
├── valid/*.json      # events EVERY validator MUST accept
└── invalid/*.json    # events EVERY validator MUST reject (each breaks exactly one rule)
```

Each fixture is a single ObservationEvent (one JSON object). Every `invalid/` case is otherwise
well-formed and breaks **exactly one** rule, so a rejection pins that specific rule.

## The contract

`manifest.json` lists every case:

```jsonc
{ "file": "valid/minimal-complete.json", "valid": true }
{ "file": "invalid/missing-currency.json", "valid": false,
  "rule": "required-field", "match": "missing required field 'currency'" }
```

- `valid: true`  → the validator MUST accept it.
- `valid: false` → the validator MUST reject it, and the raised error MUST contain `match`
  (a substring shared by all conformant validators, so the *reason* agrees, not just the verdict).

## Who consumes this

| Consumer | How |
|----------|-----|
| Python SDK | `sdk/python/tests/test_conformance.py` runs `validate()` over every case |
| TypeScript SDK | `sdk/typescript/tests/conformance.test.ts` runs `validate()` over every case |
| `observe` CLI | `observe validate <log.jsonl>` applies the same rules to a real event log |

Adding a rule to the protocol means adding a fixture here **first**; both SDK suites then fail
until their validators implement it — keeping every producer in lockstep with the spec.
