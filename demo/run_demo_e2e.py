"""End-to-end demo: a realistic multi-agent TokenHelm application.

Drives the REAL cost-tracking pipeline (tokenhelm pricing + tokenhelm-prompt
attribution + the canonical ObservationEvent emitter in cost_tracking.py) to produce a
realistic multi-agent workflow trace, WITHOUT needing a Google API key — exactly the
offline-verifiable approach of verify_tracking.py (Constitution IV).

It simulates a "research-pipeline" workflow: a coordinator delegates to researcher /
writer / critic sub-agents (with tool calls), across three user sessions, including a
degraded translation sub-agent that fails repeatedly — so the resulting log exercises
every dashboard surface: cost/overview, prompts (with v1/v2 versions), agents (with
hierarchy + a failing agent → a Reliability recommendation and a failure-spike alert),
workflows, sessions, and models (priced flash + honestly-unpriced pro). Events are
stamped at emission time, so this is a single-day trace; the multi-day spike scenarios
are covered by the unit fixtures (anomaly-events.jsonl) instead.

Output: an ISOLATED log at demo/demo_usage_log.jsonl (the real usage_log.jsonl is left
untouched — the JSONL sink stream is redirected for the duration of the run). Point the
dashboard at it with:

    cd frontend
    USAGE_LOG_PATH=../demo/demo_usage_log.jsonl npm run dev      # then open localhost:3000

Run:  python demo/run_demo_e2e.py
"""

from __future__ import annotations

import os
import sys
from decimal import Decimal

# cost_tracking.py lives at the project root (one level up from demo/).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from google.adk.models.llm_response import LlmResponse
from google.genai import types

import cost_tracking as ct
from cost_tracking import (
    PROMPT_TRACKER,
    TRACKER,
    _current_agent,
    _current_attribution,
    _current_tool,
    build_observation_event,
    summarize,
)

_HERE = os.path.dirname(os.path.abspath(__file__))
DEMO_LOG = os.path.join(_HERE, "demo_usage_log.jsonl")
WORKFLOW = "research-pipeline"


def _response(model: str, prompt_toks: int, out_toks: int) -> LlmResponse:
    """A fake LlmResponse — the exact object the plugin receives from ADK."""
    return LlmResponse(
        model_version=model,
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=prompt_toks,
            candidates_token_count=out_toks,
            total_token_count=prompt_toks + out_toks,
        ),
    )


def _emit(step: dict) -> dict:
    """Track one model call through the REAL pipeline; return the canonical record.

    Sets the same ContextVars the CostTrackingPlugin sets from its ADK callbacks, so the
    emitted ObservationEvent carries full attribution (workflow/session/parent/tool/...).
    """
    resp = _response(step["model"], step["prompt_toks"], step["out_toks"])
    attribution = {
        "prompt": step["prompt"],
        "session_id": step["session"],
        "request_id": step["request_id"],
        "conversation_id": step["session"],
        "workflow_id": WORKFLOW,
        "parent_agent": step.get("parent"),
        "prompt_version": step.get("version"),
        "status": step.get("status", "success"),
    }
    a = _current_agent.set(step["agent"])
    b = _current_attribution.set(attribution)
    c = _current_tool.set(step.get("tool"))
    try:
        with PROMPT_TRACKER.prompt(step["prompt"]):
            event = TRACKER.track(resp)
        # The redirected AgentJSONLogger already wrote the canonical record to DEMO_LOG;
        # build it again only so we can print/inspect it here.
        return build_observation_event(event)
    finally:
        _current_tool.reset(c)
        _current_attribution.reset(b)
        _current_agent.reset(a)


# --- The simulated multi-agent workload --------------------------------------
# Three sessions. Session 3 introduces a failing "translator" sub-agent and heavier
# writer prompts (v2), so the dashboard surfaces a real recommendation and alert.
FLASH = "gemini-3-flash-preview"
PRO = "gemini-3-pro"

# Session 1 — a calm baseline run.
SESSION_1 = [
    {"agent": "coordinator", "parent": None, "prompt": "route", "model": FLASH, "prompt_toks": 320, "out_toks": 60, "session": "sess-1", "request_id": "req-1"},
    {"agent": "researcher", "parent": "coordinator", "prompt": "research", "model": FLASH, "prompt_toks": 600, "out_toks": 120, "tool": "web_search", "session": "sess-1", "request_id": "req-1"},
    {"agent": "writer", "parent": "coordinator", "prompt": "compose", "version": "v1", "model": FLASH, "prompt_toks": 500, "out_toks": 180, "session": "sess-1", "request_id": "req-1"},
    {"agent": "critic", "parent": "coordinator", "prompt": "review", "model": FLASH, "prompt_toks": 400, "out_toks": 70, "session": "sess-1", "request_id": "req-1"},
]

# Session 2 — heavier writer prompt (v2) on the pricier pro model.
SESSION_2 = [
    {"agent": "coordinator", "parent": None, "prompt": "route", "model": FLASH, "prompt_toks": 320, "out_toks": 60, "session": "sess-2", "request_id": "req-2"},
    {"agent": "researcher", "parent": "coordinator", "prompt": "research", "model": PRO, "prompt_toks": 900, "out_toks": 240, "tool": "web_search", "session": "sess-2", "request_id": "req-2"},
    {"agent": "writer", "parent": "coordinator", "prompt": "compose", "version": "v2", "model": PRO, "prompt_toks": 1200, "out_toks": 1600, "session": "sess-2", "request_id": "req-2"},
    {"agent": "critic", "parent": "coordinator", "prompt": "review", "model": FLASH, "prompt_toks": 400, "out_toks": 70, "session": "sess-2", "request_id": "req-2"},
]

# Session 3 — a degraded translation sub-agent that fails repeatedly (failure-spike
# alert + a Reliability recommendation), plus heavier volume.
SESSION_3 = [
    {"agent": "coordinator", "parent": None, "prompt": "route", "model": FLASH, "prompt_toks": 320, "out_toks": 60, "session": "sess-3", "request_id": "req-3"},
    {"agent": "translator", "parent": "coordinator", "prompt": "translate", "model": FLASH, "prompt_toks": 1500, "out_toks": 50, "status": "error", "session": "sess-3", "request_id": "req-3"},
    {"agent": "translator", "parent": "coordinator", "prompt": "translate", "model": FLASH, "prompt_toks": 1500, "out_toks": 50, "status": "error", "session": "sess-3", "request_id": "req-3"},
    {"agent": "translator", "parent": "coordinator", "prompt": "translate", "model": FLASH, "prompt_toks": 1500, "out_toks": 50, "status": "error", "session": "sess-3", "request_id": "req-3"},
    {"agent": "writer", "parent": "coordinator", "prompt": "compose", "version": "v2", "model": PRO, "prompt_toks": 1200, "out_toks": 1500, "session": "sess-3", "request_id": "req-3"},
]


def _redirect_log_to_demo():
    """Point the AgentJSONLogger sink at the demo file so the real log stays untouched."""
    stream = open(DEMO_LOG, "w", encoding="utf-8")  # truncate for a clean, repeatable run
    swapped = []
    for logger in ct._sinks.loggers:
        if isinstance(logger, ct.AgentJSONLogger):
            swapped.append((logger, logger._stream))
            logger._stream = stream
    return stream, swapped


def _restore_log(stream, swapped):
    for logger, original in swapped:
        logger._stream = original
    stream.flush()
    stream.close()


def main() -> None:
    stream, swapped = _redirect_log_to_demo()
    records = []
    try:
        for session in (SESSION_1, SESSION_2, SESSION_3):
            for step in session:
                records.append(_emit(step))
    finally:
        _restore_log(stream, swapped)

    # Reconciliation: Σ per-agent cost == global cost (the same identity the dashboard
    # tests enforce), proven here over the freshly emitted records.
    by_agent: dict[str, Decimal] = {}
    total = Decimal("0")
    for r in records:
        if r["metadata"]["priced"]:
            c = Decimal(str(r["cost"]))
            by_agent[r["agent"]] = by_agent.get(r["agent"], Decimal("0")) + c
            total += c
    assert sum(by_agent.values()) == total, "per-agent cost must reconcile to the global total"

    live = summarize()
    print(f"Emitted {len(records)} ObservationEvents across 3 sessions.")
    print(f"Workflow: {WORKFLOW}  |  agents: {sorted({r['agent'] for r in records})}")
    print(f"Models:   {sorted({r['model'] for r in records})}")
    print(f"Failures: {sum(1 for r in records if r['status'] == 'error')} (translator on session sess-3)")
    print("Per-agent cost (reconciles to global):")
    for agent, cost in sorted(by_agent.items(), key=lambda kv: kv[1], reverse=True):
        print(f"  {agent:<12} {cost}")
    print(f"Global (this run): cost={total}  tokens={sum(r['total_tokens'] for r in records)}")
    print(f"Cumulative tracker total (priced): {live['total_cost']}")
    print(f"\nDurable demo log: {DEMO_LOG}")
    print("View it:  cd frontend && USAGE_LOG_PATH=../demo/demo_usage_log.jsonl npm run dev")


if __name__ == "__main__":
    main()
