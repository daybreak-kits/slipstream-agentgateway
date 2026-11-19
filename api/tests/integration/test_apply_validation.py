"""S3 + M4: the apply flow runs the SPI validate first, and the IR carries blocks.

S3: a driver that rejects the IR must stop the rollout before any file is written
(no key files, no artifact, no archived revision). M4: policies/guardrails/mcp
travel inside the IR, and the render path never fakes MCP support.
"""

from __future__ import annotations

import pytest

from l01_core.errors import AppError
from l02_domain.ir import (
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.spi import AdapterInfo, ApplyResult, Artifact, DataPlaneStatus, ValidationResult
from l05_service import rendering
from l05_service.policies import build_policy_blocks
from l05_service.rollout import Rollout


class _FailingAdapter:
    """SPI stub: validate() refuses the IR, every later method must stay unused."""

    def __init__(self) -> None:
        self.applied = 0

    def describe(self) -> AdapterInfo:
        return AdapterInfo(adapter_id="stub", version="test")

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return ValidationResult(ok=False, errors=("stub says no",))

    def render(self, ir: GatewayIR) -> Artifact:  # pragma: no cover - must not run
        raise AssertionError("render must not run when validate fails")

    def apply(self, artifact: Artifact) -> ApplyResult:  # pragma: no cover
        self.applied += 1
        raise AssertionError("apply must not run when validate fails")

    def status(self) -> DataPlaneStatus:  # pragma: no cover
        return DataPlaneStatus(config_hash=None)

    def usage(self, cursor):  # pragma: no cover
        raise AssertionError("unused")

    def health(self):  # pragma: no cover
        raise AssertionError("unused")

    def rollback(self, revision_id: str):  # pragma: no cover
        raise AssertionError("unused")


def _renderable_ir() -> GatewayIR:
    return GatewayIR(
        revision="rev_stub",
        upstreams=(UpstreamSpec("ups_1", "https://x.example/v1", "openai_chat", "k"),),
        models=(UpstreamModelSpec("umdl_1", "ups_1", "m", "chat"),),
        public_models=(
            PublicModelSpec("stub-model", (TargetSpec("tgt_1", "umdl_1", 0),)),
        ),
        api_keys=(),
    )


def test_apply_stops_before_render_when_adapter_validate_fails(
    monkeypatch, engine_and_sessionmaker
):
    _, factory = engine_and_sessionmaker
    adapter = _FailingAdapter()
    monkeypatch.setattr(rendering, "build_render_plan", lambda *a, **k: (_renderable_ir(), {}))
    with factory() as session:
        with pytest.raises(AppError) as excinfo:
            Rollout(session, adapter).apply("tester", reason="s3-test")
    assert "适配器校验" in excinfo.value.message
    assert excinfo.value.details["errors"] == ["stub says no"]
    assert adapter.applied == 0


def test_policy_blocks_are_typed_and_never_fake_mcp():
    policies, guardrails, mcp = build_policy_blocks()
    assert policies.cors.allow_origins  # dev origins are always present
    assert policies.transforms_defaults.default_response_header_deletes == (
        "server",
        "x-powered-by",
    )
    # W1: no implicit response-body condition is part of the default policy.
    assert policies.transforms_defaults.default_response_body_condition == ""
    assert "model/stream" in policies.transforms_defaults.body_editable_paths
    assert mcp.supported is False and mcp.servers == () and mcp.note
    assert guardrails.items == ()  # no driver injected


def test_guardrails_follow_the_adapter_capabilities():
    _, guardrails, _ = build_policy_blocks(AgentgatewayAdapter("unused-config-dir"))
    assert guardrails.adapter == "agentgateway"
    assert any(item.key == "routing.priority_failover" for item in guardrails.items)
    assert any(item.key == "mcp.targets" and item.supported for item in guardrails.items)
    # M3 (ADR-024): retry/health reopen with the management surface; the matrix
    # records how they render (route-level retry, per-model health).
    assert any(item.key == "policies.retry" and item.supported for item in guardrails.items)
    assert any(item.key == "policies.health" and item.supported for item in guardrails.items)
    assert all(isinstance(item.verified, bool) for item in guardrails.items)


def test_mcp_support_comes_from_the_adapter_capability_matrix():
    _, _, block = build_policy_blocks(AgentgatewayAdapter("unused-config-dir"))
    assert block.supported is True
    assert block.targets == ()
    assert "1.7" in block.note


def test_render_never_emits_unsupported_blocks():
    from l03_adapters.agentgateway.render import render_config

    rendered = render_config(_renderable_ir(), llm_port=3600)
    assert "mcp" not in rendered["llm"]
    assert "guardrails" not in rendered["llm"]
