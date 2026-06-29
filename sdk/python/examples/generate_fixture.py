"""Generate the SDK-emitted fixture the platform's cross-stack test consumes.

Writes the research-pipeline scenario (see scenario.py) to
``frontend/lib/__tests__/fixtures/sdk-emitted-events.jsonl`` via the JSONL transport — the
same append-only format an EventSource reads. The platform test
``frontend/lib/__tests__/sdk-events.test.ts`` then proves identical analytics.

    python examples/generate_fixture.py [output_path]
"""

from __future__ import annotations

import os
import sys

# Make the SDK importable when run directly from sdk/python/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from observation_sdk import JsonlTransport, ObservationClient  # noqa: E402
from examples.scenario import emit_scenario  # noqa: E402

_DEFAULT_OUT = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "..", "..",
        "frontend", "lib", "__tests__", "fixtures", "sdk-emitted-events.jsonl",
    )
)


def write_fixture(out_path: str) -> int:
    """Write the scenario to ``out_path`` (mode='w', deterministic). Returns event count."""
    client = ObservationClient(
        JsonlTransport(out_path, mode="w"),
        application_name="research-pipeline-demo",
        environment="demo",
    )
    try:
        events = emit_scenario(client)
    finally:
        client.close()
    return len(events)


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else _DEFAULT_OUT
    n = write_fixture(out_path)
    print(f"Wrote {n} SDK-emitted ObservationEvents to {out_path}")


if __name__ == "__main__":
    main()
