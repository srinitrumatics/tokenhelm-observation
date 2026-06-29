# Observation SDK (Python)

A standalone, **dependency-free** producer SDK for the **Observation Protocol v1**. It emits
canonical `ObservationEvent`s for the AI Observation Platform — without the application
needing any knowledge of the dashboard, analytics, or storage.

```
Application → Observation SDK → Observation Protocol → ObservationEvent → Transport → Platform
```

The SDK *produces*; the platform *consumes*. Neither depends on the other beyond the shared
protocol (see [`../../docs/adr/0002-observation-protocol-v1.md`](../../docs/adr/0002-observation-protocol-v1.md)).

## Install

```bash
pip install -e sdk/python            # editable, from the repo
# or, once published:  pip install observation-sdk
```

Zero runtime dependencies (stdlib only). Requires Python 3.10+.

## Quick start

```python
from observation_sdk import ObservationClient, JsonlTransport

client = ObservationClient(
    JsonlTransport("usage_log.jsonl"),     # the format an EventSource reads
    application_name="my-app",
    environment="production",
)

with client.session("sess-1"), client.workflow("research"):
    with client.agent("coordinator"):
        with client.prompt("route"):
            client.record_llm_call(
                provider="gemini", model="gemini-3-flash-preview",
                input_tokens=320, output_tokens=60, cost="0.0010", latency_ms=180,
            )
        with client.agent("researcher"):          # parent_agent = coordinator (automatic)
            with client.tool("web_search"):
                client.record_llm_call(
                    provider="gemini", model="gemini-3-pro",
                    input_tokens=900, output_tokens=240, cost="0.0040",
                )
client.close()
```

Point the dashboard at the produced log: `USAGE_LOG_PATH=usage_log.jsonl npm run dev`.

## Core API

| Object | Role |
|--------|------|
| `ObservationClient` | Entry point — scopes + `record_llm_call`. |
| `ObservationContext` | Immutable snapshot of the current attribution scope. |
| `ObservationEventBuilder` | Assembles a protocol event from context + call data. |
| `ObservationEmitter` | Validates against the protocol, then transports. |
| `Transport` | `JsonlTransport`, `InMemoryTransport` (tests), `HttpTransport` (experimental). |

### Instrumentation scopes

Context managers that propagate attribution automatically (via `contextvars`, the same model
proven in the v1.0 platform): `session(...)`, `workflow(...)`, `agent(..., parent=...)`,
`prompt(..., version=...)`, `tool(...)`. Nested agents inherit `parent_agent`; nested
prompts/tools attach to the calls inside them. Records are emitted with `record_llm_call(...)`.

### Validation

Every event is validated against Observation Protocol v1 **before** transport
(`ObservationEmitter`), so an invalid event never leaves the producer. Use
`validate(event)` / `is_valid(event)` directly if needed.

## What the SDK guarantees

- Emits canonical `ObservationEvent`s the platform consumes **unchanged** — proven by
  `frontend/lib/__tests__/sdk-events.test.ts`, which runs the platform's analytics over an
  SDK-emitted fixture and asserts all five reconciliation identities (global `0.017` / `1560`).
- `cost` is always a decimal **string**; unpriced calls (`priced=False`) count tokens but
  contribute zero cost.
- `attribution_status` is derived deterministically (`complete`/`partial`/`missing`).
- No dependency on the platform — depends only on the protocol.

## Tests

```bash
cd sdk/python
pip install -e ".[test]"
pytest -q
# regenerate the cross-stack fixture after changing the SDK:
python examples/generate_fixture.py
```

## Layout

```
sdk/python/
├── observation_sdk/
│   ├── protocol.py     # Observation Protocol v1: validate / attribution / hashing
│   ├── context.py      # contextvars-based attribution propagation
│   ├── builder.py      # ObservationEventBuilder
│   ├── transport.py    # Transport ABC + JSONL / InMemory / HTTP(experimental)
│   ├── emitter.py      # validate-then-transport
│   └── client.py       # ObservationClient (instrumentation API)
├── examples/           # scenario + cross-stack fixture generator
└── tests/              # protocol / context / transport / reconciliation
```
