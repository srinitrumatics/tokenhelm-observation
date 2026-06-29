/**
 * ObservationClient — the instrumentation API application developers use.
 *
 * Wraps context propagation + builder + emitter behind a minimal surface. Developers open
 * scopes (session → workflow → agent → prompt → tool) as callbacks and record model calls;
 * the SDK derives attribution, validates against the protocol, and transports the event. No
 * ObservationEvent is ever constructed by hand, and the SDK never touches storage or analytics.
 *
 * Scopes are callbacks — the idiomatic `AsyncLocalStorage` shape — and nest naturally:
 *
 *     const client = new ObservationClient(new JsonlTransport("usage_log.jsonl"));
 *     client.session("sess-1", () =>
 *       client.workflow("research", () =>
 *         client.agent("coordinator", () =>
 *           client.prompt("route", () =>
 *             client.recordLLMCall({
 *               provider: "gemini", model: "gemini-3-flash-preview",
 *               inputTokens: 320, outputTokens: 60, cost: "0.0010",
 *             }),
 *           ),
 *         ),
 *       ),
 *     );
 */

import type { ObservationContext } from "./context.js";
import type { EventStatus, ObservationEvent } from "./protocol.js";
import type { Transport } from "./transport.js";
import { currentContext, mergeContext, runWith } from "./context.js";
import { present } from "./protocol.js";
import { ObservationEmitter } from "./emitter.js";
import { ObservationEventBuilder } from "./builder.js";

export interface ClientOptions {
  applicationName?: string | null;
  applicationVersion?: string | null;
  environment?: string | null;
  tenantId?: string | null;
  /** Validate every event against the protocol before transport (default: true). */
  validateEvents?: boolean;
}

/** Inputs to `recordLLMCall`. `timestamp` defaults to now (UTC ISO-8601). */
export interface RecordLLMCallParams {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  currency?: string;
  totalTokens?: number;
  latencyMs?: number;
  status?: EventStatus;
  priced?: boolean;
  timestamp?: string;
  eventId?: string;
  requestId?: string;
  promptHash?: string;
  tags?: readonly string[];
  correlationId?: string;
  metadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Entry point: scopes for instrumentation + `recordLLMCall` to emit events. */
export class ObservationClient {
  private readonly emitter: ObservationEmitter;
  private readonly builder: ObservationEventBuilder;

  constructor(transport: Transport, options: ClientOptions = {}) {
    this.emitter = new ObservationEmitter(transport, options.validateEvents ?? true);
    this.builder = new ObservationEventBuilder({
      applicationName: options.applicationName ?? null,
      applicationVersion: options.applicationVersion ?? null,
      environment: options.environment ?? null,
      tenantId: options.tenantId ?? null,
    });
  }

  // --- Instrumentation scopes (callbacks; nesting propagates attribution) ---

  /** Open a session/conversation lifecycle scope for the duration of `fn`. */
  session<T>(sessionId: string, fn: () => T, options: { conversationId?: string } = {}): T {
    return runWith(
      mergeContext(currentContext(), {
        sessionId,
        conversationId: options.conversationId ?? null,
      }),
      fn,
    );
  }

  /** Open a workflow/invocation scope. */
  workflow<T>(workflowId: string, fn: () => T): T {
    return runWith(mergeContext(currentContext(), { workflowId }), fn);
  }

  /**
   * Open an agent-execution scope. `parent` auto-resolves to the enclosing agent unless given;
   * `parentAgent` is set explicitly (including `null` for a root) so a stale value is never inherited.
   */
  agent<T>(name: string, fn: () => T, options: { parent?: string | null } = {}): T {
    const cur = currentContext();
    const resolvedParent =
      options.parent != null ? options.parent : present(cur.agent) ? cur.agent : null;
    return runWith({ ...cur, agent: name, parentAgent: resolvedParent }, fn);
  }

  /** Open a prompt-execution scope (optionally a tracked version). */
  prompt<T>(name: string, fn: () => T, options: { version?: string | null } = {}): T {
    const cur = currentContext();
    return runWith({ ...cur, prompt: name, promptVersion: options.version ?? null }, fn);
  }

  /** Open a tool-execution scope. */
  tool<T>(name: string, fn: () => T): T {
    return runWith(mergeContext(currentContext(), { toolName: name }), fn);
  }

  /** Open an arbitrary attribution scope (e.g. tenant/environment/tags overrides). */
  context<T>(changes: Partial<ObservationContext>, fn: () => T): T {
    return runWith(mergeContext(currentContext(), changes), fn);
  }

  /** The attribution context active on this async task. */
  currentContext(): ObservationContext {
    return currentContext();
  }

  // --- Emit a model call ---

  /**
   * Build, validate, and transport one ObservationEvent from the current context. Returns the
   * emitted event. `timestamp` defaults to now (UTC ISO-8601); pass it explicitly for
   * deterministic fixtures/tests.
   */
  recordLLMCall(params: RecordLLMCallParams): ObservationEvent {
    const event = this.builder.build(currentContext(), {
      ...params,
      timestamp: params.timestamp ?? nowIso(),
    });
    return this.emitter.emit(event);
  }

  // --- Lifecycle ---

  flush(): void | Promise<void> {
    return this.emitter.flush();
  }

  close(): void | Promise<void> {
    return this.emitter.close();
  }
}
