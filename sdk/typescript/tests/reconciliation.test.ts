/**
 * Success-criteria gate (TypeScript side): SDK output is protocol-valid and reconciles, and
 * the committed cross-stack fixture has not drifted from the SDK's current output.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryTransport, ObservationClient, validate, type ObservationEvent } from "../src/index.js";
import {
  EXPECTED_EVENT_COUNT,
  EXPECTED_GLOBAL_TOKENS,
  emitScenario,
} from "../examples/scenario.js";
import { writeFixture } from "../examples/generateFixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tests → typescript → sdk → repo root
const COMMITTED_FIXTURE = path.resolve(
  HERE, "..", "..", "..",
  "frontend", "lib", "__tests__", "fixtures", "sdk-emitted-events.typescript.jsonl",
);

function emit(): ObservationEvent[] {
  const c = new ObservationClient(new InMemoryTransport());
  const events = emitScenario(c);
  void c.close();
  return events;
}

/** Decimal-exact: sum costs as integer ten-thousandths (every fixture cost has 4 decimals). */
function toTenThousandths(cost: string): number {
  const [intPart, fracPart = ""] = cost.split(".");
  const frac = (fracPart + "0000").slice(0, 4);
  return parseInt(intPart ?? "0", 10) * 10000 + parseInt(frac, 10);
}

describe("SDK output reconciles and stays in sync with the fixture", () => {
  it("every emitted event is protocol-valid", () => {
    for (const e of emit()) {
      expect(() => validate(e as unknown as Record<string, unknown>)).not.toThrow();
    }
  });

  it("per-agent cost reconciles to the global total (0.0170)", () => {
    const events = emit();
    const byAgent = new Map<string, number>();
    let total = 0;
    for (const e of events) {
      if (e.metadata.priced) {
        const c = toTenThousandths(e.cost);
        byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + c);
        total += c;
      }
    }
    const sumOfAgents = [...byAgent.values()].reduce((a, b) => a + b, 0);
    expect(sumOfAgents).toBe(total);
    expect(total).toBe(170); // 0.0170
  });

  it("per-provider cost reconciles to the global total", () => {
    const events = emit();
    const byProvider = new Map<string, number>();
    let total = 0;
    for (const e of events) {
      if (e.metadata.priced) {
        const c = toTenThousandths(e.cost);
        byProvider.set(e.provider, (byProvider.get(e.provider) ?? 0) + c);
        total += c;
      }
    }
    const sumOfProviders = [...byProvider.values()].reduce((a, b) => a + b, 0);
    expect(sumOfProviders).toBe(total);
    expect(new Set(byProvider.keys())).toEqual(new Set(["gemini", "openai"]));
  });

  it("token total matches the expected scenario total", () => {
    const events = emit();
    expect(events.length).toBe(EXPECTED_EVENT_COUNT);
    expect(events.reduce((s, e) => s + e.total_tokens, 0)).toBe(EXPECTED_GLOBAL_TOKENS);
  });

  it("the committed cross-stack fixture equals a fresh SDK render (drift guard)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "obs-ts-fx-"));
    try {
      const fresh = path.join(dir, "fresh.jsonl");
      writeFixture(fresh);
      const freshLines = readFileSync(fresh, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      const committed = readFileSync(COMMITTED_FIXTURE, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      expect(freshLines).toEqual(committed); // regenerate with `npm run gen:fixture` if this fails
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
