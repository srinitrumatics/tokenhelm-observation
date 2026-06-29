"""Observation SDK for Python — produce canonical ObservationEvents.

A standalone, dependency-free producer SDK that implements **Observation Protocol v1**
(see ``docs/adr/0002-observation-protocol-v1.md``). It depends only on the protocol — never
on the dashboard, analytics, or storage — keeping the dependency direction clean:

    Application → Observation SDK → Observation Protocol → ObservationEvent → Transport → Platform

Quick start::

    from observation_sdk import ObservationClient, JsonlTransport

    client = ObservationClient(JsonlTransport("usage_log.jsonl"),
                               application_name="my-app", environment="production")
    with client.session("sess-1"), client.workflow("research"):
        with client.agent("coordinator"), client.prompt("route"):
            client.record_llm_call(provider="gemini", model="gemini-3-flash-preview",
                                   input_tokens=320, output_tokens=60, cost="0.0010")
    client.close()
"""

from __future__ import annotations

from .builder import ObservationEventBuilder
from .client import ObservationClient
from .context import ObservationContext, current_context, push
from .emitter import ObservationEmitter
from .protocol import (
    ATTRIBUTION_STATUSES,
    EVENT_STATUSES,
    PROTOCOL_VERSION,
    ProtocolValidationError,
    UNKNOWN,
    derive_attribution_status,
    is_valid,
    prompt_hash,
    validate,
)
from .transport import HttpTransport, InMemoryTransport, JsonlTransport, Transport

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "PROTOCOL_VERSION",
    # Core API
    "ObservationClient",
    "ObservationContext",
    "ObservationEventBuilder",
    "ObservationEmitter",
    # Transports
    "Transport",
    "JsonlTransport",
    "InMemoryTransport",
    "HttpTransport",
    # Protocol
    "validate",
    "is_valid",
    "ProtocolValidationError",
    "derive_attribution_status",
    "prompt_hash",
    "UNKNOWN",
    "EVENT_STATUSES",
    "ATTRIBUTION_STATUSES",
    # Context helpers
    "current_context",
    "push",
]
