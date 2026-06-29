/**
 * ObservationEventBuilder — assembles a protocol-valid event from context + call data.
 *
 * Producers never construct the event by hand; they supply the call's tokens/cost/latency and
 * the builder fills ids, derives `attribution_status` and `prompt_hash`, and applies the
 * protocol defaults. The output satisfies `protocol.validate` and is field-for-field identical
 * to the Python SDK (only `metadata.sdk` differs — it names the producer).
 */

import { randomUUID } from "node:crypto";
import type { ObservationContext } from "./context.js";
import type { EventStatus, ObservationEvent } from "./protocol.js";
import { PROTOCOL_VERSION, deriveAttributionStatus, promptHash as computePromptHash } from "./protocol.js";

/** The call-specific inputs to a single ObservationEvent. */
export interface BuildParams {
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
  timestamp: string;
  eventId?: string;
  requestId?: string;
  promptHash?: string;
  tags?: readonly string[];
  correlationId?: string;
  metadata?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

/** Producer-level defaults, overridable per call / by context. */
export interface BuilderDefaults {
  applicationName?: string | null;
  applicationVersion?: string | null;
  environment?: string | null;
  tenantId?: string | null;
  sdkName?: string;
}

const DEFAULT_SDK_NAME = "observation-sdk-typescript";

/** Builds one ObservationEvent from an attribution context and a model call. */
export class ObservationEventBuilder {
  private readonly applicationName: string | null;
  private readonly applicationVersion: string | null;
  private readonly environment: string | null;
  private readonly tenantId: string | null;
  private readonly sdkName: string;

  constructor(defaults: BuilderDefaults = {}) {
    this.applicationName = defaults.applicationName ?? null;
    this.applicationVersion = defaults.applicationVersion ?? null;
    this.environment = defaults.environment ?? null;
    this.tenantId = defaults.tenantId ?? null;
    this.sdkName = defaults.sdkName ?? DEFAULT_SDK_NAME;
  }

  build(ctx: ObservationContext, params: BuildParams): ObservationEvent {
    const eid = params.eventId ?? randomUUID().replace(/-/g, "");
    const prompt = ctx.prompt;
    const agent = ctx.agent;
    const sessionId = ctx.sessionId;
    const priced = params.priced ?? true;

    // Base metadata; caller-supplied keys override (mirrors Python's meta.update(metadata)).
    const metadata = {
      priced,
      protocol_version: PROTOCOL_VERSION,
      sdk: this.sdkName,
      ...(params.metadata ?? {}),
    } as Record<string, unknown> & { priced: boolean };

    const mergedTags = [...ctx.tags, ...(params.tags ?? [])];
    const totalTokens = params.totalTokens ?? params.inputTokens + params.outputTokens;

    return {
      event_id: eid,
      timestamp: params.timestamp,
      provider: params.provider,
      model: params.model,
      request_id: params.requestId ?? eid,
      session_id: sessionId,
      conversation_id: ctx.conversationId,
      workflow_id: ctx.workflowId,
      agent,
      parent_agent: ctx.parentAgent,
      prompt,
      prompt_hash: params.promptHash ?? computePromptHash(prompt),
      prompt_version: ctx.promptVersion,
      tool_name: ctx.toolName,
      input_tokens: Math.trunc(params.inputTokens),
      output_tokens: Math.trunc(params.outputTokens),
      total_tokens: Math.trunc(totalTokens),
      latency_ms: params.latencyMs ?? 0,
      cost: params.cost,
      currency: params.currency ?? "USD",
      status: params.status ?? "success",
      attribution_status: deriveAttributionStatus(prompt, agent, sessionId),
      // Operational metadata: context wins, else producer defaults.
      environment: ctx.environment ?? this.environment,
      application_name: ctx.applicationName ?? this.applicationName,
      application_version: ctx.applicationVersion ?? this.applicationVersion,
      tenant_id: ctx.tenantId ?? this.tenantId,
      correlation_id: params.correlationId ?? ctx.correlationId,
      tags: mergedTags,
      metadata,
      raw: params.raw ?? {},
    };
  }
}
