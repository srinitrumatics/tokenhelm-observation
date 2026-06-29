"""Cross-language conformance: the Python validator must agree with the shared
``protocol/conformance`` fixtures (the same cases the TypeScript SDK and the ``observe`` CLI
run). A divergence here means a producer would disagree with the protocol — a release-blocker.
"""

import json
import os

import pytest

from observation_sdk import ProtocolValidationError, validate

_REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
_CONFORMANCE = os.path.join(_REPO, "protocol", "conformance")


def _load_manifest() -> list[dict]:
    with open(os.path.join(_CONFORMANCE, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)["cases"]


def _load_case(rel: str) -> dict:
    with open(os.path.join(_CONFORMANCE, rel), encoding="utf-8") as f:
        return json.load(f)


_CASES = _load_manifest()


@pytest.mark.parametrize("case", _CASES, ids=[c["file"] for c in _CASES])
def test_conformance_case(case: dict) -> None:
    event = _load_case(case["file"])
    if case["valid"]:
        validate(event)  # must not raise
    else:
        with pytest.raises(ProtocolValidationError) as exc:
            validate(event)
        assert case["match"] in str(exc.value), (
            f"{case['file']}: expected '{case['match']}' in '{exc.value}'"
        )


def test_manifest_references_every_fixture() -> None:
    """No orphan fixtures: every file on disk is covered by the manifest, and vice-versa."""
    referenced = {c["file"].replace("\\", "/") for c in _CASES}
    on_disk = set()
    for sub in ("valid", "invalid"):
        for name in os.listdir(os.path.join(_CONFORMANCE, sub)):
            if name.endswith(".json"):
                on_disk.add(f"{sub}/{name}")
    assert on_disk == referenced
