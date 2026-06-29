import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readUsageLog } from "../usage-log";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const fixture = (name: string) => path.join(FIXTURES, name);

describe("readUsageLog", () => {
  it("parses all valid records from the sample log", async () => {
    const r = await readUsageLog(fixture("valid.jsonl"));
    expect(r.logPresent).toBe(true);
    expect(r.records).toHaveLength(7);
    expect(r.skippedLines).toBe(0);
  });

  it("skips malformed/invalid lines and counts them (FR-009 / SC-005)", async () => {
    const r = await readUsageLog(fixture("mixed.jsonl"));
    // valid.jsonl-style records: 3 good (lines 1,3,6); blank line ignored (not skipped);
    // malformed: "this is not json", empty provider, bad cost → 3 skipped.
    expect(r.records).toHaveLength(3);
    expect(r.skippedLines).toBe(3);
    expect(r.records.every((rec) => rec.model !== "missing-provider")).toBe(true);
    expect(r.records.every((rec) => rec.model !== "bad-cost")).toBe(true);
  });

  it("returns an empty, present result for an empty file", async () => {
    const r = await readUsageLog(fixture("empty.jsonl"));
    expect(r.logPresent).toBe(true);
    expect(r.records).toHaveLength(0);
    expect(r.skippedLines).toBe(0);
  });

  it("returns logPresent=false for a missing file without throwing (FR-008)", async () => {
    const r = await readUsageLog(fixture("does-not-exist.jsonl"));
    expect(r.logPresent).toBe(false);
    expect(r.records).toHaveLength(0);
  });
});
