/**
 * Observation SDK for TypeScript/Node — produce canonical ObservationEvents.
 *
 * A standalone, dependency-free producer SDK that implements **Observation Protocol v1**
 * (see `docs/adr/0002-observation-protocol-v1.md`) — protocol parity with the Python SDK. It
 * depends only on the protocol — never on the dashboard, analytics, or storage — keeping the
 * dependency direction clean:
 *
 *     Application → Observation SDK → Observation Protocol → ObservationEvent → Transport → Platform
 *
 * Quick start:
 *
 *     import { ObservationClient, JsonlTransport } from "@tokenhelm/observation-sdk";
 *
 *     const client = new ObservationClient(new JsonlTransport("usage_log.jsonl"), {
 *       applicationName: "my-app",
 *       environment: "production",
 *     });
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
 *     client.close();
 */

export const VERSION = "0.1.0";

// Core API
export { ObservationClient } from "./client.js";
export type { ClientOptions, RecordLLMCallParams } from "./client.js";
export { ObservationEventBuilder } from "./builder.js";
export type { BuildParams, BuilderDefaults } from "./builder.js";
export { ObservationEmitter } from "./emitter.js";

// Context
export { currentContext, mergeContext, runWith, DEFAULT_CONTEXT } from "./context.js";
export type { ObservationContext } from "./context.js";

// Transports
export { InMemoryTransport, JsonlTransport, HttpTransport } from "./transport.js";
export type { Transport, JsonlTransportOptions, HttpTransportOptions } from "./transport.js";

// Protocol
export {
  PROTOCOL_VERSION,
  UNKNOWN,
  EVENT_STATUSES,
  ATTRIBUTION_STATUSES,
  REQUIRED_FIELDS,
  ProtocolValidationError,
  present,
  deriveAttributionStatus,
  promptHash,
  validate,
  isValid,
  validateAll,
} from "./protocol.js";
export type { ObservationEvent, EventStatus, AttributionStatus } from "./protocol.js";
