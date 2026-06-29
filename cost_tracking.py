"""Cost & token tracking for the ADK demos, powered by tokenhelm.

Everything funnels through ONE place:

  * `TRACKER`  — a configured tokenhelm.TokenHelm instance. It prices each call
                 using pricing.yaml, prints a line to the console, AND appends a
                 JSON record to usage_log.jsonl (durable audit trail).
  * `STORAGE`  — an in-memory store of every LLMEvent, used to print a summary.
  * `CostTrackingPlugin` — an ADK plugin. Its `after_model_callback` fires on
                 EVERY model response from EVERY agent (single, multi-agent, or
                 pipeline) and tracks it. Register it on the Runner and every LLM
                 call is tracked automatically — nothing per-agent to remember.

Why a plugin? ADK plugins are global hooks that run for all agents and tools, so
this is the single seam that guarantees "everything is tracked" — including the
extra model round-trips that tool calls and sub-agent delegation produce.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import os
import uuid
from decimal import Decimal

from google.adk.models.llm_response import LlmResponse
from google.adk.plugins.base_plugin import BasePlugin

from tokenhelm import (
    ConsoleLogger,
    DefaultEventDispatcher,
    InMemoryStorageBackend,
    TokenHelm,
)
from tokenhelm.core.models import LLMEvent

# tokenhelm-prompt — additive prompt attribution layered on top of tokenhelm. It
# records each tracked call against the active prompt scope (set by the plugin
# below) without touching tokenhelm's own console/JSONL/storage output.
from tokenhelm_prompt import analytics as PROMPT_ANALYTICS
from tokenhelm_prompt import default_store as PROMPT_STORE
from tokenhelm_prompt import make_dispatcher
from tokenhelm_prompt import tracker as PROMPT_TRACKER

# Where to find pricing and where to write the durable usage log.
_HERE = os.path.dirname(os.path.abspath(__file__))
_PRICING = os.path.join(_HERE, "pricing.yaml")
_USAGE_LOG = os.path.join(_HERE, "usage_log.jsonl")

# Which agent produced the model call currently being tracked. Set by the plugin
# (from the ADK callback context) right before TRACKER.track(), and read by the
# JSON logger below so each audit record is attributed to its agent. A ContextVar
# (not a plain global) keeps this correct across ADK's concurrent agent tasks.
_current_agent: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_agent", default="unknown"
)

# Attribution context for the call currently being tracked (session/request/workflow
# ids, prompt, etc.), sourced from ADK's callback context by the plugin. Like
# _current_agent it is a ContextVar so it stays correct across ADK's concurrent
# agent tasks. Defaults to an empty mapping when no context is available (e.g. the
# offline verify harness), in which case the logger falls back to sane defaults.
_current_attribution: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "current_attribution", default={}
)

# Name of the tool whose turn we are in (set by the plugin's tool callbacks), so a
# model round-trip that processes a tool result can be attributed to that tool.
_current_tool: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_tool", default=None
)

_UNKNOWN = "unknown"


def _present(value) -> bool:
    """A dimension is 'present' if it is a non-empty, non-sentinel string."""
    return isinstance(value, str) and value != "" and value != _UNKNOWN


def _attribution_status(prompt, agent, session) -> str:
    """Derive complete/partial/missing from the three core dimensions.

    Same deterministic rule the TypeScript normalizer applies, so canonical events
    emitted here and legacy events normalized in the frontend agree.
    """
    count = sum(1 for v in (prompt, agent, session) if _present(v))
    if count == 3:
        return "complete"
    if count == 0:
        return "missing"
    return "partial"


def _prompt_hash(prompt) -> str | None:
    """Stable short hash of the prompt scope, for grouping identical prompts."""
    if not _present(prompt):
        return None
    return "ph_" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]


def build_observation_event(event: LLMEvent) -> dict:
    """Map a tokenhelm LLMEvent (+ active context) into a canonical ObservationEvent.

    The output is a SUPERSET of the legacy usage_log.jsonl record (it still carries
    ``agent``, ``priced``, ``currency`` and the original token/cost fields), so the
    existing read-only dashboard keeps parsing it (backward compatible — FR-030).
    Mirrors specs/002-ai-observability-platform/contracts/observation-event.schema.json.
    """
    base = event.to_dict()
    attribution = _current_attribution.get() or {}
    agent = _current_agent.get()
    # The demos run one instruction per agent, so prompt == agent unless overridden.
    prompt = attribution.get("prompt") or (agent if agent != _UNKNOWN else _UNKNOWN)
    session_id = attribution.get("session_id") or _UNKNOWN

    event_id = uuid.uuid4().hex
    latency_seconds = base.get("latency") or 0

    return {
        # --- original (legacy-compatible) fields ---
        **base,
        "agent": agent,
        # --- canonical ObservationEvent additions ---
        "event_id": event_id,
        "request_id": attribution.get("request_id") or event_id,
        "session_id": session_id,
        "conversation_id": attribution.get("conversation_id"),
        "workflow_id": attribution.get("workflow_id"),
        "parent_agent": attribution.get("parent_agent"),
        "prompt": prompt,
        "prompt_hash": _prompt_hash(prompt),
        "prompt_version": attribution.get("prompt_version"),
        "tool_name": _current_tool.get(),
        "latency_ms": float(latency_seconds) * 1000.0,
        "status": attribution.get("status", "success"),
        "attribution_status": _attribution_status(prompt, agent, session_id),
        "metadata": {"priced": bool(base.get("priced", True))},
    }


class AgentJSONLogger:
    """JSONL audit logger that writes a canonical ObservationEvent per call.

    tokenhelm's bundled JSONLogger serializes only the normalized event fields (it
    never sees ADK's agent/session context). This drop-in replacement writes the
    canonical ObservationEvent (ids, attribution, status, metadata) built from the
    event plus the active ContextVars — without modifying the frozen LLMEvent or the
    tokenhelm package. The record is a superset of the legacy shape, so it stays
    backward compatible with the existing dashboard.
    """

    def __init__(self, stream) -> None:
        self._stream = stream

    def log(self, event: LLMEvent) -> None:
        record = build_observation_event(event)
        self._stream.write(json.dumps(record))
        self._stream.write("\n")
        self._stream.flush()


# Keep every event so we can print a session summary.
STORAGE = InMemoryStorageBackend()

# Append-only JSON-lines audit trail of every tracked call.
_log_stream = open(_USAGE_LOG, "a", encoding="utf-8")

# The normal tokenhelm sink pipeline: console line + JSONL file + in-memory store.
# The JSONL sink is our AgentJSONLogger so every record carries its agent.
_sinks = DefaultEventDispatcher(
    loggers=[ConsoleLogger(), AgentJSONLogger(stream=_log_stream)],
    storage=STORAGE,
)

# Wrap that pipeline with tokenhelm-prompt's enriching dispatcher: it records each
# event against the active prompt scope (see the plugin below) into PROMPT_STORE for
# per-prompt analytics, then forwards the UNMODIFIED event on to `_sinks`. This is
# purely additive — the console line, JSONL audit trail, and STORAGE are unchanged.
# Note: passing an explicit `dispatcher` REPLACES tokenhelm's default logger+storage
# pipeline, so those sinks are wired through `_sinks` here rather than via TokenHelm's
# `logger=`/`storage=` kwargs. Pricing still applies (it runs before dispatch).
_dispatcher = make_dispatcher(inner=_sinks, store=PROMPT_STORE)

# One tracker for the whole project.
TRACKER = TokenHelm(pricing=_PRICING, dispatcher=_dispatcher)


def _fold_thinking_into_output(llm_response: LlmResponse) -> LlmResponse:
    """Roll Gemini's thinking tokens into the output count.

    Gemini reasoning models (e.g. gemini-3-flash) report three separate counts:
    ``prompt_token_count`` (input), ``candidates_token_count`` (the *visible*
    output), and ``thoughts_token_count`` (the hidden reasoning). Google's
    ``total_token_count`` already includes all three, but tokenhelm's adapter
    maps ``output_tokens`` to ``candidates`` ALONE. That leaves two problems:

      1. ``input + output != total`` (the thinking tokens are unaccounted for).
      2. Cost is undercounted — Google bills thinking tokens at the OUTPUT rate,
         but they were never fed to the cost calculator.

    Folding ``thoughts`` into ``candidates`` fixes both at once: output now covers
    every generated token, ``input + output == total_token_count`` holds, and the
    thinking tokens get priced at the output rate.

    Returns a COPY (pydantic ``model_copy``) so ADK's own downstream use of the
    original response and its usage_metadata is left untouched.
    """
    meta = llm_response.usage_metadata
    thoughts = getattr(meta, "thoughts_token_count", None) or 0
    if meta is None or not thoughts:
        return llm_response  # no usage, or non-thinking call — nothing to fold.
    candidates = getattr(meta, "candidates_token_count", None) or 0
    new_meta = meta.model_copy(update={"candidates_token_count": candidates + thoughts})
    return llm_response.model_copy(update={"usage_metadata": new_meta})


def _safe_session_id(callback_context) -> str | None:
    """Best-effort extraction of the ADK session id from the callback context.

    ADK does not expose a stable public accessor across versions, so this digs
    defensively and returns None on any miss — in which case the event normalizes
    with attribution_status = "partial"/"missing" (honest, never guessed).
    """
    try:
        inv = getattr(callback_context, "_invocation_context", None)
        session = getattr(inv, "session", None)
        return getattr(session, "id", None)
    except Exception:
        return None


def _safe_parent_agent(callback_context) -> str | None:
    """Best-effort parent agent name from ADK context (coordinator → sub-agent).

    Returns None when not resolvable, in which case the agent is treated as a root
    in the execution tree — honest rather than guessed.
    """
    try:
        inv = getattr(callback_context, "_invocation_context", None)
        agent = getattr(inv, "agent", None)
        parent = getattr(agent, "parent_agent", None)
        return getattr(parent, "name", None)
    except Exception:
        return None


def _build_attribution(callback_context, agent_name: str) -> dict:
    """Assemble the attribution mapping for the call from ADK-native context."""
    invocation_id = getattr(callback_context, "invocation_id", None)
    return {
        # One instruction per demo agent → prompt == agent (see CLAUDE.md).
        "prompt": agent_name,
        "session_id": _safe_session_id(callback_context),
        # The invocation groups the model round-trips of one user turn / workflow run.
        "request_id": invocation_id,
        "workflow_id": invocation_id,
        # Parent agent for the execution hierarchy (null for a root).
        "parent_agent": _safe_parent_agent(callback_context),
    }


class CostTrackingPlugin(BasePlugin):
    """Tracks token usage and cost for every model response, across all agents."""

    def __init__(self) -> None:
        super().__init__(name="cost_tracking")

    async def before_tool_callback(self, *, tool=None, **kwargs):
        """Record the active tool so a following model round-trip can be attributed
        to it (tool_name on the ObservationEvent). Defensive across ADK versions."""
        name = getattr(tool, "name", None)
        if name:
            _current_tool.set(name)
        return None

    async def after_tool_callback(self, *, tool=None, **kwargs):
        """Clear the active tool once its turn ends."""
        _current_tool.set(None)
        return None

    async def after_model_callback(
        self, *, callback_context, llm_response: LlmResponse
    ) -> None:
        # Skip streaming partials and any response without usage numbers — the
        # final chunk carries the cumulative usage_metadata we want to price.
        if getattr(llm_response, "partial", False):
            return
        if getattr(llm_response, "usage_metadata", None) is None:
            return
        # Attribute this call to the agent that produced it. The callback context
        # names the currently running agent (the coordinator, a delegated
        # sub-agent, or a pipeline stage); AgentJSONLogger reads this when writing
        # the audit record. Set right before track() so it is current for this call.
        agent_name = getattr(callback_context, "agent_name", None) or "unknown"
        token = _current_agent.set(agent_name)
        # Source the canonical attribution (session/request/workflow ids, prompt)
        # from ADK context so the emitted ObservationEvent is as 'complete' as the
        # runtime allows — read by AgentJSONLogger when it writes the record.
        atoken = _current_attribution.set(_build_attribution(callback_context, agent_name))
        try:
            # Fold Gemini's hidden thinking tokens into the output count so totals
            # are consistent and reasoning tokens are priced (see helper above).
            priced_response = _fold_thinking_into_output(llm_response)
            # Open a tokenhelm-prompt scope named after the producing agent. Each demo
            # agent has exactly one instruction, so "agent == prompt" is the natural
            # attribution across all three patterns. The enriching dispatcher reads
            # this scope when the event is dispatched and records the per-prompt spend.
            # Like `_current_agent`, the scope is contextvar-based, so attribution stays
            # correct across ADK's concurrent agent tasks.
            with PROMPT_TRACKER.prompt(agent_name):
                # LlmResponse exposes both `usage_metadata` and `model_version`, which
                # is exactly what tokenhelm's Gemini adapter reads.
                TRACKER.track(priced_response)
        finally:
            _current_attribution.reset(atoken)
            _current_agent.reset(token)
        return None


def summarize() -> dict:
    """Aggregate everything tracked so far this session."""
    events = list(STORAGE.all())
    total_cost = sum((e.cost for e in events), Decimal("0"))
    return {
        "calls": len(events),
        "input_tokens": sum(e.input_tokens or 0 for e in events),
        "output_tokens": sum(e.output_tokens or 0 for e in events),
        "total_tokens": sum(e.total_tokens or 0 for e in events),
        "total_cost": total_cost,
        "currency": events[0].currency if events else "USD",
        "all_priced": all(e.priced for e in events) if events else True,
    }


def print_summary() -> None:
    s = summarize()
    print("\n" + "=" * 48)
    print("  TOKEN & COST SUMMARY (this run)")
    print("=" * 48)
    print(f"  model calls   : {s['calls']}")
    print(f"  input tokens  : {s['input_tokens']}")
    print(f"  output tokens : {s['output_tokens']}")
    print(f"  total tokens  : {s['total_tokens']}")
    print(f"  total cost    : {s['total_cost']} {s['currency']}")
    if not s["all_priced"]:
        print("  note: some calls were unpriced (model missing from pricing.yaml)")
    print(f"  audit log     : {_USAGE_LOG}")
    print("=" * 48)


def summarize_prompts() -> list[dict]:
    """Per-prompt (here, per-agent) spend, from tokenhelm-prompt's attribution store.

    Where `summarize()` aggregates raw events, this groups by the prompt scope each
    call ran under — answering "which agent/prompt drove the spend this run?".
    Returns one row per prompt, highest cost first.

    Costs here are floats from the prompt-analytics store and are for breakdown only;
    the authoritative, Decimal-precise totals remain `summarize()` and the JSONL log.
    """
    rows = sorted(PROMPT_ANALYTICS.by_prompt(), key=lambda r: r.cost, reverse=True)
    return [
        {"prompt": r.prompt_name, "calls": r.calls, "tokens": r.tokens, "cost": r.cost}
        for r in rows
    ]


def print_prompt_summary() -> None:
    rows = summarize_prompts()
    if not rows:
        return  # nothing was tracked under a prompt scope this run
    print("\n" + "=" * 48)
    print("  PER-PROMPT ATTRIBUTION (this run)")
    print("=" * 48)
    for r in rows:
        print(
            f"  {r['prompt']:<22} calls={r['calls']:<3} "
            f"tokens={r['tokens']:<7} cost=${r['cost']:.6f}"
        )
    print("=" * 48)
