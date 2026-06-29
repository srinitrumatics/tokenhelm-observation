"""ObservationEmitter — validates every event against the protocol, then transports it.

This is the gate ADR 0002 requires: an invalid event never leaves the producer. The emitter
knows nothing about analytics or storage — only the protocol and a transport.
"""

from __future__ import annotations

from typing import Any

from .protocol import validate
from .transport import Transport


class ObservationEmitter:
    """Protocol-validate-then-transport pipeline."""

    def __init__(self, transport: Transport, *, validate_events: bool = True) -> None:
        self._transport = transport
        self._validate = validate_events

    def emit(self, event: dict[str, Any]) -> dict[str, Any]:
        if self._validate:
            validate(event)  # raises ProtocolValidationError on a bad event
        self._transport.emit(event)
        return event

    def flush(self) -> None:
        self._transport.flush()

    def close(self) -> None:
        self._transport.close()
