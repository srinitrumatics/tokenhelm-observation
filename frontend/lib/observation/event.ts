import { z } from "zod";

/**
 * The canonical ObservationEvent — the ONLY domain model the analytics layer
 * consumes (locked architectural constraint #1). Every aggregator, API route,
 * and dashboard operates on this shape; no module reads a storage-specific format
 * (JSONL/DuckDB/Postgres/...) directly — that lives behind the EventSource seam.
 *
 * Mirrors specs/002-ai-observability-platform/contracts/observation-event.schema.json.
 *
 * Correctness notes:
 *  - `cost` stays a STRING (variable-precision decimal); summed with decimal.js
 *    downstream, never parsed to a float (SC-001, Constitution V).
 *  - `total_tokens` is taken as recorded and never recomputed.
 *  - `attribution_status` is derived during normalization (see normalize.ts), not
 *    trusted from arbitrary input.
 *  - `metadata.priced` carries the priced/unpriced flag so unpriced events count
 *    tokens but contribute zero cost (Constitution V).
 */

export const ATTRIBUTION_STATUSES = ["complete", "partial", "missing"] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

export const EVENT_STATUSES = ["success", "error"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Sentinel used when an attribution dimension is absent. */
export const UNKNOWN = "unknown";

/** Bucket key for events that cannot be attributed to a named entity. */
export const UNATTRIBUTED = "unattributed";

const isoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "timestamp must be a parseable date" });

export const observationEventSchema = z.object({
  event_id: z.string().min(1),
  timestamp: isoTimestamp,
  provider: z.string().min(1),
  model: z.string().min(1),
  request_id: z.string().min(1),
  session_id: z.string().min(1),
  conversation_id: z.string().nullable().default(null),
  workflow_id: z.string().nullable().default(null),
  agent: z.string().min(1),
  // Parent agent in the execution hierarchy (coordinator → sub-agent). Null/absent
  // for a root agent. The agent execution tree is derived from these edges + tool_name.
  parent_agent: z.string().nullable().default(null),
  prompt: z.string().min(1),
  prompt_hash: z.string().nullable().default(null),
  prompt_version: z.string().nullable().default(null),
  tool_name: z.string().nullable().default(null),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  latency_ms: z.number().nonnegative().default(0),
  cost: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "cost must be a decimal string"),
  currency: z.string().min(1),
  status: z.enum(EVENT_STATUSES).default("success"),
  attribution_status: z.enum(ATTRIBUTION_STATUSES),
  // --- Operational metadata contract (forward-looking; optional, defaulted) ------
  // Reserved now so adding deployment/multi-tenant/correlation context later is
  // never a breaking schema change. Emitters MAY populate these; analytics treat
  // absent values as null/[] and keep functioning.
  environment: z.string().nullable().default(null), // development | staging | production | ...
  application_name: z.string().nullable().default(null),
  application_version: z.string().nullable().default(null),
  tenant_id: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  correlation_id: z.string().nullable().default(null),
  // -----------------------------------------------------------------------------
  metadata: z.record(z.unknown()).default({}),
  raw: z.record(z.unknown()).default({}),
});

export type ObservationEvent = z.infer<typeof observationEventSchema>;

/** Whether an event's cost should be summed (unpriced events count tokens, not cost). */
export function isPriced(event: ObservationEvent): boolean {
  return event.metadata?.priced !== false;
}

/** True when the event is attributed well enough to belong to a named entity. */
export function isAttributed(event: ObservationEvent): boolean {
  return event.attribution_status === "complete";
}
