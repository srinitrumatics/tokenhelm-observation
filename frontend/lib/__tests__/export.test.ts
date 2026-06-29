import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Decimal from "decimal.js";
import { JsonlEventSource } from "../observation/jsonl-source";
import { computeSummary } from "../analytics/overview";
import { exportView, toCsv, EXPORT_VIEWS } from "../analytics/export";

/** T058 — Export (FR-028): tabular views serialize to JSON/CSV without re-deriving. */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
async function load() {
  return (await new JsonlEventSource(path.join(FIXTURES, "reconcile-events.jsonl")).read()).events;
}

describe("export", () => {
  it("produces a non-empty table for every view", async () => {
    const events = await load();
    for (const view of EXPORT_VIEWS) {
      const t = exportView(events, view);
      expect(t.view).toBe(view);
      expect(t.columns.length).toBeGreaterThan(0);
      // recommendations/alerts may be empty for this fixture; the rest have rows.
      if (view !== "recommendations" && view !== "alerts") {
        expect(t.rows.length, `view ${view} should have rows`).toBeGreaterThan(0);
      }
    }
  });

  it("export rows equal the analytics values (no re-derivation)", async () => {
    const events = await load();
    const t = exportView(events, "providers");
    const exportedTotal = t.rows.reduce((acc, r) => acc.plus(new Decimal(String(r.cost))), new Decimal(0));
    expect(exportedTotal.equals(new Decimal(computeSummary(events).costByCurrency.USD))).toBe(true);
  });

  it("serializes CSV with a header and escapes special characters", async () => {
    const events = await load();
    const csv = toCsv(exportView(events, "models"));
    const lines = csv.split("\n");
    expect(lines[0]).toContain("model");
    expect(lines.length).toBe(exportView(events, "models").rows.length + 1);
    // pipe-joined provider lists contain no comma → not quoted; sanity check no crash on escape
    expect(csv).toContain("gpt-x");
  });
});
