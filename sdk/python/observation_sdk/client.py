"""ObservationClient — the instrumentation API application developers use.

Wraps context propagation + builder + emitter behind a minimal surface. Developers open
scopes (session → workflow → agent → prompt → tool) and record model calls; the SDK derives
attribution, validates against the protocol, and transports the event. No ObservationEvent is
ever constructed by hand, and the SDK never touches storage or analytics directly.

    client = ObservationClient(JsonlTransport("usage_log.jsonl"))
    with client.session("sess-1"), client.workflow("research"):
        with client.agent("coordinator"):
            with client.prompt("route"):
                client.record_llm_call(provider="gemini", model="gemini-3-flash-preview",
                                       input_tokens=320, output_tokens=60, cost="0.0010")
            with client.agent("researcher"):            # parent_agent = coordinator (auto)
                with client.tool("web_search"):
                    client.record_llm_call(provider="gemini", model="gemini-3-pro",
                                           input_tokens=900, output_tokens=240, cost="0.0040")
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from .builder import ObservationEventBuilder
from .context import ObservationContext, _Scope, current_context, push
from .emitter import ObservationEmitter
from .protocol import present
from .transport import Transport


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ObservationClient:
    """Entry point: scopes for instrumentation + ``record_llm_call`` to emit events."""

    def __init__(
        self,
        transport: Transport,
        *,
        application_name: str | None = None,
        application_version: str | None = None,
        environment: str | None = None,
        tenant_id: str | None = None,
        validate_events: bool = True,
    ) -> None:
        self._emitter = ObservationEmitter(transport, validate_events=validate_events)
        self._builder = ObservationEventBuilder(
            application_name=application_name,
            application_version=application_version,
            environment=environment,
            tenant_id=tenant_id,
        )

    # --- Instrumentation scopes (context managers) ---------------------------
    # Each returns a `with`-block scope; nesting them propagates attribution.

    def session(self, session_id: str, *, conversation_id: str | None = None) -> _Scope:
        """Open a session/conversation lifecycle scope."""
        return push(session_id=session_id, conversation_id=conversation_id)

    def workflow(self, workflow_id: str) -> _Scope:
        """Open a workflow/invocation scope."""
        return push(workflow_id=workflow_id)

    def agent(self, name: str, *, parent: str | None = None) -> _Scope:
        """Open an agent-execution scope. ``parent`` auto-resolves to the enclosing agent."""
        cur = current_context()
        resolved_parent = parent if parent is not None else (cur.agent if present(cur.agent) else None)
        # Set parent_agent explicitly (incl. None for a root) — don't inherit a stale value.
        return _Scope(replace(cur, agent=name, parent_agent=resolved_parent))

    def prompt(self, name: str, *, version: str | None = None) -> _Scope:
        """Open a prompt-execution scope (optionally a tracked version)."""
        cur = current_context()
        return _Scope(replace(cur, prompt=name, prompt_version=version))

    def tool(self, name: str) -> _Scope:
        """Open a tool-execution scope."""
        return push(tool_name=name)

    def context(self, **changes) -> _Scope:
        """Open an arbitrary attribution scope (e.g. tenant/environment/tags overrides)."""
        return push(**changes)

    def current_context(self) -> ObservationContext:
        """The attribution context active on this task."""
        return current_context()

    # --- Emit a model call ----------------------------------------------------

    def record_llm_call(
        self,
        *,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost: str,
        currency: str = "USD",
        total_tokens: int | None = None,
        latency_ms: float = 0.0,
        status: str = "success",
        priced: bool = True,
        timestamp: str | None = None,
        event_id: str | None = None,
        request_id: str | None = None,
        prompt_hash: str | None = None,
        tags: tuple[str, ...] | list[str] | None = None,
        correlation_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        raw: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build, validate, and transport one ObservationEvent from the current context.

        Returns the emitted event. ``timestamp`` defaults to now (UTC ISO-8601); pass it
        explicitly for deterministic fixtures/tests.
        """
        event = self._builder.build(
            current_context(),
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
            currency=currency,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            status=status,
            priced=priced,
            timestamp=timestamp or _now_iso(),
            event_id=event_id,
            request_id=request_id,
            prompt_hash=prompt_hash,
            tags=tags,
            correlation_id=correlation_id,
            metadata=metadata,
            raw=raw,
        )
        return self._emitter.emit(event)

    # --- Lifecycle ------------------------------------------------------------

    def flush(self) -> None:
        self._emitter.flush()

    def close(self) -> None:
        self._emitter.close()

    def __enter__(self) -> "ObservationClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()
