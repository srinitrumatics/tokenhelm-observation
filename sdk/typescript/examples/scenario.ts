/**
 * A multi-agent 'research-pipeline' scenario, expressed entirely through the SDK.
 *
 * This is the TypeScript twin of `sdk/python/examples/scenario.py` — the SAME logical events
 * (global 0.017 / 1560 tokens, 7 events), expressed through the TS instrumentation API. It is
 * the single source of truth for the TS example generator and the cross-stack parity test, and
 * demonstrates that the platform consumes TS-produced events identically to Python-produced ones.
 *
 * Event ids and timestamps are explicit so the emitted fixture is deterministic.
 */

import type { ObservationClient } from "../src/client.js";
import type { ObservationEvent } from "../src/protocol.js";

const FLASH = "gemini-3-flash-preview";
const PRO = "gemini-3-pro";

/** Emit the scenario through `client` and return the emitted events. */
export function emitScenario(client: ObservationClient): ObservationEvent[] {
  const out: ObservationEvent[] = [];

  // Session s1 / workflow wf-alpha — coordinator delegates to planner + weather.
  client.session("s1", () =>
    client.workflow("wf-alpha", () => {
      client.agent("coordinator", () => {
        // root: parent_agent = null
        client.prompt("route", () => {
          out.push(
            client.recordLLMCall({
              provider: "gemini", model: FLASH, inputTokens: 200, outputTokens: 40,
              cost: "0.0030", timestamp: "2026-06-20T10:00:00+00:00", eventId: "sdk-c1",
            }),
          );
        });
        client.agent("planner", () =>
          client.prompt("plan", () => {
            // parent = coordinator
            out.push(
              client.recordLLMCall({
                provider: "gemini", model: FLASH, inputTokens: 100, outputTokens: 50,
                cost: "0.0020", timestamp: "2026-06-20T10:02:00+00:00", eventId: "sdk-c2",
              }),
            );
          }),
        );
        client.agent("weather", () =>
          client.prompt("weather", () => {
            client.tool("weather_tool", () => {
              out.push(
                client.recordLLMCall({
                  provider: "openai", model: "gpt-x", inputTokens: 150, outputTokens: 30,
                  cost: "0.0025", timestamp: "2026-06-20T10:04:00+00:00", eventId: "sdk-c3",
                }),
              );
            });
            // outside the tool scope ⇒ tool_name = null
            out.push(
              client.recordLLMCall({
                provider: "openai", model: "gpt-x", inputTokens: 150, outputTokens: 0,
                cost: "0.0010", status: "error",
                timestamp: "2026-06-21T09:00:00+00:00", eventId: "sdk-c4",
              }),
            );
          }),
        );
      });
    }),
  );

  // Session s2 / workflow wf-beta — summarizer (pro) + coordinator.
  client.session("s2", () =>
    client.workflow("wf-beta", () => {
      client.agent("coordinator", () => {
        client.agent("summarizer", () =>
          client.prompt("summary", () => {
            out.push(
              client.recordLLMCall({
                provider: "gemini", model: PRO, inputTokens: 380, outputTokens: 120,
                cost: "0.0040", timestamp: "2026-06-21T09:30:00+00:00", eventId: "sdk-c5",
              }),
            );
          }),
        );
        client.prompt("route", () => {
          out.push(
            client.recordLLMCall({
              provider: "gemini", model: FLASH, inputTokens: 200, outputTokens: 40,
              cost: "0.0030", timestamp: "2026-06-21T09:35:00+00:00", eventId: "sdk-c6",
            }),
          );
        });
      });
    }),
  );

  // Unattributed call — no session/agent/prompt scope ⇒ attribution_status = missing.
  out.push(
    client.recordLLMCall({
      provider: "gemini", model: FLASH, inputTokens: 80, outputTokens: 20,
      cost: "0.0015", timestamp: "2026-06-21T11:00:00+00:00", eventId: "sdk-c7",
    }),
  );

  return out;
}

// Expected reconciliation totals (USD), matching the platform fixture.
export const EXPECTED_GLOBAL_COST = "0.0170";
export const EXPECTED_GLOBAL_TOKENS = 1560;
export const EXPECTED_EVENT_COUNT = 7;
