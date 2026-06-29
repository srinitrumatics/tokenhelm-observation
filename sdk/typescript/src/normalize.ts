/**
 * Protocol-level canonicalization: turn an arbitrary / legacy / partial record into a
 * protocol-valid ObservationEvent. This is the producer-side counterpart to the SDK builder —
 * it fills derived fields (attribution_status, prompt_hash, synthetic ids) and protocol defaults
 * so the result passes `validate()`. It powers `observe normalize` and `observe replay`.
 *
 * It uses the PROTOCOL's definitions (sha256 prompt_hash; sha256-based synthetic event ids), so a
 * normalized event is indistinguishable from one a producer SDK would have emitted. Records that
 * lack the irreducible minimum (model + a parseable timestamp) cannot be placed and are reported.
 */

import { createHash } from "node:crypto";
import type { AttributionStatus, ObservationEvent } from "./protocol.js";
import { UNKNOWN, deriveAttributionStatus, present, promptHash } from "./protocol.js";

const COST_RE = /^[0-9]+(\.[0-9]+)?$/;

function asNullableString(v: unknown): string | null {
  return present(v) ? v : null;
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function toCostString(v: unknown): string {
  if (typeof v === "string" && COST_RE.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(v);
  return "0";
}

function readPriced(r: Record<string, unknown>): boolean {
  const m = r["metadata"];
  if (typeof m === "object" && m !== null && "priced" in m) {
    return (m as Record<string, unknown>)["priced"] !== false;
  }
  return r["priced"] !== false;
}

/** Deterministic synthetic id for a record lacking an emitted event_id. */
function syntheticId(parts: Array<string | number | null>): string {
  const hash = createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex");
  return "obs_" + hash.slice(0, 12);
}

export interface NormalizeResult {
  event?: ObservationEvent;
  error?: string;
}

/** Normalize one already-JSON-parsed record into a canonical ObservationEvent (or report why not). */
export function normalizeRecord(raw: unknown): NormalizeResult {
  if (raw === null || typeof raw !== "object") return { error: "record is not a JSON object" };
  const r = raw as Record<string, unknown>;

  const model = asNullableString(r["model"]);
  if (model === null) return { error: "missing 'model'" };
  const timestamp = typeof r["timestamp"] === "string" ? (r["timestamp"] as string) : null;
  if (timestamp === null || Number.isNaN(Date.parse(timestamp))) {
    return { error: "missing or unparseable 'timestamp'" };
  }

  const provider = asNullableString(r["provider"]) ?? UNKNOWN;
  const agent = asNullableString(r["agent"]) ?? UNKNOWN;
  // Legacy records have no prompt; the demos treat agent == prompt, so fall back to agent.
  const prompt = asNullableString(r["prompt"]) ?? (agent !== UNKNOWN ? agent : UNKNOWN);
  const sessionId = asNullableString(r["session_id"]) ?? UNKNOWN;

  const inputTokens = toInt(r["input_tokens"]);
  const outputTokens = toInt(r["output_tokens"]);
  const totalTokens = typeof r["total_tokens"] === "number" ? toInt(r["total_tokens"]) : inputTokens + outputTokens;
  const cost = toCostString(r["cost"]);
  const currency = asNullableString(r["currency"]) ?? "USD";

  // canonical carries latency_ms; legacy carries `latency` in SECONDS.
  const latencyMs =
    typeof r["latency_ms"] === "number"
      ? (r["latency_ms"] as number)
      : typeof r["latency"] === "number"
        ? (r["latency"] as number) * 1000
        : 0;

  const emitted = r["attribution_status"];
  const isCanonical = present(r["event_id"]) || present(emitted);
  const attribution: AttributionStatus =
    isCanonical && (emitted === "complete" || emitted === "partial" || emitted === "missing")
      ? emitted
      : deriveAttributionStatus(prompt, agent, sessionId);

  const eventId =
    asNullableString(r["event_id"]) ??
    syntheticId([timestamp, provider, model, inputTokens, outputTokens, totalTokens, cost, agent]);

  const metaIn = typeof r["metadata"] === "object" && r["metadata"] !== null ? (r["metadata"] as Record<string, unknown>) : {};
  const priced = readPriced(r);

  const event: ObservationEvent = {
    event_id: eventId,
    timestamp,
    provider,
    model,
    request_id: asNullableString(r["request_id"]) ?? eventId,
    session_id: sessionId,
    conversation_id: asNullableString(r["conversation_id"]),
    workflow_id: asNullableString(r["workflow_id"]),
    agent,
    parent_agent: asNullableString(r["parent_agent"]),
    prompt,
    prompt_hash: asNullableString(r["prompt_hash"]) ?? promptHash(prompt),
    prompt_version: asNullableString(r["prompt_version"]),
    tool_name: asNullableString(r["tool_name"]),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    latency_ms: latencyMs >= 0 ? latencyMs : 0,
    cost,
    currency,
    status: r["status"] === "error" ? "error" : "success",
    attribution_status: attribution,
    environment: asNullableString(r["environment"]),
    application_name: asNullableString(r["application_name"]),
    application_version: asNullableString(r["application_version"]),
    tenant_id: asNullableString(r["tenant_id"]),
    correlation_id: asNullableString(r["correlation_id"]),
    tags: Array.isArray(r["tags"]) ? (r["tags"] as unknown[]).filter((t): t is string => typeof t === "string") : [],
    // Preserve carried metadata, but guarantee a boolean `priced` (the money rule).
    metadata: { ...metaIn, priced },
    raw: typeof r["raw"] === "object" && r["raw"] !== null ? (r["raw"] as Record<string, unknown>) : {},
  };

  return { event };
}

/** Stable order for replay: by timestamp, then event_id (total, deterministic). */
export function sortEvents(events: ObservationEvent[]): ObservationEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
  });
}

/** Deduplicate by event_id, keeping the first occurrence. */
export function dedupeEvents(events: ObservationEvent[]): ObservationEvent[] {
  const seen = new Set<string>();
  const out: ObservationEvent[] = [];
  for (const e of events) {
    if (seen.has(e.event_id)) continue;
    seen.add(e.event_id);
    out.push(e);
  }
  return out;
}
