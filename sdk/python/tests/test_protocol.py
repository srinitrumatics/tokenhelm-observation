"""Observation Protocol v1 validation rules."""

import pytest

from observation_sdk import (
    InMemoryTransport,
    ObservationClient,
    ProtocolValidationError,
    derive_attribution_status,
    is_valid,
    prompt_hash,
    validate,
)


def _valid_event() -> dict:
    """A minimal, valid v1 event (via the SDK, so it is well-formed)."""
    c = ObservationClient(InMemoryTransport())
    with c.session("s1"), c.agent("a"), c.prompt("p"):
        e = c.record_llm_call(provider="gemini", model="m", input_tokens=10, output_tokens=5,
                              cost="0.0010", timestamp="2026-06-20T10:00:00+00:00", event_id="e1")
    return e


def test_attribution_derivation():
    assert derive_attribution_status("p", "a", "s") == "complete"
    assert derive_attribution_status(None, None, None) == "missing"
    assert derive_attribution_status("p", "a", "unknown") == "partial"
    assert derive_attribution_status("", "a", "s") == "partial"  # empty string is absent


def test_prompt_hash_stable_and_absent():
    assert prompt_hash("route") == prompt_hash("route")
    assert prompt_hash("route").startswith("ph_")
    assert prompt_hash("unknown") is None
    assert prompt_hash("") is None


def test_valid_event_passes():
    assert is_valid(_valid_event())


def test_missing_required_field_fails():
    e = _valid_event()
    del e["currency"]
    with pytest.raises(ProtocolValidationError, match="currency"):
        validate(e)


def test_cost_must_be_decimal_string_not_float():
    e = _valid_event()
    e["cost"] = 0.001  # float — forbidden by the money rule
    with pytest.raises(ProtocolValidationError, match="cost"):
        validate(e)
    e["cost"] = "1e-3"  # not a plain decimal string
    with pytest.raises(ProtocolValidationError, match="cost"):
        validate(e)


def test_priced_flag_required_boolean():
    e = _valid_event()
    e["metadata"] = {}
    with pytest.raises(ProtocolValidationError, match="priced"):
        validate(e)


def test_attribution_must_be_consistent_with_presence():
    e = _valid_event()  # complete (prompt+agent+session present)
    e["attribution_status"] = "missing"  # lie about it
    with pytest.raises(ProtocolValidationError, match="attribution_status"):
        validate(e)


def test_status_enum_enforced():
    e = _valid_event()
    e["status"] = "ok"
    with pytest.raises(ProtocolValidationError, match="status"):
        validate(e)


def test_negative_tokens_rejected():
    e = _valid_event()
    e["input_tokens"] = -1
    with pytest.raises(ProtocolValidationError, match="input_tokens"):
        validate(e)
