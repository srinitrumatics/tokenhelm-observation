import {
  observationEventSchema,
  UNKNOWN,
  type AttributionStatus,
  type ObservationEvent,
} from "./event";

/**
 * Tolerant normalization: map ANY raw record — canonical 002 events AND legacy
 * 001-era usage_log.jsonl lines — into the canonical ObservationEvent
 * (constraint #3: legacy normalization exists only for backward compatibility).
 *
 * Legacy records carry only provider/model/tokens/latency/cost/timestamp/priced/
 * currency [+ optional agent]; they normalize with attribution_status = "missing"
 * or "partial" so the platform stays fully functional on historical data while the
 * emitter is enriched (FR-007, FR-030). No attribution is ever guessed.
 */

/** FNV-1a (32-bit) → hex. Pure, dependency-free, deterministic — stable dedup/group ids. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 to keep it unsigned; pad for a stable 8-char hex id.
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable synthetic id for a record lacking an emitted event_id (research D5). */
function contentHashId(parts: Array<string | number | null | undefined>): string {
  return `leg_${fnv1a(parts.map((p) => String(p ?? "")).join("|"))}`;
}

function present(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value !== UNKNOWN;
}

/**
 * Derive attribution_status from the presence of the three core dimensions
 * (prompt, agent, session). complete = all present; missing = none; partial = some.
 * Deterministic — same rule the Python emitter applies.
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

function asNullableString(value: unknown): string | null {
  return present(value) ? (value as string) : null;
}

function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function toCostString(value: unknown): string {
  if (typeof value === "string" && /^[0-9]+(\.[0-9]+)?$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "0";
}

/**
 * Normalize one raw record (already JSON-parsed) into an ObservationEvent.
 * Returns null if the record is too malformed to use (e.g. missing model/tokens);
 * the caller counts these as `skipped`.
 */
export function normalize(record: unknown): ObservationEvent | null {
  if (record === null || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;

  // Minimum viable: a provider+model and a timestamp. Without these we can't place it.
  const provider = asNullableString(r.provider) ?? "unknown";
  const model = asNullableString(r.model);
  const timestamp = typeof r.timestamp === "string" ? r.timestamp : null;
  if (model === null || timestamp === null || Number.isNaN(Date.parse(timestamp))) {
    return null;
  }

  const isCanonical = present(r.event_id) || present(r.attribution_status);

  const agent = asNullableString(r.agent) ?? UNKNOWN;
  // Legacy records have no prompt; the demos treat agent == prompt, so fall back to agent.
  const prompt = asNullableString(r.prompt) ?? (agent !== UNKNOWN ? agent : UNKNOWN);
  const session_id = asNullableString(r.session_id) ?? UNKNOWN;

  const input_tokens = toInt(r.input_tokens);
  const output_tokens = toInt(r.output_tokens);
  const total_tokens = present(String(r.total_tokens)) ? toInt(r.total_tokens) : input_tokens + output_tokens;
  const cost = toCostString(r.cost);
  const currency = asNullableString(r.currency) ?? "USD";

  // latency: canonical carries latency_ms; legacy carries `latency` in SECONDS.
  const latency_ms =
    typeof r.latency_ms === "number"
      ? r.latency_ms
      : typeof r.latency === "number"
        ? r.latency * 1000
        : 0;

  const priced = r.priced === false ? false : true;

  // Prefer an emitted attribution_status; otherwise derive it. Either way it is
  // consistent with the actual presence of prompt/agent/session.
  const attribution_status =
    isCanonical && present(r.attribution_status)
      ? (r.attribution_status as AttributionStatus)
      : deriveAttributionStatus(prompt, agent, session_id);

  const event_id = present(r.event_id)
    ? (r.event_id as string)
    : contentHashId([timestamp, provider, model, input_tokens, output_tokens, total_tokens, cost, agent]);

  const request_id = asNullableString(r.request_id) ?? event_id;

  const candidate: ObservationEvent = {
    event_id,
    timestamp,
    provider,
    model,
    request_id,
    session_id,
    conversation_id: asNullableString(r.conversation_id),
    workflow_id: asNullableString(r.workflow_id),
    agent,
    parent_agent: asNullableString(r.parent_agent),
    prompt,
    prompt_hash: asNullableString(r.prompt_hash) ?? (prompt !== UNKNOWN ? `ph_${fnv1a(prompt)}` : null),
    prompt_version: asNullableString(r.prompt_version),
    tool_name: asNullableString(r.tool_name),
    input_tokens,
    output_tokens,
    total_tokens,
    latency_ms,
    cost,
    currency,
    status: r.status === "error" ? "error" : "success",
    attribution_status,
    // Operational metadata contract — carried through when present, else null/[].
    environment: asNullableString(r.environment),
    application_name: asNullableString(r.application_name),
    application_version: asNullableString(r.application_version),
    tenant_id: asNullableString(r.tenant_id),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    correlation_id: asNullableString(r.correlation_id),
    metadata: {
      priced,
      legacy: !isCanonical,
      ...(typeof r.metadata === "object" && r.metadata !== null ? (r.metadata as object) : {}),
    },
    raw: r,
  };

  // Validate the normalized shape; a normalization bug should fail loudly in tests.
  const parsed = observationEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Normalize a batch, separating usable events from un-normalizable (skipped) records. */
export function normalizeAll(records: unknown[]): { events: ObservationEvent[]; skipped: number } {
  const events: ObservationEvent[] = [];
  let skipped = 0;
  for (const rec of records) {
    const ev = normalize(rec);
    if (ev) events.push(ev);
    else skipped++;
  }
  return { events, skipped };
}
