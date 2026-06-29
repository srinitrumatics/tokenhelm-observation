/**
 * Attribution context propagation via Node's `AsyncLocalStorage`.
 *
 * This is the idiomatic Node analogue of the Python SDK's `contextvars` model: nested
 * scopes (session → workflow → agent → prompt → tool) inherit attribution automatically and
 * stay correct across `await` boundaries and concurrent async tasks. Producers never thread
 * attribution through call signatures by hand.
 *
 * Scopes are callback-based (`run(ctx, fn)`) — the natural `AsyncLocalStorage` shape — so a
 * context is installed for exactly the duration of the callback and restored on return.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { UNKNOWN } from "./protocol.js";

/** An immutable snapshot of the current attribution scope. */
export interface ObservationContext {
  sessionId: string;
  conversationId: string | null;
  workflowId: string | null;
  agent: string;
  parentAgent: string | null;
  prompt: string;
  promptVersion: string | null;
  toolName: string | null;
  // Operational metadata (deployment / multi-tenant / correlation).
  environment: string | null;
  applicationName: string | null;
  applicationVersion: string | null;
  tenantId: string | null;
  correlationId: string | null;
  tags: readonly string[];
}

/** The empty root context — every dimension absent (sentinels), no operational metadata. */
export const DEFAULT_CONTEXT: ObservationContext = {
  sessionId: UNKNOWN,
  conversationId: null,
  workflowId: null,
  agent: UNKNOWN,
  parentAgent: null,
  prompt: UNKNOWN,
  promptVersion: null,
  toolName: null,
  environment: null,
  applicationName: null,
  applicationVersion: null,
  tenantId: null,
  correlationId: null,
  tags: [],
};

const storage = new AsyncLocalStorage<ObservationContext>();

/** The attribution context active on this async task. */
export function currentContext(): ObservationContext {
  return storage.getStore() ?? DEFAULT_CONTEXT;
}

/**
 * Return a copy of `base` with `changes` overlaid, IGNORING `null`/`undefined` values
 * (mirrors the Python SDK's `merge`, where `None` values are dropped). Used by the additive
 * scopes (session/workflow/tool/context); agent/prompt set their fields explicitly instead.
 */
export function mergeContext(
  base: ObservationContext,
  changes: Partial<ObservationContext>,
): ObservationContext {
  const overlay = Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v !== undefined && v !== null),
  );
  return { ...base, ...overlay } as ObservationContext;
}

/** Run `fn` with `ctx` installed as the current context; the previous context is restored on return. */
export function runWith<T>(ctx: ObservationContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
