"""A multi-agent 'research-pipeline' scenario, expressed entirely through the SDK.

This is the single source of truth for the example generator and the cross-stack test. It
reproduces the *logical* events of the platform's reconciliation fixture
(``frontend/lib/__tests__/fixtures/reconcile-events.jsonl`` — global 0.017 / 1560 tokens)
using the SDK's instrumentation API, demonstrating that existing TokenHelm instrumentation
can be expressed with the SDK and that the platform consumes the result identically.

Event ids and timestamps are explicit so the emitted fixture is deterministic.
"""

from __future__ import annotations

from typing import Any

from observation_sdk import ObservationClient

_FLASH = "gemini-3-flash-preview"
_PRO = "gemini-3-pro"


def emit_scenario(client: ObservationClient) -> list[dict[str, Any]]:
    """Emit the scenario through ``client`` and return the emitted events."""
    out: list[dict[str, Any]] = []

    # Session s1 / workflow wf-alpha — coordinator delegates to planner + weather.
    with client.session("s1"), client.workflow("wf-alpha"):
        with client.agent("coordinator"):  # root: parent_agent = None
            with client.prompt("route"):
                out.append(client.record_llm_call(
                    provider="gemini", model=_FLASH, input_tokens=200, output_tokens=40,
                    cost="0.0030", timestamp="2026-06-20T10:00:00+00:00", event_id="sdk-c1"))
            with client.agent("planner"), client.prompt("plan"):  # parent = coordinator
                out.append(client.record_llm_call(
                    provider="gemini", model=_FLASH, input_tokens=100, output_tokens=50,
                    cost="0.0020", timestamp="2026-06-20T10:02:00+00:00", event_id="sdk-c2"))
            with client.agent("weather"), client.prompt("weather"):
                with client.tool("weather_tool"):
                    out.append(client.record_llm_call(
                        provider="openai", model="gpt-x", input_tokens=150, output_tokens=30,
                        cost="0.0025", timestamp="2026-06-20T10:04:00+00:00", event_id="sdk-c3"))
                out.append(client.record_llm_call(
                    provider="openai", model="gpt-x", input_tokens=150, output_tokens=0,
                    cost="0.0010", status="error",
                    timestamp="2026-06-21T09:00:00+00:00", event_id="sdk-c4"))

    # Session s2 / workflow wf-beta — summarizer (pro) + coordinator.
    with client.session("s2"), client.workflow("wf-beta"):
        with client.agent("coordinator"):
            with client.agent("summarizer"), client.prompt("summary"):
                out.append(client.record_llm_call(
                    provider="gemini", model=_PRO, input_tokens=380, output_tokens=120,
                    cost="0.0040", timestamp="2026-06-21T09:30:00+00:00", event_id="sdk-c5"))
            with client.prompt("route"):
                out.append(client.record_llm_call(
                    provider="gemini", model=_FLASH, input_tokens=200, output_tokens=40,
                    cost="0.0030", timestamp="2026-06-21T09:35:00+00:00", event_id="sdk-c6"))

    # Unattributed call — no session/agent/prompt scope ⇒ attribution_status = missing.
    out.append(client.record_llm_call(
        provider="gemini", model=_FLASH, input_tokens=80, output_tokens=20,
        cost="0.0015", timestamp="2026-06-21T11:00:00+00:00", event_id="sdk-c7"))

    return out


# Expected reconciliation totals (USD), matching the platform fixture.
EXPECTED_GLOBAL_COST = "0.0170"
EXPECTED_GLOBAL_TOKENS = 1560
EXPECTED_EVENT_COUNT = 7
