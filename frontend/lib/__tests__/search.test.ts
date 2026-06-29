import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { search } from "../analytics/search";

/** T057 — Cross-entity search (FR-027). Uses the consolidated reconcile fixture. */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
async function load() {
  return (await new JsonlEventSource(path.join(FIXTURES, "reconcile-events.jsonl")).read()).events;
}

describe("cross-entity search", () => {
  it("returns nothing for an empty query", async () => {
    expect(search(await load(), "  ")).toEqual([]);
  });

  it("matches across entity types (agent + prompt 'weather')", async () => {
    const results = search(await load(), "weather");
    const types = new Set(results.map((r) => r.type));
    expect(types.has("agent")).toBe(true);
    expect(types.has("prompt")).toBe(true);
    expect(results.every((r) => r.href.length > 0)).toBe(true);
  });

  it("matches workflows and models", async () => {
    const wf = search(await load(), "wf-");
    // workflows match directly; sessions also match via the workflow ids they touched.
    const workflowHits = wf.filter((r) => r.type === "workflow").map((r) => r.id).sort();
    expect(workflowHits).toEqual(["wf-alpha", "wf-beta"]);

    const model = search(await load(), "gpt");
    expect(model.find((r) => r.type === "model")?.id).toBe("gpt-x");
  });

  it("is case-insensitive and ranks by cost desc", async () => {
    const results = search(await load(), "COORDINATOR");
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(Number(results[i - 1].cost)).toBeGreaterThanOrEqual(Number(results[i].cost));
    }
  });
});
