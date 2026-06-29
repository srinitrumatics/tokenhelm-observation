"""Context propagation: nesting, automatic parent resolution, and restoration."""

from observation_sdk import InMemoryTransport, ObservationClient
from observation_sdk.context import current_context


def test_nested_scopes_propagate_and_restore():
    c = ObservationClient(InMemoryTransport())
    assert current_context().agent == "unknown"  # default
    with c.session("s1"):
        assert current_context().session_id == "s1"
        with c.workflow("wf"):
            assert current_context().workflow_id == "wf"
            with c.agent("coordinator"):
                assert current_context().agent == "coordinator"
                assert current_context().parent_agent is None  # root
            # restored after the agent scope exits
            assert current_context().agent == "unknown"
        assert current_context().workflow_id is None
    assert current_context().session_id == "unknown"


def test_child_agent_auto_inherits_parent():
    c = ObservationClient(InMemoryTransport())
    with c.agent("coordinator"):
        with c.agent("researcher"):
            assert current_context().agent == "researcher"
            assert current_context().parent_agent == "coordinator"


def test_explicit_parent_overrides():
    c = ObservationClient(InMemoryTransport())
    with c.agent("coordinator"):
        with c.agent("worker", parent="planner"):
            assert current_context().parent_agent == "planner"


def test_tool_and_prompt_scopes_apply_to_calls():
    t = InMemoryTransport()
    c = ObservationClient(t)
    with c.session("s1"), c.agent("a"), c.prompt("p", version="v2"), c.tool("search"):
        c.record_llm_call(provider="gemini", model="m", input_tokens=1, output_tokens=1,
                          cost="0", priced=False, timestamp="2026-06-20T10:00:00+00:00")
    e = t.events[0]
    assert e["tool_name"] == "search"
    assert e["prompt"] == "p"
    assert e["prompt_version"] == "v2"
    assert e["metadata"]["priced"] is False


def test_sibling_prompts_do_not_leak_version():
    t = InMemoryTransport()
    c = ObservationClient(t)
    with c.session("s1"), c.agent("a"):
        with c.prompt("p1", version="v1"):
            c.record_llm_call(provider="g", model="m", input_tokens=1, output_tokens=1,
                              cost="0", priced=False, timestamp="2026-06-20T10:00:00+00:00")
        with c.prompt("p2"):  # no version
            c.record_llm_call(provider="g", model="m", input_tokens=1, output_tokens=1,
                              cost="0", priced=False, timestamp="2026-06-20T10:01:00+00:00")
    assert t.events[0]["prompt_version"] == "v1"
    assert t.events[1]["prompt_version"] is None  # did not leak from the sibling
