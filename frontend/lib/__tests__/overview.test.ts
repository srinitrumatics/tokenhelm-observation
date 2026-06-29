import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeOverview, computeSummary, filterByRange } from "../analytics/overview";
import { assertReconciles } from "./reconcile";

/**
 * T017 — overview reconciliation (US1). SC-001 zero discrepancy, unpriced honesty,
 * missing-vs-zero distinction, date-range filtering, and the per-dimension
 * reconciliation identities (constraint #5).
 *
 * Known fixture (canonical-events.jsonl), priced USD:
 *   c1 0.0010, c2 0.0020, c3 0.0005, c5 0.0003  → global = 0.0038
 *   c4 is UNPRICED (cost 0, counted in tokens only)
 *   tokens: 120+180+60+120+10 = 490 ; calls = 5 ; one error (c5)
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);

async function loadCanonical() {
  const src = new JsonlEventSource(fixture("canonical-events.jsonl"));
  return (await src.read()).events;
}

describe("overview summary", () => {
  it("computes decimal-exact totals that reconcile to the raw events (SC-001)", async () => {
    const s = computeSummary(await loadCanonical());
    expect(s.callCount).toBe(5);
    expect(s.totalTokens).toBe(490);
    expect(s.costByCurrency.USD).toBe("0.0038");
  });

  it("counts unpriced events in tokens but not cost (Constitution V)", async () => {
    const s = computeSummary(await loadCanonical());
    expect(s.pricedCount).toBe(4);
    expect(s.unpricedCount).toBe(1);
    // c4's 120 tokens are included in the 490 total despite contributing zero cost.
    expect(s.totalTokens).toBe(490);
  });

  it("reports success/failure rate from event status", async () => {
    const s = computeSummary(await loadCanonical());
    expect(s.successCount).toBe(4);
    expect(s.failureCount).toBe(1);
    expect(s.failureRate).toBeCloseTo(1 / 5);
  });

  it("distinguishes attributed from unattributed (missing != zero)", async () => {
    const events = await loadCanonical();
    const s = computeSummary(events);
    expect(s.attributedCalls).toBe(5); // all complete in this fixture
    expect(s.unattributedCalls).toBe(0);
    // Drop attribution on one event → it must surface as unattributed, not vanish.
    const mutated = events.map((e, i) =>
      i === 0 ? { ...e, attribution_status: "missing" as const } : e,
    );
    const s2 = computeSummary(mutated);
    expect(s2.callCount).toBe(5); // still counted
    expect(s2.unattributedCalls).toBe(1);
  });
});

describe("overview breakdowns & reconciliation (constraint #5)", () => {
  it("Σ model cost == global cost and Σ provider cost == global cost", async () => {
    const o = computeOverview(await loadCanonical());
    const global = o.summary.costByCurrency.USD;
    assertReconciles(o.byModel, global, "Σ model == global");
    assertReconciles(o.byProvider, global, "Σ provider == global");
  });

  it("ranks models by cost with correct shares", async () => {
    const o = computeOverview(await loadCanonical());
    expect(o.byModel[0].key).toBe("gemini-3-flash-preview");
    expect(o.byModel[0].cost).toBe("0.0038");
    // The unpriced model appears but contributes zero cost.
    const unpriced = o.byModel.find((g) => g.key === "experimental-unpriced");
    expect(unpriced?.cost).toBe("0");
  });

  it("buckets cost by UTC day in chronological order", async () => {
    const o = computeOverview(await loadCanonical());
    expect(o.costByDay.map((p) => p.bucket)).toEqual(["2026-06-20", "2026-06-21"]);
    expect(o.costByDay[0].cost).toBe("0.003"); // c1+c2 = 0.0010+0.0020
  });
});

describe("date-range filtering (FR-012)", () => {
  it("recomputes within an inclusive range without re-ingesting", async () => {
    const events = await loadCanonical();
    const onlyDay1 = filterByRange(events, "2026-06-20T00:00:00+00:00", "2026-06-20T23:59:59+00:00");
    const s = computeSummary(onlyDay1);
    expect(s.callCount).toBe(2); // c1, c2
    expect(s.costByCurrency.USD).toBe("0.003");
  });
});
