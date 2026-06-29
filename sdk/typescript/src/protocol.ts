/**
 * Observation Protocol v1 — the language-neutral ObservationEvent contract (TypeScript).
 *
 * This is the TypeScript expression of the protocol defined in
 * `docs/adr/0002-observation-protocol-v1.md` — the same contract the Python SDK implements.
 * It is dependency-free (Node stdlib only) so the SDK stays light and embeddable. Producers
 * build events that satisfy `validate()`; the platform consumes the same shape.
 *
 * The SDK depends ONLY on this protocol — never on the dashboard, analytics, or storage.
 */

import { createHash } from "node:crypto";

/**
 * Three independently-evolvable versions (do not conflate them):
 *  - PROTOCOL_VERSION — the semantic contract (this file + the conformance kit). Bumps only on a
 *    contract change; v1.x stays backward compatible (add optional fields, never repurpose/remove).
 *  - SCHEMA_VERSION   — the revision of the JSON Schema *artifact*
 *    (specs/.../contracts/observation-event.schema.json). Can advance for editorial/clarity fixes
 *    within the same PROTOCOL_VERSION.
 *  - the SDK version  — the npm package version (see package.json / `VERSION` in index.ts).
 */
export const PROTOCOL_VERSION = "1.0";
export const SCHEMA_VERSION = "1.0.0";

/** Sentinel used when an attribution dimension is absent (matches the platform). */
export const UNKNOWN = "unknown";

export const EVENT_STATUSES = ["success", "error"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ATTRIBUTION_STATUSES = ["complete", "partial", "missing"] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

/** The canonical ObservationEvent — identical field-for-field to the Python SDK output. */
export interface ObservationEvent {
  event_id: string;
  timestamp: string;
  provider: string;
  model: string;
  request_id: string;
  session_id: string;
  conversation_id: string | null;
  workflow_id: string | null;
  agent: string;
  parent_agent: string | null;
  prompt: string;
  prompt_hash: string | null;
  prompt_version: string | null;
  tool_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost: string;
  currency: string;
  status: EventStatus;
  attribution_status: AttributionStatus;
  environment: string | null;
  application_name: string | null;
  application_version: string | null;
  tenant_id: string | null;
  correlation_id: string | null;
  tags: string[];
  metadata: Record<string, unknown> & { priced: boolean };
  raw: Record<string, unknown>;
}

/** Required fields a valid v1 event MUST carry (mirrors the canonical schema). */
export const REQUIRED_FIELDS = [
  "event_id",
  "timestamp",
  "provider",
  "model",
  "request_id",
  "session_id",
  "agent",
  "prompt",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "latency_ms",
  "cost",
  "currency",
  "status",
  "attribution_status",
] as const;

const COST_RE = /^[0-9]+(\.[0-9]+)?$/;

/** Raised when an event does not satisfy Observation Protocol v1. */
export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

/** A dimension is 'present' if it is a non-empty, non-sentinel string. */
export function present(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value !== UNKNOWN;
}

/**
 * complete = prompt+agent+session all present; missing = none; partial = some.
 * The same deterministic rule the platform applies, so an emitted value always agrees
 * with field presence.
 */
export function deriveAttributionStatus(
  prompt: unknown,
  agent: unknown,
  session: unknown,
): AttributionStatus {
  const count = [prompt, agent, session].filter(present).length;
  if (count === 3) return "complete";
  if (count === 0) return "missing";
  return "partial";
}

/** Stable short hash of the prompt scope (groups identical prompts). */
export function promptHash(prompt: unknown): string | null {
  if (!present(prompt)) return null;
  return "ph_" + createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 12);
}

function isNonNegInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validate an event against Observation Protocol v1. Returns the event unchanged on
 * success; throws {@link ProtocolValidationError} otherwise. Called by the emitter before
 * transport, so an invalid event never leaves a producer.
 */
export function validate(event: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!(field in event)) errors.push(`missing required field '${field}'`);
  }

  // Non-empty strings.
  for (const field of [
    "event_id",
    "provider",
    "model",
    "request_id",
    "session_id",
    "agent",
    "prompt",
    "currency",
  ]) {
    if (field in event) {
      const v = event[field];
      if (!(typeof v === "string" && v !== "")) errors.push(`'${field}' must be a non-empty string`);
    }
  }

  // Timestamp must be a string (ISO-8601; parseability is the consumer's tolerant concern).
  if ("timestamp" in event && typeof event["timestamp"] !== "string") {
    errors.push("'timestamp' must be an ISO-8601 string");
  }

  // Token counts.
  for (const field of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (field in event && !isNonNegInt(event[field])) errors.push(`'${field}' must be an integer >= 0`);
  }

  // Latency.
  if ("latency_ms" in event) {
    const lat = event["latency_ms"];
    if (!(typeof lat === "number" && Number.isFinite(lat) && lat >= 0)) {
      errors.push("'latency_ms' must be a number >= 0");
    }
  }

  // Cost is a decimal STRING (never a number).
  if ("cost" in event) {
    const cost = event["cost"];
    if (!(typeof cost === "string" && COST_RE.test(cost))) {
      errors.push("'cost' must be a decimal string matching ^[0-9]+(\\.[0-9]+)?$");
    }
  }

  // Enums.
  if ("status" in event && !EVENT_STATUSES.includes(event["status"] as EventStatus)) {
    errors.push(`'status' must be one of ${EVENT_STATUSES.join(", ")}`);
  }
  if (
    "attribution_status" in event &&
    !ATTRIBUTION_STATUSES.includes(event["attribution_status"] as AttributionStatus)
  ) {
    errors.push(`'attribution_status' must be one of ${ATTRIBUTION_STATUSES.join(", ")}`);
  }

  // Attribution must be consistent with the actual presence of the dimensions.
  if ("attribution_status" in event) {
    const expected = deriveAttributionStatus(event["prompt"], event["agent"], event["session_id"]);
    if (event["attribution_status"] !== expected) {
      errors.push(
        `'attribution_status' is '${String(event["attribution_status"])}' but presence implies '${expected}'`,
      );
    }
  }

  // metadata.priced must be present and boolean (the money rule).
  const meta = event["metadata"];
  if (!(typeof meta === "object" && meta !== null && typeof (meta as Record<string, unknown>)["priced"] === "boolean")) {
    errors.push("'metadata.priced' must be a boolean");
  }

  // tags must be a list of strings when present.
  const tags = event["tags"];
  if (tags !== undefined && tags !== null && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) {
    errors.push("'tags' must be a list of strings");
  }

  if (errors.length > 0) throw new ProtocolValidationError(errors.join("; "));
  return event;
}

/** Boolean form of {@link validate}. */
export function isValid(event: Record<string, unknown>): boolean {
  try {
    validate(event);
    return true;
  } catch (err) {
    if (err instanceof ProtocolValidationError) return false;
    throw err;
  }
}

/** Validate a batch, throwing on the first invalid event. */
export function validateAll(events: Record<string, unknown>[]): Record<string, unknown>[] {
  return events.map(validate);
}
