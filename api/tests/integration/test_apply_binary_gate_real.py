"""Ticket 08: the real pinned binary gates apply end to end.

Opt-in by presence: when the pinned Windows binary (or AG_BINARY) is missing the
test skips, exactly like test_ag_validate. It covers the two outcomes the ticket
requires: an accepted config is written with its real on-disk sha256 recorded,
and a tampered config is rejected with displayable errors while the previous
file and marker keep serving.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest

from l02_domain.ir import (
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.agentgateway.binary_validate import DEFAULT_BINARY
from l03_adapters.spi import make_artifact

BINARY = os.environ.get("AG_BINARY") or DEFAULT_BINARY


def _require_binary() -> str:
    if not os.path.exists(BINARY):
        pytest.skip(f"agentgateway binary not installed at {BINARY}")
    return BINARY


def _ir(revision: str = "rev_gate") -> GatewayIR:
    return GatewayIR(
        revision=revision,
        upstreams=(
            UpstreamSpec(
                "ups_a", "https://api.example.com/v1", "openai_chat", "keys/ups_a.key"
            ),
        ),
        models=(UpstreamModelSpec("um_a", "ups_a", "glm-5.3", "chat"),),
        public_models=(PublicModelSpec("flagship", (TargetSpec("mt_a", "um_a", 0),)),),
        api_keys=(),
        users=(),
    )


def _adapter(tmp_path: Path) -> AgentgatewayAdapter:
    keys = tmp_path / "keys"
    keys.mkdir()
    (keys / "ups_a.key").write_text("sk-test-key\n", encoding="utf-8")
    return AgentgatewayAdapter(str(tmp_path), ag_binary=_require_binary())


def test_real_binary_accepts_config_then_rejects_tampered_one(tmp_path: Path) -> None:
    adapter = _adapter(tmp_path)
    artifact = adapter.render(_ir())

    accepted = adapter.apply(artifact)
    assert accepted.ok, accepted.message + " | " + " | ".join(accepted.errors)
    assert "valid" in accepted.validation_note.lower()
    on_disk = (tmp_path / "config.yaml").read_bytes()
    assert accepted.file_hash == hashlib.sha256(on_disk).hexdigest()
    assert adapter.status().config_hash == artifact.hash

    tampered = make_artifact(
        artifact.content.replace("llm:\n", "llm:\n  bogusField: 1\n", 1),
        revision="rev_bad",
    )
    before = (tmp_path / "config.yaml").read_bytes()
    rejected = adapter.apply(tampered)
    assert rejected.ok is False
    assert rejected.rolled_back is False
    errors = " | ".join(rejected.errors)
    assert "bogusField" in errors or "unknown field" in errors, errors
    assert (tmp_path / "config.yaml").read_bytes() == before
    assert adapter.status().config_hash == artifact.hash
    assert (tmp_path / "config.yaml.hash").read_text(encoding="utf-8").strip() == artifact.hash
