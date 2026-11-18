"""IR v2: priority semantics (AG numeric small first) and policy surface."""

from __future__ import annotations

from l02_domain.ir import (
    GatewayIR,
    McpSpec,
    McpTargetSpec,
    ModelAliasSpec,
    PoliciesSpec,
    PublicModelSpec,
    RetryPolicySpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    legacy_priority_to_v2,
    sort_targets,
)
from l02_domain.validation import validate_gateway_ir


def _ir(**kwargs) -> GatewayIR:
    base = dict(
        revision="r1",
        upstreams=(
            UpstreamSpec(
                id="ups",
                base_url="https://example.com",
                api_style="openai_chat",
                key_file="keys/ups.key",
            ),
        ),
        models=(
            UpstreamModelSpec(
                id="m1", upstream_id="ups", upstream_model_name="glm-5.3", model_type="chat"
            ),
        ),
        public_models=(
            PublicModelSpec(
                name="pub", targets=(TargetSpec(id="t1", upstream_model_id="m1", priority=0),)
            ),
        ),
        api_keys=(),
    )
    base.update(kwargs)
    return GatewayIR(**base)


def test_priority_zero_is_valid_and_negative_is_rejected():
    ok = validate_gateway_ir(_ir())
    assert ok.ok, ok.errors
    bad = _ir(
        public_models=(
            PublicModelSpec(
                name="pub", targets=(TargetSpec(id="t1", upstream_model_id="m1", priority=-1),)
            ),
        )
    )
    result = validate_gateway_ir(bad)
    assert not result.ok
    assert "priority 必须为 >= 0 的整数" in result.errors[0]


def test_priority_bool_is_rejected():
    bad = _ir(
        public_models=(
            PublicModelSpec(
                name="pub", targets=(TargetSpec(id="t1", upstream_model_id="m1", priority=True),)
            ),
        )
    )
    result = validate_gateway_ir(bad)
    assert not result.ok
    assert "priority 必须为 >= 0 的整数" in result.errors[0]


def test_legacy_priority_migration_is_explicit():
    # Old control plane used "bigger = better"; v2 uses AG's smaller-first.
    assert legacy_priority_to_v2(1, 10) == 9
    assert legacy_priority_to_v2(10, 10) == 0


def test_sort_targets_is_stable_inside_a_priority_group():
    targets = (
        TargetSpec(id="a", upstream_model_id="m1", priority=10),
        TargetSpec(id="b", upstream_model_id="m1", priority=0),
        TargetSpec(id="c", upstream_model_id="m1", priority=10),
        TargetSpec(id="d", upstream_model_id="m1", priority=0),
    )
    assert [t.id for t in sort_targets(targets)] == ["b", "d", "a", "c"]


def test_visibility_must_be_known():
    bad = _ir(
        models=(
            UpstreamModelSpec(
                id="m1",
                upstream_id="ups",
                upstream_model_name="x",
                model_type="chat",
                visibility="secret",
            ),
        )
    )
    result = validate_gateway_ir(bad)
    assert not result.ok
    assert "visibility" in result.errors[0]


def test_user_balances_warn_they_are_control_plane_only():
    from l02_domain.ir import UserBalanceSpec

    result = validate_gateway_ir(_ir(users=(UserBalanceSpec(id="usr", balance_tokens=10),)))
    assert result.ok
    assert any("余额" in w for w in result.warnings)


def test_mcp_targets_require_declared_support():
    ir = _ir(
        mcp=McpSpec(
            targets=(McpTargetSpec(name="fs", transport="sse", host="https://example.com"),)
        )
    )
    result = validate_gateway_ir(ir)
    assert not result.ok
    assert "MCP" in result.errors[0]


def test_retry_policy_is_part_of_v2_ir_but_adapter_may_reject():
    retry = RetryPolicySpec(attempts=2, backoff="100ms", codes=(502, 503))
    ir = _ir(policies=PoliciesSpec(retry=retry))
    assert ir.policies.retry is not None


def test_model_aliases_are_expressible_so_unsupported_adapters_can_error():
    ir = _ir(model_aliases=(ModelAliasSpec(alias="legacy", target_model_id="m1"),))
    assert ir.model_aliases[0].alias == "legacy"
