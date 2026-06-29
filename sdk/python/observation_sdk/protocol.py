"""Observation Protocol v1 — the language-neutral ObservationEvent contract.

This is the Python expression of the protocol defined in
``docs/adr/0002-observation-protocol-v1.md``. It is dependency-free (stdlib only) so the
SDK stays light and embeddable. Producers build events that satisfy ``validate()``;
consumers (the platform) read the same shape.

The SDK depends ONLY on this protocol — never on the dashboard, analytics, or storage.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Iterable

PROTOCOL_VERSION = "1.0"

# Sentinel used when an attribution dimension is absent (matches the platform).
UNKNOWN = "unknown"

EVENT_STATUSES = ("success", "error")
ATTRIBUTION_STATUSES = ("complete", "partial", "missing")

# Required fields a valid v1 event MUST carry (mirrors the canonical schema).
REQUIRED_FIELDS = (
    "event_id",
    "timestamp",
    "provider",
    "model",
    "request_id",
    "session_id",
    "agent",
    "prompt",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "latency_ms",
    "cost",
    "currency",
    "status",
    "attribution_status",
)

# Optional fields and their documented defaults (absent ⇒ default).
OPTIONAL_DEFAULTS: dict[str, Any] = {
    "conversation_id": None,
    "workflow_id": None,
    "parent_agent": None,
    "prompt_hash": None,
    "prompt_version": None,
    "tool_name": None,
    "environment": None,
    "application_name": None,
    "application_version": None,
    "tenant_id": None,
    "correlation_id": None,
    "tags": (),
    "metadata": None,  # filled to a dict by the builder
    "raw": None,
}

_COST_RE = re.compile(r"^[0-9]+(\.[0-9]+)?$")


class ProtocolValidationError(ValueError):
    """Raised when an event does not satisfy Observation Protocol v1."""


def present(value: Any) -> bool:
    """A dimension is 'present' if it is a non-empty, non-sentinel string."""
    return isinstance(value, str) and value != "" and value != UNKNOWN


def derive_attribution_status(prompt: Any, agent: Any, session: Any) -> str:
    """complete = prompt+agent+session all present; missing = none; partial = some.

    The same deterministic rule the platform applies, so an emitted value always agrees
    with field presence.
    """
    count = sum(1 for v in (prompt, agent, session) if present(v))
    if count == 3:
        return "complete"
    if count == 0:
        return "missing"
    return "partial"


def prompt_hash(prompt: Any) -> str | None:
    """Stable short hash of the prompt scope (groups identical prompts)."""
    if not present(prompt):
        return None
    return "ph_" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]


def _is_nonneg_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def validate(event: dict[str, Any]) -> dict[str, Any]:
    """Validate an event against Observation Protocol v1.

    Returns the event unchanged on success; raises :class:`ProtocolValidationError`
    otherwise. Called by the emitter before transport, so an invalid event never leaves
    a producer.
    """
    errors: list[str] = []

    for field in REQUIRED_FIELDS:
        if field not in event:
            errors.append(f"missing required field '{field}'")

    # Non-empty strings.
    for field in ("event_id", "provider", "model", "request_id", "session_id", "agent", "prompt", "currency"):
        v = event.get(field)
        if field in event and not (isinstance(v, str) and v != ""):
            errors.append(f"'{field}' must be a non-empty string")

    # Timestamp must be a string (ISO-8601; parseability is the consumer's tolerant concern).
    if "timestamp" in event and not isinstance(event["timestamp"], str):
        errors.append("'timestamp' must be an ISO-8601 string")

    # Token counts.
    for field in ("input_tokens", "output_tokens", "total_tokens"):
        if field in event and not _is_nonneg_int(event[field]):
            errors.append(f"'{field}' must be an integer >= 0")

    # Latency.
    lat = event.get("latency_ms")
    if "latency_ms" in event and not (isinstance(lat, (int, float)) and not isinstance(lat, bool) and lat >= 0):
        errors.append("'latency_ms' must be a number >= 0")

    # Cost is a decimal STRING (never a float).
    cost = event.get("cost")
    if "cost" in event and not (isinstance(cost, str) and _COST_RE.match(cost)):
        errors.append("'cost' must be a decimal string matching ^[0-9]+(\\.[0-9]+)?$")

    # Enums.
    if event.get("status") not in EVENT_STATUSES and "status" in event:
        errors.append(f"'status' must be one of {EVENT_STATUSES}")
    if event.get("attribution_status") not in ATTRIBUTION_STATUSES and "attribution_status" in event:
        errors.append(f"'attribution_status' must be one of {ATTRIBUTION_STATUSES}")

    # Attribution must be consistent with the actual presence of the dimensions.
    if "attribution_status" in event:
        expected = derive_attribution_status(event.get("prompt"), event.get("agent"), event.get("session_id"))
        if event["attribution_status"] != expected:
            errors.append(
                f"'attribution_status' is '{event['attribution_status']}' but presence implies '{expected}'"
            )

    # metadata.priced must be present and boolean (the money rule).
    meta = event.get("metadata")
    if not isinstance(meta, dict) or not isinstance(meta.get("priced"), bool):
        errors.append("'metadata.priced' must be a boolean")

    # tags must be a list of strings when present.
    tags = event.get("tags")
    if tags is not None and not (isinstance(tags, (list, tuple)) and all(isinstance(t, str) for t in tags)):
        errors.append("'tags' must be a list of strings")

    if errors:
        raise ProtocolValidationError("; ".join(errors))
    return event


def is_valid(event: dict[str, Any]) -> bool:
    """Boolean form of :func:`validate`."""
    try:
        validate(event)
        return True
    except ProtocolValidationError:
        return False


def validate_all(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate a batch, raising on the first invalid event."""
    return [validate(e) for e in events]
