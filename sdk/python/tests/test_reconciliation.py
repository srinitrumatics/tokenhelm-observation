"""Success-criteria gate (Python side): SDK output is protocol-valid and reconciles,
and the committed cross-stack fixture has not drifted from the SDK's output."""

import json
import os
from collections import defaultdict
from decimal import Decimal

from observation_sdk import InMemoryTransport, ObservationClient, validate
from examples.scenario import (
    EXPECTED_EVENT_COUNT,
    EXPECTED_GLOBAL_TOKENS,
    emit_scenario,
)
from examples.generate_fixture import write_fixture

_REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
_COMMITTED_FIXTURE = os.path.join(
    _REPO, "frontend", "lib", "__tests__", "fixtures", "sdk-emitted-events.jsonl"
)


def _emit() -> list[dict]:
    c = ObservationClient(InMemoryTransport())
    events = emit_scenario(c)
    c.close()
    return events


def test_all_emitted_events_are_protocol_valid():
    for e in _emit():
        validate(e)  # raises on any invalid event


def test_per_agent_cost_reconciles_to_global():
    events = _emit()
    by_agent: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    total = Decimal("0")
    for e in events:
        if e["metadata"]["priced"]:
            by_agent[e["agent"]] += Decimal(e["cost"])
            total += Decimal(e["cost"])
    assert sum(by_agent.values()) == total
    assert total == Decimal("0.0170")


def test_per_provider_cost_reconciles_to_global():
    events = _emit()
    by_provider: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    total = Decimal("0")
    for e in events:
        if e["metadata"]["priced"]:
            by_provider[e["provider"]] += Decimal(e["cost"])
            total += Decimal(e["cost"])
    assert sum(by_provider.values()) == total
    assert set(by_provider) == {"gemini", "openai"}


def test_token_total_matches_expected():
    events = _emit()
    assert len(events) == EXPECTED_EVENT_COUNT
    assert sum(e["total_tokens"] for e in events) == EXPECTED_GLOBAL_TOKENS


def test_committed_fixture_matches_current_sdk_output(tmp_path):
    """Drift guard: the committed cross-stack fixture must equal a fresh SDK render."""
    fresh = tmp_path / "fresh.jsonl"
    write_fixture(str(fresh))
    fresh_lines = [json.loads(line) for line in fresh.read_text(encoding="utf-8").splitlines() if line.strip()]
    committed = [
        json.loads(line)
        for line in open(_COMMITTED_FIXTURE, encoding="utf-8").read().splitlines()
        if line.strip()
    ]
    assert fresh_lines == committed, (
        "sdk-emitted-events.jsonl is stale — regenerate with "
        "`python sdk/python/examples/generate_fixture.py`"
    )
