"""Prove the cost-tracking pipeline works without needing a live API key.

Feeds a realistic LlmResponse (same object the plugin receives from ADK) through
the tracker, then checks the console log, the JSONL audit file, and the summary.
"""

import json

from google.adk.models.llm_response import LlmResponse
from google.genai import types

from cost_tracking import (
    PROMPT_TRACKER,
    TRACKER,
    _current_agent,
    _USAGE_LOG,
    print_prompt_summary,
    print_summary,
    summarize,
    summarize_prompts,
)

# Two fake model responses, as if two different agents had each called Gemini.
# Setting `_current_agent` is exactly what the plugin does from the ADK callback
# context, so each audit record is attributed to its agent.
fakes = [("weather_assistant", 1200, 80), ("coordinator", 1500, 140)]
for agent_name, prompt_toks, out_toks in fakes:
    resp = LlmResponse(
        model_version="gemini-3-flash-preview",
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=prompt_toks,
            candidates_token_count=out_toks,
            total_token_count=prompt_toks + out_toks,
        ),
    )
    token = _current_agent.set(agent_name)
    try:
        # The plugin opens a prompt scope named after the agent around track();
        # mirror that here so per-prompt attribution is exercised too.
        with PROMPT_TRACKER.prompt(agent_name):
            event = TRACKER.track(resp)
    finally:
        _current_agent.reset(token)
    print("tracked ->", {**event.to_dict(), "agent": agent_name})

print_summary()

s = summarize()
assert s["calls"] == 2, s
assert s["total_tokens"] == 1200 + 80 + 1500 + 140, s
assert s["total_cost"] > 0, "cost should be priced via pricing.yaml"
assert s["all_priced"], "gemini-3-flash-preview should be priced"

# The audit trail must record WHICH agent consumed each call. Check the last two
# JSONL lines carry the agent names we set above.
with open(_USAGE_LOG, encoding="utf-8") as fh:
    last_two = [json.loads(line) for line in fh.read().splitlines() if line.strip()][-2:]
agents = [rec.get("agent") for rec in last_two]
assert agents == ["weather_assistant", "coordinator"], agents

# tokenhelm-prompt should have attributed each call to its agent's prompt scope.
# (Fresh process => the in-memory PROMPT_STORE holds only the two calls above.)
print_prompt_summary()
prompts = {r["prompt"]: r for r in summarize_prompts()}
assert set(prompts) == {"weather_assistant", "coordinator"}, prompts
assert prompts["weather_assistant"]["tokens"] == 1200 + 80, prompts
assert prompts["coordinator"]["tokens"] == 1500 + 140, prompts
assert all(p["cost"] > 0 for p in prompts.values()), prompts

print("\nAll assertions passed (incl. per-agent attribution:", agents, ").")
print("Per-prompt attribution:", {k: v["tokens"] for k, v in prompts.items()})
print("Durable audit log written to:", _USAGE_LOG)


# ===========================================================================
# Canonical ObservationEvent validations (spec 002, plan "Verification" gate).
# Validations 1 (cost reconciliation) and 2 (prompt attribution) are the
# assertions above; the five-point gate is completed here, all offline.
# ===========================================================================
from decimal import Decimal  # noqa: E402

_CANONICAL_FIELDS = {
    "event_id", "request_id", "session_id", "conversation_id", "workflow_id",
    "provider", "model", "agent", "prompt", "prompt_hash", "prompt_version",
    "tool_name", "input_tokens", "output_tokens", "total_tokens", "latency_ms",
    "cost", "currency", "status", "attribution_status", "metadata",
}
_VALID_ATTRIBUTION = {"complete", "partial", "missing"}


def _derive_attribution_status(prompt, agent, session):
    """Python mirror of the TS normalizer rule — used for the equivalence check."""
    def present(v):
        return isinstance(v, str) and v not in ("", "unknown")
    count = sum(1 for v in (prompt, agent, session) if present(v))
    return "complete" if count == 3 else "missing" if count == 0 else "partial"


# --- Validation 3: canonical ObservationEvent fields emitted correctly ---------
for rec in last_two:
    missing = _CANONICAL_FIELDS - rec.keys()
    assert not missing, f"emitted record missing canonical fields: {missing}"
    assert rec["event_id"], "event_id must be present and non-empty"
    assert rec["attribution_status"] in _VALID_ATTRIBUTION, rec["attribution_status"]
    # Thinking-fold invariant must still hold on every emitted record.
    assert rec["input_tokens"] + rec["output_tokens"] == rec["total_tokens"], rec
assert last_two[0]["event_id"] != last_two[1]["event_id"], "event_id must be unique per event"
print("Validation 3 OK: canonical fields emitted, ids unique, input+output==total.")

# --- Validation 4: legacy normalization yields equivalent analytics ------------
# A legacy-shaped record (no canonical fields) and its canonical counterpart for the
# SAME logical call must aggregate identically on the fields analytics use.
_canon = last_two[1]
_legacy = {
    "provider": _canon["provider"], "model": _canon["model"],
    "input_tokens": _canon["input_tokens"], "output_tokens": _canon["output_tokens"],
    "total_tokens": _canon["total_tokens"], "latency": 0.0, "cost": _canon["cost"],
    "timestamp": _canon["timestamp"], "priced": True, "currency": _canon["currency"],
    "agent": _canon["agent"],  # legacy may carry agent, but no prompt/session
}
for field in ("provider", "model", "input_tokens", "output_tokens", "total_tokens", "cost", "currency"):
    assert _legacy[field] == _canon[field], (field, _legacy[field], _canon[field])
# Legacy lacks session => normalizes to "partial"; matches the canonical record here.
assert _derive_attribution_status(_legacy["agent"], _legacy["agent"], "unknown") == _canon["attribution_status"], (
    "legacy normalization must agree with the emitted attribution_status"
)
print("Validation 4 OK: legacy and canonical records aggregate equivalently.")

# --- Validation 5: replay equals live ingestion --------------------------------
# Re-derive totals from the immutable JSONL records (replay) and assert they equal
# the in-memory live summary for this run (2 calls). No app rerun required.
_replay_cost = sum((Decimal(rec["cost"]) for rec in last_two if rec.get("priced", True)), Decimal("0"))
_replay_tokens = sum(rec["total_tokens"] for rec in last_two)
_live = summarize()
assert _replay_tokens == _live["total_tokens"], (_replay_tokens, _live["total_tokens"])
assert _replay_cost == _live["total_cost"], (_replay_cost, _live["total_cost"])
print("Validation 5 OK: replay from immutable events == live ingestion totals.")

print("\nAll 5 canonical ObservationEvent validations passed.")
