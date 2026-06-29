"""Transport behaviour: in-memory collection and JSONL serialization."""

import json

from observation_sdk import InMemoryTransport, JsonlTransport, ObservationClient


def test_in_memory_collects_copies():
    t = InMemoryTransport()
    c = ObservationClient(t)
    with c.session("s1"), c.agent("a"), c.prompt("p"):
        e = c.record_llm_call(provider="g", model="m", input_tokens=1, output_tokens=1,
                              cost="0.001", timestamp="2026-06-20T10:00:00+00:00")
    assert len(t.events) == 1
    # stored a copy — mutating the returned event does not change the stored one
    e["cost"] = "9.99"
    assert t.events[0]["cost"] == "0.001"


def test_jsonl_writes_one_valid_json_object_per_line(tmp_path):
    out = tmp_path / "events.jsonl"
    c = ObservationClient(JsonlTransport(str(out), mode="w"))
    with c.session("s1"), c.agent("a"), c.prompt("p"):
        c.record_llm_call(provider="g", model="m", input_tokens=1, output_tokens=1,
                          cost="0.001", timestamp="2026-06-20T10:00:00+00:00", event_id="e1")
        c.record_llm_call(provider="g", model="m", input_tokens=2, output_tokens=2,
                          cost="0.002", timestamp="2026-06-20T10:01:00+00:00", event_id="e2")
    c.close()

    lines = out.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    recs = [json.loads(line) for line in lines]
    assert [r["event_id"] for r in recs] == ["e1", "e2"]
    assert recs[0]["cost"] == "0.001" and isinstance(recs[0]["cost"], str)


def test_jsonl_append_mode_preserves_existing(tmp_path):
    out = tmp_path / "events.jsonl"
    out.write_text('{"existing":true}\n', encoding="utf-8")
    c = ObservationClient(JsonlTransport(str(out), mode="a"))
    with c.session("s1"), c.agent("a"), c.prompt("p"):
        c.record_llm_call(provider="g", model="m", input_tokens=1, output_tokens=1,
                          cost="0.001", timestamp="2026-06-20T10:00:00+00:00", event_id="e1")
    c.close()
    lines = out.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2  # existing line preserved (never overwrites the log)
