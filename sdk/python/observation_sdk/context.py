"""Attribution context propagation via ``contextvars``.

Uses the same contextvar model proven in the v1.0 platform emitter (``cost_tracking.py``):
nested agents, tools, prompts, workflows, and sessions inherit context automatically and
stay correct across concurrent async tasks. Producers never thread attribution through
call signatures by hand.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, replace
from typing import Iterator

from .protocol import UNKNOWN


@dataclass(frozen=True)
class ObservationContext:
    """An immutable snapshot of the current attribution scope.

    Each scope helper (session/workflow/agent/prompt/tool) produces a *new* context
    merged onto its parent and installs it for the duration of the ``with`` block.
    """

    session_id: str = UNKNOWN
    conversation_id: str | None = None
    workflow_id: str | None = None
    agent: str = UNKNOWN
    parent_agent: str | None = None
    prompt: str = UNKNOWN
    prompt_version: str | None = None
    tool_name: str | None = None
    # Operational metadata (deployment / multi-tenant / correlation).
    environment: str | None = None
    application_name: str | None = None
    application_version: str | None = None
    tenant_id: str | None = None
    correlation_id: str | None = None
    tags: tuple[str, ...] = ()

    def merge(self, **changes) -> "ObservationContext":
        """Return a copy with the given fields overridden (None values are ignored)."""
        clean = {k: v for k, v in changes.items() if v is not None}
        return replace(self, **clean)


_CURRENT: contextvars.ContextVar[ObservationContext] = contextvars.ContextVar(
    "observation_context", default=ObservationContext()
)


def current_context() -> ObservationContext:
    """The attribution context active on this task."""
    return _CURRENT.get()


def _set(ctx: ObservationContext) -> contextvars.Token:
    return _CURRENT.set(ctx)


def _reset(token: contextvars.Token) -> None:
    _CURRENT.reset(token)


class _Scope:
    """Context manager that installs a merged context and restores it on exit."""

    def __init__(self, ctx: ObservationContext) -> None:
        self._ctx = ctx
        self._token: contextvars.Token | None = None

    def __enter__(self) -> ObservationContext:
        self._token = _set(self._ctx)
        return self._ctx

    def __exit__(self, *exc) -> None:
        assert self._token is not None
        _reset(self._token)


def push(**changes) -> _Scope:
    """Merge ``changes`` onto the current context and install the result for a ``with`` block."""
    return _Scope(current_context().merge(**changes))


def scope_iter(**changes) -> Iterator[ObservationContext]:  # pragma: no cover - convenience
    """Generator form for advanced callers; prefer :func:`push`."""
    token = _set(current_context().merge(**changes))
    try:
        yield current_context()
    finally:
        _reset(token)
