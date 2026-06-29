/** Context propagation: nesting, automatic parent resolution, and restoration. */

import { describe, it, expect } from "vitest";
import { InMemoryTransport, ObservationClient, UNKNOWN } from "../src/index.js";

describe("attribution context propagation", () => {
  it("nested scopes propagate and restore", () => {
    const c = new ObservationClient(new InMemoryTransport());
    expect(c.currentContext().agent).toBe(UNKNOWN); // default
    c.session("s1", () => {
      expect(c.currentContext().sessionId).toBe("s1");
      c.workflow("wf", () => {
        expect(c.currentContext().workflowId).toBe("wf");
        c.agent("coordinator", () => {
          expect(c.currentContext().agent).toBe("coordinator");
          expect(c.currentContext().parentAgent).toBeNull(); // root
        });
        // restored after the agent scope exits
        expect(c.currentContext().agent).toBe(UNKNOWN);
      });
      expect(c.currentContext().workflowId).toBeNull();
    });
    expect(c.currentContext().sessionId).toBe(UNKNOWN);
  });

  it("a child agent auto-inherits its parent", () => {
    const c = new ObservationClient(new InMemoryTransport());
    c.agent("coordinator", () => {
      c.agent("researcher", () => {
        expect(c.currentContext().agent).toBe("researcher");
        expect(c.currentContext().parentAgent).toBe("coordinator");
      });
    });
  });

  it("an explicit parent overrides auto-resolution", () => {
    const c = new ObservationClient(new InMemoryTransport());
    c.agent("coordinator", () => {
      c.agent("worker", () => {
        expect(c.currentContext().parentAgent).toBe("planner");
      }, { parent: "planner" });
    });
  });

  it("tool and prompt scopes apply to the calls inside them", () => {
    const t = new InMemoryTransport();
    const c = new ObservationClient(t);
    c.session("s1", () =>
      c.agent("a", () =>
        c.prompt("p", () =>
          c.tool("search", () => {
            c.recordLLMCall({
              provider: "gemini", model: "m", inputTokens: 1, outputTokens: 1,
              cost: "0", priced: false, timestamp: "2026-06-20T10:00:00+00:00",
            });
          }),
          { version: "v2" },
        ),
      ),
    );
    const e = t.events[0]!;
    expect(e.tool_name).toBe("search");
    expect(e.prompt).toBe("p");
    expect(e.prompt_version).toBe("v2");
    expect(e.metadata.priced).toBe(false);
  });

  it("sibling prompts do not leak version", () => {
    const t = new InMemoryTransport();
    const c = new ObservationClient(t);
    c.session("s1", () =>
      c.agent("a", () => {
        c.prompt("p1", () => {
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0", priced: false, timestamp: "2026-06-20T10:00:00+00:00",
          });
        }, { version: "v1" });
        c.prompt("p2", () => {
          // no version
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0", priced: false, timestamp: "2026-06-20T10:01:00+00:00",
          });
        });
      }),
    );
    expect(t.events[0]!.prompt_version).toBe("v1");
    expect(t.events[1]!.prompt_version).toBeNull(); // did not leak from the sibling
  });

  it("propagation survives async boundaries", async () => {
    const t = new InMemoryTransport();
    const c = new ObservationClient(t);
    await c.session("s1", async () =>
      c.agent("a", async () =>
        c.prompt("p", async () => {
          await Promise.resolve();
          c.recordLLMCall({
            provider: "g", model: "m", inputTokens: 1, outputTokens: 1,
            cost: "0", priced: false, timestamp: "2026-06-20T10:00:00+00:00",
          });
        }),
      ),
    );
    expect(t.events[0]!.session_id).toBe("s1");
    expect(t.events[0]!.agent).toBe("a");
    expect(t.events[0]!.prompt).toBe("p");
  });
});
