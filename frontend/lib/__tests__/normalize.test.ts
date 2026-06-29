import { describe, it, expect } from "vitest";
import { normalize, normalizeAll, deriveAttributionStatus } from "../observation/normalize";

/**
 * T014 — tolerant normalization (FR-005, FR-007). Legacy 001-shape records and
 * canonical 002 records both map to ObservationEvent; attribution_status is derived
 * honestly; nothing is guessed.
 */

const legacyWithAgent = {
  provider: "gemini",
  model: "gemini-3-flash-preview",
  input_tokens: 1200,
  output_tokens: 80,
  total_tokens: 1280,
  latency: 0.25, // SECONDS in legacy
  cost: "0.000800",
  timestamp: "2026-06-19T14:07:59.900565+00:00",
  priced: true,
  currency: "USD",
  agent: "weather_assistant",
};

const legacyNoAgent = { ...legacyWithAgent, agent: undefined };

describe("deriveAttributionStatus", () => {
  it("is complete only when prompt, agent, and session are all present", () => {
    expect(deriveAttributionStatus("p", "a", "s")).toBe("complete");
    expect(deriveAttributionStatus("p", "a", "unknown")).toBe("partial");
    expect(deriveAttributionStatus("unknown", "unknown", "unknown")).toBe("missing");
    expect(deriveAttributionStatus(undefined, undefined, undefined)).toBe("missing");
  });
});

describe("normalize (legacy)", () => {
  it("maps a legacy record with agent to a partial ObservationEvent", () => {
    const e = normalize(legacyWithAgent)!;
    expect(e).not.toBeNull();
    expect(e.agent).toBe("weather_assistant");
    expect(e.prompt).toBe("weather_assistant"); // agent==prompt fallback
    expect(e.session_id).toBe("unknown");
    expect(e.attribution_status).toBe("partial");
    expect(e.cost).toBe("0.000800");
    expect(e.total_tokens).toBe(1280);
    expect(e.metadata.legacy).toBe(true);
    expect(e.metadata.priced).toBe(true);
  });

  it("converts legacy latency seconds to latency_ms", () => {
    const e = normalize(legacyWithAgent)!;
    expect(e.latency_ms).toBe(250);
  });

  it("marks a legacy record with no agent as missing attribution", () => {
    const e = normalize(legacyNoAgent)!;
    expect(e.agent).toBe("unknown");
    expect(e.attribution_status).toBe("missing");
  });

  it("derives a stable content-hash event_id for the same legacy record", () => {
    const a = normalize(legacyWithAgent)!;
    const b = normalize({ ...legacyWithAgent })!;
    expect(a.event_id).toBe(b.event_id); // deterministic
    expect(a.event_id.startsWith("leg_")).toBe(true);
  });
});

describe("normalize (canonical + invalid)", () => {
  it("preserves an emitted event_id and attribution_status", () => {
    const e = normalize({
      event_id: "c1",
      timestamp: "2026-06-20T10:00:00+00:00",
      provider: "gemini",
      model: "gemini-3-flash-preview",
      request_id: "r1",
      session_id: "s1",
      agent: "weather",
      prompt: "weather",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      cost: "0.0010",
      currency: "USD",
      attribution_status: "complete",
    })!;
    expect(e.event_id).toBe("c1");
    expect(e.attribution_status).toBe("complete");
  });

  it("returns null for un-normalizable records (missing model/timestamp)", () => {
    expect(normalize({ provider: "gemini" })).toBeNull();
    expect(normalize("nonsense")).toBeNull();
    expect(normalize(null)).toBeNull();
  });

  it("normalizeAll separates usable events from skipped records", () => {
    const { events, skipped } = normalizeAll([legacyWithAgent, { provider: "x" }, legacyNoAgent]);
    expect(events).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});
