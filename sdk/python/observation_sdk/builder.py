"""ObservationEventBuilder — assembles a protocol-valid event from context + call data.

Producers never construct the dict by hand; they supply the call's tokens/cost/latency and
the builder fills ids, derives ``attribution_status`` and ``prompt_hash``, and applies the
protocol defaults. The output satisfies ``protocol.validate``.
"""

from __future__ import annotations

import uuid
from typing import Any

from .context import ObservationContext
from .protocol import (
    PROTOCOL_VERSION,
    derive_attribution_status,
    prompt_hash as compute_prompt_hash,
)


class ObservationEventBuilder:
    """Builds one ObservationEvent from an attribution context and a model call."""

    def __init__(
        self,
        *,
        application_name: str | None = None,
        application_version: str | None = None,
        environment: str | None = None,
        tenant_id: str | None = None,
        sdk_name: str = "observation-sdk-python",
    ) -> None:
        # Producer-level defaults, overridable per call / by context.
        self._defaults = {
            "application_name": application_name,
            "application_version": application_version,
            "environment": environment,
            "tenant_id": tenant_id,
        }
        self._sdk_name = sdk_name

    def build(
        self,
        ctx: ObservationContext,
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
        timestamp: str,
        event_id: str | None = None,
        request_id: str | None = None,
        prompt_hash: str | None = None,
        tags: tuple[str, ...] | list[str] | None = None,
        correlation_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        raw: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        eid = event_id or uuid.uuid4().hex
        prompt = ctx.prompt
        agent = ctx.agent
        session_id = ctx.session_id

        meta: dict[str, Any] = {"priced": bool(priced), "protocol_version": PROTOCOL_VERSION, "sdk": self._sdk_name}
        if metadata:
            meta.update(metadata)

        merged_tags = tuple(ctx.tags) + tuple(tags or ())

        event: dict[str, Any] = {
            "event_id": eid,
            "timestamp": timestamp,
            "provider": provider,
            "model": model,
            "request_id": request_id or eid,
            "session_id": session_id,
            "conversation_id": ctx.conversation_id,
            "workflow_id": ctx.workflow_id,
            "agent": agent,
            "parent_agent": ctx.parent_agent,
            "prompt": prompt,
            "prompt_hash": prompt_hash or compute_prompt_hash(prompt),
            "prompt_version": ctx.prompt_version,
            "tool_name": ctx.tool_name,
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "total_tokens": int(total_tokens if total_tokens is not None else input_tokens + output_tokens),
            "latency_ms": float(latency_ms),
            "cost": cost,
            "currency": currency,
            "status": status,
            "attribution_status": derive_attribution_status(prompt, agent, session_id),
            # Operational metadata: context wins, else producer defaults.
            "environment": ctx.environment or self._defaults["environment"],
            "application_name": ctx.application_name or self._defaults["application_name"],
            "application_version": ctx.application_version or self._defaults["application_version"],
            "tenant_id": ctx.tenant_id or self._defaults["tenant_id"],
            "correlation_id": correlation_id or ctx.correlation_id,
            "tags": list(merged_tags),
            "metadata": meta,
            "raw": raw or {},
        }
        return event
