import type { ObservationEvent } from "./event";

/**
 * Response contract for GET /api/overview (and the shared shape future endpoints
 * extend). The API returns normalized ObservationEvents once; the client recomputes
 * each view in-memory per date range (mirrors the 001 dashboard pattern, FR-012).
 *
 * Contract: specs/002-ai-observability-platform/contracts/rest-api.md
 */
export interface ObservationMeta {
  /** EventSource.describe() — where events came from. */
  source: string;
  /** False on cold start (no events yet). */
  present: boolean;
  /** Malformed source records skipped (surfaced honestly — FR-029). */
  skipped: number;
  /** Records collapsed by deduplication. */
  duplicates: number;
  /** ISO time the response was generated. */
  generatedAt: string;
}

export interface ObservationApiResponse {
  events: ObservationEvent[];
  meta: ObservationMeta;
}
