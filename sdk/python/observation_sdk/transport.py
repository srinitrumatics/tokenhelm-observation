"""Transport abstraction — how emitted events leave the producer.

The SDK emits through a ``Transport`` rather than writing to storage directly, so it stays
independent of the platform's storage layer while remaining compatible with the EventSource
architecture (the JSONL transport writes exactly the append-only format an EventSource reads).
"""

from __future__ import annotations

import json
import threading
from abc import ABC, abstractmethod
from typing import Any


class Transport(ABC):
    """Sink for protocol-valid ObservationEvents."""

    @abstractmethod
    def emit(self, event: dict[str, Any]) -> None:
        """Send one event. Implementations MUST NOT mutate the event."""

    def flush(self) -> None:  # pragma: no cover - default no-op
        """Flush any buffered events."""

    def close(self) -> None:  # pragma: no cover - default no-op
        """Release resources."""

    def __enter__(self) -> "Transport":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


class InMemoryTransport(Transport):
    """Collects events in a list — for tests and in-process inspection."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            self.events.append(dict(event))


class JsonlTransport(Transport):
    """Appends one JSON line per event — the format an EventSource reads (usage_log.jsonl).

    Append-only by default (mode='a'); pass mode='w' to truncate (e.g. when regenerating a
    fixture). The producer never reads the file back — that is the platform's job.
    """

    def __init__(self, path: str, *, mode: str = "a", encoding: str = "utf-8") -> None:
        if mode not in ("a", "w"):
            raise ValueError("mode must be 'a' (append) or 'w' (truncate)")
        self._path = path
        self._encoding = encoding
        self._lock = threading.Lock()
        # Open once; flush per write so a crash never loses an acknowledged event.
        self._stream = open(path, mode, encoding=encoding)

    def emit(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, separators=(",", ":"), ensure_ascii=False)
        with self._lock:
            self._stream.write(line)
            self._stream.write("\n")
            self._stream.flush()

    def flush(self) -> None:
        with self._lock:
            self._stream.flush()

    def close(self) -> None:
        with self._lock:
            if not self._stream.closed:
                self._stream.flush()
                self._stream.close()


class HttpTransport(Transport):
    """EXPERIMENTAL (v1.1+): POST events to a collector endpoint.

    Stdlib-only batching POST. Provided as the forward-looking transport from ADR 0002; not
    exercised by the offline test suite. Use a real HTTP client in production deployments.
    """

    def __init__(self, url: str, *, batch_size: int = 50, timeout: float = 5.0) -> None:
        self._url = url
        self._batch_size = batch_size
        self._timeout = timeout
        self._buffer: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._buffer.append(dict(event))
            if len(self._buffer) >= self._batch_size:
                self._send_locked()

    def flush(self) -> None:
        with self._lock:
            self._send_locked()

    def close(self) -> None:
        self.flush()

    def _send_locked(self) -> None:  # pragma: no cover - network
        if not self._buffer:
            return
        import urllib.request

        payload = json.dumps({"events": self._buffer}).encode("utf-8")
        req = urllib.request.Request(
            self._url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        urllib.request.urlopen(req, timeout=self._timeout).close()
        self._buffer.clear()
