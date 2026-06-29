/** `observe` CLI: pure core (validate / lint / stats / decimal sum) + run() exit codes. */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeStats, diffLogs, lintLog, normalizeLog, replayLog, sumDecimals, validateLog } from "../src/cli/core.js";
import { run } from "../src/cli/observe.js";
import { validate } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the Python-emitted fixture (real, canonical) lives under frontend/
const FIX_DIR = path.resolve(HERE, "..", "..", "..", "frontend", "lib", "__tests__", "fixtures");
const PY_FIXTURE = path.join(FIX_DIR, "sdk-emitted-events.jsonl");
const TS_FIXTURE = path.join(FIX_DIR, "sdk-emitted-events.typescript.jsonl");

const tmpDirs: string[] = [];
function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "obs-cli-"));
  tmpDirs.push(dir);
  const p = path.join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("sumDecimals — exact, no float drift", () => {
  it("sums the reconciliation scenario to 0.0170", () => {
    expect(sumDecimals(["0.0030", "0.0020", "0.0025", "0.0010", "0.0040", "0.0030", "0.0015"])).toBe("0.0170");
  });
  it("handles mixed fractional lengths and integers", () => {
    expect(sumDecimals(["1", "0.5", "0.25"])).toBe("1.75");
    expect(sumDecimals(["10", "20"])).toBe("30");
    expect(sumDecimals([])).toBe("0");
  });
});

describe("validateLog", () => {
  it("counts valid/invalid lines and reports per-line problems", () => {
    const valid = '{"event_id":"e1","timestamp":"2026-06-20T10:00:00+00:00","provider":"g","model":"m","request_id":"e1","session_id":"unknown","agent":"unknown","prompt":"unknown","input_tokens":1,"output_tokens":1,"total_tokens":2,"latency_ms":0,"cost":"0","currency":"USD","status":"success","attribution_status":"missing","metadata":{"priced":false},"raw":{}}';
    const badCost = valid.replace('"cost":"0"', '"cost":0.0');
    const notJson = "{ this is not json";
    const report = validateLog([valid, badCost, notJson, ""].join("\n"));
    expect(report.total).toBe(3); // blank line not counted
    expect(report.valid).toBe(1);
    expect(report.invalid).toBe(2);
    expect(report.problems.find((p) => p.kind === "parse")).toBeTruthy();
    expect(report.problems.find((p) => p.kind === "protocol" && /cost/.test(p.message))).toBeTruthy();
  });
});

describe("computeStats over the real SDK fixture", () => {
  it("reconciles cost/tokens and breaks down attribution", () => {
    const text = readFileSync(PY_FIXTURE, "utf8");
    const stats = computeStats(text);
    expect(stats.total).toBe(7);
    expect(stats.global.cost).toBe("0.0170");
    expect(stats.global.tokens).toBe(1560);
    expect(stats.attribution).toEqual({ complete: 6, partial: 0, missing: 1 });
    expect(stats.byProvider.map((g) => g.key)).toEqual(["gemini", "openai"]);
    // per-provider costs reconcile to the global total
    expect(sumDecimals(stats.byProvider.map((g) => g.cost))).toBe("0.0170");
    expect(sumDecimals(stats.byAgent.map((g) => g.cost))).toBe("0.0170");
  });
});

describe("lintLog", () => {
  it("flags the unattributed event without failing", () => {
    const text = readFileSync(PY_FIXTURE, "utf8");
    const report = lintLog(text);
    expect(report.byCode["attribution-incomplete"]).toBe(1); // sdk-c7
    expect(report.byCode["unpriced"]).toBeUndefined();
  });
});

describe("normalizeLog", () => {
  it("canonicalizes a legacy record into a protocol-valid event", () => {
    // legacy: no event_id, agent only (no prompt), latency in seconds, top-level priced
    const legacy = '{"timestamp":"2026-06-20T10:00:00+00:00","provider":"gemini","model":"m","agent":"router","input_tokens":100,"output_tokens":20,"latency":0.25,"cost":"0.0012"}';
    const report = normalizeLog(legacy);
    expect(report.events.length).toBe(1);
    expect(report.skipped.length).toBe(0);
    const e = report.events[0]!;
    expect(() => validate(e as unknown as Record<string, unknown>)).not.toThrow();
    expect(e.event_id.startsWith("obs_")).toBe(true); // synthetic id
    expect(e.prompt).toBe("router"); // agent == prompt fallback
    expect(e.latency_ms).toBe(250); // seconds → ms
    expect(e.attribution_status).toBe("partial"); // session missing
    expect(e.metadata.priced).toBe(true);
  });

  it("skips a record that cannot be placed (no model)", () => {
    const report = normalizeLog('{"timestamp":"2026-06-20T10:00:00+00:00","provider":"g"}');
    expect(report.events.length).toBe(0);
    expect(report.skipped[0]?.error).toMatch(/model/);
  });
});

describe("replayLog — deterministic", () => {
  it("dedupes by event_id and sorts by (timestamp, event_id); is idempotent", () => {
    const a = '{"event_id":"b","timestamp":"2026-06-20T10:02:00+00:00","provider":"g","model":"m","session_id":"s","agent":"a","prompt":"p","input_tokens":1,"output_tokens":1,"cost":"0.001","currency":"USD","status":"success","attribution_status":"complete","metadata":{"priced":true}}';
    const b = '{"event_id":"a","timestamp":"2026-06-20T10:00:00+00:00","provider":"g","model":"m","session_id":"s","agent":"a","prompt":"p","input_tokens":1,"output_tokens":1,"cost":"0.001","currency":"USD","status":"success","attribution_status":"complete","metadata":{"priced":true}}';
    const dupOfA = b; // same event_id "a"
    const first = replayLog([a, b, dupOfA].join("\n"));
    expect(first.events.map((e) => e.event_id)).toEqual(["a", "b"]); // sorted, deduped
    expect(first.duplicates).toBe(1);

    // idempotent: replaying its own JSONL output yields identical ids
    const asJsonl = first.events.map((e) => JSON.stringify(e)).join("\n");
    const second = replayLog(asJsonl);
    expect(second.events.map((e) => e.event_id)).toEqual(first.events.map((e) => e.event_id));
    expect(second.duplicates).toBe(0);
  });
});

describe("diffLogs — cross-SDK parity in one command", () => {
  it("Python vs TypeScript fixtures are equivalent modulo metadata.sdk", () => {
    const py = readFileSync(PY_FIXTURE, "utf8");
    const ts = readFileSync(TS_FIXTURE, "utf8");

    const withoutIgnore = diffLogs(py, ts);
    expect(withoutIgnore.equivalent).toBe(false);
    // the ONLY field that differs across all 7 events is metadata.sdk
    const changedPaths = new Set(withoutIgnore.changed.flatMap((c) => c.diffs.map((d) => d.path)));
    expect([...changedPaths]).toEqual(["metadata.sdk"]);

    const ignored = diffLogs(py, ts, ["metadata.sdk"]);
    expect(ignored.equivalent).toBe(true);
    expect(ignored.changed.length).toBe(0);
  });
});

describe("run() exit codes", () => {
  it("returns 0 for a clean validate, 1 for an invalid log", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const good = tmpFile("good.jsonl", readFileSync(PY_FIXTURE, "utf8"));
    expect(run(["validate", good])).toBe(0);

    const bad = tmpFile("bad.jsonl", '{"provider":"g"}');
    expect(run(["validate", bad, "--quiet"])).toBe(1);
  });

  it("returns 0 for stats, lint, normalize, and replay on a clean log", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const f = tmpFile("log.jsonl", readFileSync(PY_FIXTURE, "utf8"));
    expect(run(["stats", f])).toBe(0);
    expect(run(["lint", f])).toBe(0);
    expect(run(["normalize", f])).toBe(0);
    expect(run(["replay", f])).toBe(0);
  });

  it("diff returns 0 when equivalent (with --ignore), 1 otherwise; 2 without two files", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const py = tmpFile("py.jsonl", readFileSync(PY_FIXTURE, "utf8"));
    const ts = tmpFile("ts.jsonl", readFileSync(TS_FIXTURE, "utf8"));
    expect(run(["diff", py, ts, "--ignore", "metadata.sdk"])).toBe(0);
    expect(run(["diff", py, ts])).toBe(1);
    expect(run(["diff", py])).toBe(2);
  });

  it("returns 2 for an unknown command or missing file argument", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(run(["frobnicate", "x.jsonl"])).toBe(2);
    expect(run(["validate"])).toBe(2);
  });

  it("prints distinct cli/protocol/schema versions with --version", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      writes.push(String(s));
      return true;
    });
    expect(run(["--version"])).toBe(0);
    const out = writes.join("");
    expect(out).toMatch(/cli\/sdk:\s+\d+\.\d+\.\d+/);
    expect(out).toMatch(/protocol:\s+\d+\.\d+/);
    expect(out).toMatch(/schema:\s+\d+\.\d+\.\d+/);
  });
});
