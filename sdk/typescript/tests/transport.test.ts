/** Transport behaviour: in-memory collection and JSONL serialization. */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport, JsonlTransport, ObservationClient } from "../src/index.js";

const tmpDirs: string[] = [];
function tmpFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "obs-ts-"));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("transports", () => {
  it("in-memory collects copies", () => {
    const t = new InMemoryTransport();
    const c = new ObservationClient(t);
    const e = c.session("s1", () =>
      c.agent("a", () =>
        c.prompt("p", () =>
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0.001", timestamp: "2026-06-20T10:00:00+00:00",
          }),
        ),
      ),
    );
    expect(t.events.length).toBe(1);
    // stored a copy — mutating the returned event does not change the stored one
    e.cost = "9.99";
    expect(t.events[0]!.cost).toBe("0.001");
  });

  it("JSONL writes one valid JSON object per line", () => {
    const out = tmpFile("events.jsonl");
    const c = new ObservationClient(new JsonlTransport(out, { mode: "w" }));
    c.session("s1", () =>
      c.agent("a", () =>
        c.prompt("p", () => {
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0.001", timestamp: "2026-06-20T10:00:00+00:00", eventId: "e1",
          });
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 2, outputTokens: 2,
            cost: "0.002", timestamp: "2026-06-20T10:01:00+00:00", eventId: "e2",
          });
        }),
      ),
    );
    void c.close();

    const lines = readFileSync(out, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    expect(lines.length).toBe(2);
    const recs = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(recs.map((r) => r["event_id"])).toEqual(["e1", "e2"]);
    expect(recs[0]!["cost"]).toBe("0.001");
    expect(typeof recs[0]!["cost"]).toBe("string");
  });

  it("JSONL append mode preserves existing lines", () => {
    const out = tmpFile("events.jsonl");
    writeFileSync(out, '{"existing":true}\n', "utf8");
    const c = new ObservationClient(new JsonlTransport(out, { mode: "a" }));
    c.session("s1", () =>
      c.agent("a", () =>
        c.prompt("p", () => {
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0.001", timestamp: "2026-06-20T10:00:00+00:00", eventId: "e1",
          });
        }),
      ),
    );
    void c.close();
    const lines = readFileSync(out, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
    expect(lines.length).toBe(2); // existing line preserved (never overwrites the log)
  });
});
