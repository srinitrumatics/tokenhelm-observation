/** Observation Protocol v1 validation rules (TypeScript). */

import { describe, it, expect } from "vitest";
import {
  InMemoryTransport,
  ObservationClient,
  ProtocolValidationError,
  deriveAttributionStatus,
  isValid,
  promptHash,
  validate,
  type ObservationEvent,
} from "../src/index.js";

/** A minimal, valid v1 event (via the SDK, so it is well-formed). */
function validEvent(): ObservationEvent {
  const c = new ObservationClient(new InMemoryTransport());
  return c.session("s1", () =>
    c.agent("a", () =>
      c.prompt("p", () =>
        c.recordLLMCall({
          provider: "gemini", model: "m", inputTokens: 10, outputTokens: 5,
          cost: "0.0010", timestamp: "2026-06-20T10:00:00+00:00", eventId: "e1",
        }),
      ),
    ),
  );
}

describe("Observation Protocol v1", () => {
  it("derives attribution status from dimension presence", () => {
    expect(deriveAttributionStatus("p", "a", "s")).toBe("complete");
    expect(deriveAttributionStatus(null, null, null)).toBe("missing");
    expect(deriveAttributionStatus("p", "a", "unknown")).toBe("partial");
    expect(deriveAttributionStatus("", "a", "s")).toBe("partial"); // empty string is absent
  });

  it("prompt hash is stable, prefixed, and absent for sentinels", () => {
    expect(promptHash("route")).toBe(promptHash("route"));
    expect(promptHash("route")?.startsWith("ph_")).toBe(true);
    expect(promptHash("unknown")).toBeNull();
    expect(promptHash("")).toBeNull();
  });

  it("matches the Python SDK's prompt hashes byte-for-byte", () => {
    // These values come from the committed Python-emitted fixture.
    expect(promptHash("route")).toBe("ph_8a84e406c08a");
    expect(promptHash("plan")).toBe("ph_64879f7d6b96");
    expect(promptHash("weather")).toBe("ph_e5e72beb4e3c");
    expect(promptHash("summary")).toBe("ph_761b7ad8ad43");
  });

  it("a well-formed event passes", () => {
    expect(isValid(validEvent() as unknown as Record<string, unknown>)).toBe(true);
  });

  it("a missing required field fails", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    delete e["currency"];
    expect(() => validate(e)).toThrow(/currency/);
    expect(() => validate(e)).toThrow(ProtocolValidationError);
  });

  it("cost must be a decimal string, never a number", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    e["cost"] = 0.001; // number — forbidden by the money rule
    expect(() => validate(e)).toThrow(/cost/);
    e["cost"] = "1e-3"; // not a plain decimal string
    expect(() => validate(e)).toThrow(/cost/);
  });

  it("metadata.priced is required and boolean", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    e["metadata"] = {};
    expect(() => validate(e)).toThrow(/priced/);
  });

  it("attribution_status must agree with presence", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    e["attribution_status"] = "missing"; // lie about it
    expect(() => validate(e)).toThrow(/attribution_status/);
  });

  it("status enum is enforced", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    e["status"] = "ok";
    expect(() => validate(e)).toThrow(/status/);
  });

  it("negative token counts are rejected", () => {
    const e = validEvent() as unknown as Record<string, unknown>;
    e["input_tokens"] = -1;
    expect(() => validate(e)).toThrow(/input_tokens/);
  });
});
