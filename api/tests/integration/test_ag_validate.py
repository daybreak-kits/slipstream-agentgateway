"""Real AG 1.7 binary validation for representative rendered configs.

Skipped (with a message) when the pinned binary is not installed; the CI gate
still exercises the renderer and golden fixture. Set AG_BINARY to override the
default install path; set AG_BINARY to override.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from l03_adapters.agentgateway.ca_bundle import ensure_ca_bundle

FIXTURE = Path(__file__).parents[1] / "contract" / "fixtures" / "ag_1_7_full_config.yaml"


def _find_binary() -> str | None:
    override = os.environ.get("AG_BINARY")
    if override:
        return override if Path(override).exists() else None
    return shutil.which("agentgateway")


def _run_validate(config_text: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    binary = _find_binary()
    if not binary:
        pytest.skip(
            "agentgateway binary not found; set AG_BINARY to run the "
            "1.7 --validate-only integration"
        )
    (tmp_path / "keys").mkdir()
    for key_file in ("ups_a.key", "ups_b.key"):
        (tmp_path / "keys" / key_file).write_text("test-key\n", encoding="utf-8")
    ensure_ca_bundle(str(tmp_path))
    (tmp_path / "config.yaml").write_text(config_text, encoding="utf-8")
    return subprocess.run(
        [binary, "--validate-only", "-f", "config.yaml"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )


def test_representative_config_passes_ag_1_7_validate_only(tmp_path: Path) -> None:
    result = _run_validate(FIXTURE.read_text(encoding="utf-8"), tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "valid" in (result.stdout + result.stderr).lower()


def test_ticket11_policies_guardrails_and_mcp_pass_validate_only(tmp_path: Path) -> None:
    """The editable surfaces render to shapes the pinned 1.7 binary accepts."""
    from l02_domain.ir import (
        ApiKeyPolicySpec,
        CorsPolicySpec,
        GatewayIR,
        GuardSpec,
        McpSpec,
        McpTargetSpec,
        PoliciesSpec,
        PromptGuardSpec,
        PublicModelSpec,
        RegexRuleSpec,
        TargetSpec,
        TimeoutPolicySpec,
        UpstreamModelSpec,
        UpstreamSpec,
    )
    from l03_adapters.agentgateway.adapter import AgentgatewayAdapter

    binary = _find_binary()
    if not binary:
        pytest.skip("agentgateway binary not found; set AG_BINARY to run the 1.7 validate test")
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "ups_a.key").write_text("test-key\n", encoding="utf-8")
    ir = GatewayIR(
        revision="rev_t11",
        upstreams=(
            UpstreamSpec("ups_a", "https://api.example.com/v1", "openai_chat", "keys/ups_a.key"),
        ),
        models=(UpstreamModelSpec("um_a", "ups_a", "glm-5.3", "chat"),),
        public_models=(PublicModelSpec("flagship", (TargetSpec("mt_a", "um_a", 0),)),),
        api_keys=(),
        users=(),
        policies=PoliciesSpec(
            api_key=ApiKeyPolicySpec(enabled=False),
            data_plane_cors=CorsPolicySpec(allow_origins=("https://app.example",)),
            timeout=TimeoutPolicySpec("60s", "55s", "30s"),
            guardrails=PromptGuardSpec(
                request=(
                    GuardSpec(
                        action="mask",
                        rules=(RegexRuleSpec(builtin="ssn"),),
                        scope=("messages",),
                    ),
                ),
                response=(
                    GuardSpec(
                        kind="webhook",
                        action="reject",
                        webhook_target="https://audit.example",
                        failure_mode="failOpen",
                    ),
                ),
            ),
        ),
        mcp=McpSpec(
            supported=True,
            targets=(
                McpTargetSpec(name="files", transport="stdio", cmd="npx", args=("server-fs",)),
                McpTargetSpec(name="remote", transport="sse", host="https://mcp.example"),
            ),
        ),
    )
    adapter = AgentgatewayAdapter(str(tmp_path), ag_binary=binary)
    result = adapter.apply(adapter.render(ir))
    assert result.ok, result.message + " | " + " | ".join(result.errors)
    assert "valid" in result.validation_note.lower()


def test_ag_1_7_rejects_llm_policies_retry(tmp_path: Path) -> None:
    """Capability-matrix evidence: retry is rejected at llm.policies in 1.7."""
    config = FIXTURE.read_text(encoding="utf-8").replace(
        "  policies:\n    apiKey:",
        "  policies:\n    retry:\n      attempts: 2\n    apiKey:",
        1,
    )
    result = _run_validate(config, tmp_path)
    assert result.returncode != 0
    assert "retry" in (result.stdout + result.stderr)
