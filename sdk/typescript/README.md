# Observation SDK (TypeScript / Node)

A standalone, **dependency-free** producer SDK for the **Observation Protocol v1**. It emits
canonical `ObservationEvent`s for the AI Observation Platform — without the application needing
any knowledge of the dashboard, analytics, or storage.

```
Application → Observation SDK → Observation Protocol → ObservationEvent → Transport → Platform
```

It is the TypeScript twin of the [Python SDK](../python/README.md): **protocol parity, not
feature parity**. The two SDKs emit field-for-field identical events for the same scenario — the
only difference is `metadata.sdk` (the producer's name). The API is idiomatic for Node, not a
transliteration of Python. See [`../../docs/adr/0003-typescript-observation-sdk.md`](../../docs/adr/0003-typescript-observation-sdk.md).

## Install

```bash
npm install @tokenhelm/observation-sdk
```

Zero runtime dependencies. Requires Node 18+ (uses `AsyncLocalStorage` and global `fetch`).

## Quick start

```ts
import { ObservationClient, JsonlTransport } from "@tokenhelm/observation-sdk";

const client = new ObservationClient(
  new JsonlTransport("usage_log.jsonl"), // the format an EventSource reads
  { applicationName: "my-app", environment: "production" },
);

client.session("sess-1", () =>
  client.workflow("research", () => {
    client.agent("coordinator", () => {
      client.prompt("route", () => {
        client.recordLLMCall({
          provider: "gemini", model: "gemini-3-flash-preview",
          inputTokens: 320, outputTokens: 60, cost: "0.0010", latencyMs: 180,
        });
      });
      client.agent("researcher", () => {          // parentAgent = coordinator (automatic)
        client.tool("web_search", () => {
          client.recordLLMCall({
            provider: "gemini", model: "gemini-3-pro",
            inputTokens: 900, outputTokens: 240, cost: "0.0040",
          });
        });
      });
    });
  }),
);

await client.close();
```

Point the dashboard at the produced log: `USAGE_LOG_PATH=usage_log.jsonl npm run dev`.

## Core API

| Object | Role |
|--------|------|
| `ObservationClient` | Entry point — scopes + `recordLLMCall`. |
| `ObservationContext` | The current attribution scope (read via `client.currentContext()`). |
| `ObservationEventBuilder` | Assembles a protocol event from context + call data. |
| `ObservationEmitter` | Validates against the protocol, then transports. |
| `Transport` | `JsonlTransport`, `InMemoryTransport` (tests), `HttpTransport` (experimental). |

### Instrumentation scopes

Scopes are **callbacks** that propagate attribution automatically (via `AsyncLocalStorage` — the
idiomatic Node analogue of Python's `contextvars`), correct across `await`:
`session(...)`, `workflow(...)`, `agent(name, fn, { parent })`, `prompt(name, fn, { version })`,
`tool(...)`. Nested agents inherit `parentAgent`; nested prompts/tools attach to the calls inside
them. Each scope returns whatever its callback returns, so they nest as expressions. Records are
emitted with `recordLLMCall({...})`.

### Validation

Every event is validated against Observation Protocol v1 **before** transport
(`ObservationEmitter`), so an invalid event never leaves the producer. Use `validate(event)` /
`isValid(event)` directly if needed.

## What the SDK guarantees

- Emits canonical `ObservationEvent`s the platform consumes **unchanged** — proven by
  `frontend/lib/__tests__/sdk-parity.test.ts`, which runs the platform's analytics over a
  TS-emitted fixture and asserts all five reconciliation identities (global `0.017` / `1560`),
  AND that the fixture is field-for-field identical to the Python SDK's (modulo `metadata.sdk`).
- `cost` is always a decimal **string**; unpriced calls (`priced: false`) count tokens but
  contribute zero cost.
- `attribution_status` is derived deterministically (`complete` / `partial` / `missing`).
- No dependency on the platform — depends only on the protocol.

## Tests

```bash
cd sdk/typescript
npm ci
npm test          # protocol / context / transport / reconciliation (+ fixture drift guard)
npm run typecheck
npm run build
# regenerate the cross-stack fixture after changing the SDK:
npm run gen:fixture
```

## Layout

```
sdk/typescript/
├── src/
│   ├── protocol.ts     # Observation Protocol v1: validate / attribution / hashing
│   ├── context.ts      # AsyncLocalStorage-based attribution propagation
│   ├── builder.ts      # ObservationEventBuilder
│   ├── transport.ts    # Transport + JSONL / InMemory / HTTP(experimental)
│   ├── emitter.ts      # validate-then-transport
│   ├── client.ts       # ObservationClient (instrumentation API)
│   └── index.ts        # public exports
├── examples/           # scenario + cross-stack fixture generator
└── tests/              # protocol / context / transport / reconciliation
```
