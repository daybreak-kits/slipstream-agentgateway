"""AG 1.7 renderer v2: array shapes, priority groups, policies, MCP, capability errors."""

from __future__ import annotations

import pytest

from l02_domain.ir import (
    ApiKeyPolicySpec,
    BodyRule,
    ClientKeySpec,
    CorsPolicySpec,
    GatewayIR,
    GuardSpec,
    HealthPolicySpec,
    LimitsSpec,
    McpPolicySpec,
    McpSpec,
    McpTargetSpec,
    ModelAliasSpec,
    PoliciesSpec,
    PromptCachingSpec,
    PromptGuardSpec,
    PublicModelSpec,
    RegexRuleSpec,
    RemoteRateLimitPolicySpec,
    RetryPolicySpec,
    TargetSpec,
    TimeoutPolicySpec,
    TransformsSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    UserBalanceSpec,
)
from l02_domain.validation import validate_gateway_ir
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.agentgateway.render import render_config


def _ir(**kwargs) -> GatewayIR:
    base = dict(
        revision="r1",
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
                extra_headers=(("x-team", "slip"),),
            ),
        ),
        models=(
            UpstreamModelSpec(
                id="m1", upstream_id="ups_a", upstream_model_name="glm-5.3", model_type="chat"
            ),
            UpstreamModelSpec(
                id="m2", upstream_id="ups_a", upstream_model_name="glm-4.6", model_type="chat"
            ),
        ),
        public_models=(
            PublicModelSpec(
                name="flagship",
                targets=(
                    TargetSpec(id="t1", upstream_model_id="m1", priority=10),
                    TargetSpec(id="t2", upstream_model_id="m2", priority=0),
                    TargetSpec(id="t3", upstream_model_id="m1", priority=10),
                ),
            ),
        ),
        api_keys=(ClientKeySpec(id="key_a", key_hash="sha256:" + "a" * 64, user_id="usr_a"),),
        limits=LimitsSpec(requests_per_minute=60, tokens_per_minute=5000),
    )
    base.update(kwargs)
    return GatewayIR(**base)


def test_providers_and_models_are_yaml_arrays_with_ag_names():
    cfg = render_config(_ir(), 3600)
    llm = cfg["llm"]
    # ADR-024 M2: the deprecated llm.port moves to the full-form gateway shape.
    assert cfg["gateways"] == {"default": {"port": 3600}}
    assert llm["gateways"] == "default"
    assert "port" not in llm
    assert isinstance(llm["providers"], list) and llm["providers"][0]["name"] == "ups_a"
    provider = llm["providers"][0]
    assert provider["provider"] == "openai"
    assert provider["params"] == {
        "baseUrl": "https://api.example.com/v1",
        "apiKey": {"file": "keys/ups_a.key"},
    }
    assert provider["defaults"]["requestHeaders"]["set"] == {"x-team": "slip"}
    assert "maxBufferSize" not in provider
    names = [m["name"] for m in llm["models"]]
    assert names == ["m1", "m2"]
    first = llm["models"][0]
    assert first["provider"] == {"reference": "ups_a"}
    assert first["visibility"] == "internal"
    assert first["params"] == {"model": "glm-5.3"}


def test_failover_priority_is_small_first_and_stable_in_group():
    cfg = render_config(_ir(), 3600)
    routing = cfg["llm"]["virtualModels"][0]["routing"]["failover"]
    assert routing["targets"] == [
        {"model": "m2", "priority": 0},
        {"model": "m1", "priority": 10},
        {"model": "m1", "priority": 10},
    ]


def test_weighted_keeps_ir_order_and_only_weight():
    ir = _ir(
        public_models=(
            PublicModelSpec(
                name="flagship",
                routing_mode="weighted",
                targets=(
                    TargetSpec(id="t1", upstream_model_id="m1", priority=0, weight=3),
                    TargetSpec(id="t2", upstream_model_id="m2", priority=0, weight=1),
                ),
            ),
        )
    )
    routing = render_config(ir, 3600)["llm"]["virtualModels"][0]["routing"]["weighted"]
    assert routing["targets"] == [{"model": "m1", "weight": 3}, {"model": "m2", "weight": 1}]
    assert all("priority" not in t for t in routing["targets"])


def test_conditional_keeps_order_and_omits_empty_last_when():
    ir = _ir(
        public_models=(
            PublicModelSpec(
                name="flagship",
                routing_mode="conditional",
                targets=(
                    TargetSpec(
                        id="t1",
                        upstream_model_id="m1",
                        priority=0,
                        when='request.model == "glm-5.3"',
                    ),
                    TargetSpec(id="t2", upstream_model_id="m2", priority=0),
                ),
            ),
        )
    )
    routing = render_config(ir, 3600)["llm"]["virtualModels"][0]["routing"]["conditional"]
    assert routing["targets"] == [
        {"model": "m1", "when": 'request.model == "glm-5.3"'},
        {"model": "m2"},
    ]


def test_api_keys_are_hashed_with_strict_mode():
    cfg = render_config(_ir(), 3600)
    policy = cfg["llm"]["policies"]["apiKey"]
    assert policy["mode"] == "strict"
    assert policy["keys"] == [
        {
            "keyHash": "sha256:" + "a" * 64,
            "metadata": {"name": "key_a", "key_id": "key_a", "user_id": "usr_a"},
        }
    ]
    assert "key_a" not in cfg["llm"]["policies"]["apiKey"]["keys"][0]


def test_limits_render_as_rate_limit_array_with_fill_interval():
    entries = render_config(_ir(), 3600)["llm"]["policies"]["localRateLimit"]
    assert isinstance(entries, list)
    requests = [e for e in entries if e["type"] == "requests"]
    tokens = [e for e in entries if e["type"] == "tokens"]
    assert requests[0]["maxTokens"] == 60 and requests[0]["fillInterval"] == "1m"
    assert tokens[0]["maxTokens"] == 5000
    assert all(e["key"] == "apiKey.metadata.user_id" for e in entries)


def test_per_user_balances_are_never_faked_as_buckets():
    ir = _ir(limits=None, users=(UserBalanceSpec(id="usr_a", balance_tokens=777),))
    cfg = render_config(ir, 3600)
    assert "localRateLimit" not in cfg["llm"]["policies"]
    result = validate_gateway_ir(ir)
    assert result.ok and result.warnings


def test_guardrails_render_at_policy_and_model_scope():
    guard = PromptGuardSpec(
        streaming="Disabled",
        request=(
            GuardSpec(
                action="mask", rules=(RegexRuleSpec(pattern="secret-[0-9]+"),), scope=("messages",)
            ),
        ),
        response=(
            GuardSpec(
                action="reject",
                rules=(RegexRuleSpec(builtin="email"),),
                scope=("toolOutput",),
                rejection_status=451,
                rejection_body="blocked",
            ),
        ),
    )
    model_guard = PromptGuardSpec(
        request=(
            GuardSpec(action="audit", rules=(RegexRuleSpec(pattern="x"),), scope=("messages",)),
        )
    )
    ir = _ir(
        policies=PoliciesSpec(guardrails=guard),
        models=(
            UpstreamModelSpec(
                id="m1",
                upstream_id="ups_a",
                upstream_model_name="glm-5.3",
                model_type="chat",
                guardrails=model_guard,
            ),
            UpstreamModelSpec(
                id="m2", upstream_id="ups_a", upstream_model_name="glm-4.6", model_type="chat"
            ),
        ),
    )
    cfg = render_config(ir, 3600)
    assert cfg["llm"]["policies"]["guardrails"]["request"][0] == {
        "regex": {"action": "mask", "rules": [{"pattern": "secret-[0-9]+"}]},
        "scope": ["messages"],
    }
    assert cfg["llm"]["policies"]["guardrails"]["response"][0]["rejection"] == {
        "body": "blocked",
        "status": 451,
    }
    assert cfg["llm"]["models"][0]["guardrails"]["request"][0]["regex"]["action"] == "audit"


def test_timeout_cors_and_prompt_caching_render():
    ir = _ir(
        policies=PoliciesSpec(
            timeout=TimeoutPolicySpec(request_timeout="60s", backend_request_timeout="30s"),
            data_plane_cors=CorsPolicySpec(
                allow_origins=("https://app.example.com",),
                allow_credentials=True,
                allow_methods=("POST",),
                allow_headers=("authorization",),
                expose_headers=("x-request-id",),
                max_age=600,
            ),
        ),
        models=(
            UpstreamModelSpec(
                id="m1",
                upstream_id="ups_a",
                upstream_model_name="glm-5.3",
                model_type="chat",
                prompt_caching=PromptCachingSpec(
                    cache_system=True, cache_messages=True, min_tokens=1024
                ),
            ),
            UpstreamModelSpec(
                id="m2", upstream_id="ups_a", upstream_model_name="glm-4.6", model_type="chat"
            ),
        ),
    )
    cfg = render_config(ir, 3600)
    assert cfg["llm"]["policies"]["timeout"] == {
        "requestTimeout": "60s",
        "backendRequestTimeout": "30s",
    }
    assert cfg["llm"]["policies"]["cors"] == {
        "allowOrigins": ["https://app.example.com"],
        "allowCredentials": True,
        "allowMethods": ["POST"],
        "allowHeaders": ["authorization"],
        "exposeHeaders": ["x-request-id"],
        "maxAge": "600s",
    }
    assert cfg["llm"]["models"][0]["promptCaching"] == {
        "cacheSystem": True,
        "cacheMessages": True,
        "minTokens": 1024,
    }
    assert "promptCaching" not in cfg["llm"]["models"][1]


def test_mcp_targets_render_top_level_and_policies():
    ir = _ir(
        mcp=McpSpec(
            supported=True,
            targets=(
                McpTargetSpec(name="files", transport="sse", host="https://mcp.example.com"),
            ),
            policies=McpPolicySpec(cors=CorsPolicySpec(allow_origins=("https://app.example.com",))),
        )
    )
    cfg = render_config(ir, 3600)
    assert cfg["mcp"]["targets"] == [
        {"name": "files", "sse": {"host": "https://mcp.example.com"}}
    ]
    assert cfg["mcp"]["policies"]["cors"]["allowOrigins"] == ["https://app.example.com"]
    assert "mcp" not in cfg["llm"]


def test_mcp_without_declared_support_is_an_explicit_error_and_not_rendered():
    ir = _ir(
        mcp=McpSpec(
            targets=(
                McpTargetSpec(name="files", transport="sse", host="https://mcp.example.com"),
            )
        )
    )
    with pytest.raises(ValueError, match="MCP"):
        render_config(ir, 3600)


def test_global_transformations_can_carry_conditional_rows():
    from l02_domain.ir import HeaderRule, RewriteCondition

    spec = TransformsSpec(
        request_headers=(
            HeaderRule(
                op="update",
                name="x-a",
                value="1",
                conditions=(RewriteCondition(field="x-b", mode="full", value="on"),),
            ),
        )
    )
    cfg = render_config(_ir(policies=PoliciesSpec(global_transformations=spec)), 3600)
    transformations = cfg["llm"]["policies"]["transformations"]
    assert transformations["conditional"][0]["predicate"] == 'request.headers["x-b"] == "on"'
    assert "response" not in transformations
    assert cfg["llm"]["models"][0]["responseHeaders"]["remove"] == ["server", "x-powered-by"]


@pytest.mark.parametrize(
    "policy_kwargs, message",
    [
        (
            {"remote_rate_limit": RemoteRateLimitPolicySpec(domain="limits.example.com")},
            "remoteRateLimit",
        ),
    ],
)
def test_unsupported_policy_fields_raise_instead_of_being_dropped(policy_kwargs, message):
    with pytest.raises(ValueError, match=message):
        render_config(_ir(policies=PoliciesSpec(**policy_kwargs)), 3600)


def test_route_retry_renders_as_top_level_route_policy():
    """ADR-024 M2: llm.policies rejects retry; it renders on internal/llm:request."""
    ir = _ir(
        policies=PoliciesSpec(
            retry=RetryPolicySpec(
                attempts=2, codes=(401, 429, 500, 502, 503), backoff="200ms"
            )
        )
    )
    cfg = render_config(ir, 3600)
    assert "retry" not in cfg["llm"].get("policies", {})
    assert cfg["policies"] == [
        {
            "name": {"name": "gateway-retry", "namespace": "default"},
            "target": {"route": {"name": "llm:request", "namespace": "internal"}},
            "phase": "route",
            "policy": {
                "retry": {
                    "attempts": 2,
                    "codes": [401, 429, 500, 502, 503],
                    "backoff": "200ms",
                }
            },
        }
    ]


def test_https_models_render_tls_hostname_and_policy_health():
    """E17: https upstreams need models[].tls.hostname; health marks ride per model."""
    ir = _ir(
        policies=PoliciesSpec(
            health=HealthPolicySpec(
                unhealthy_expression="response.code >= 400", consecutive_failures=1
            )
        )
    )
    cfg = render_config(ir, 3600)
    for model in cfg["llm"]["models"]:
        assert model["tls"] == {"hostname": "api.example.com"}
        assert model["health"] == {
            "unhealthyExpression": "response.code >= 400",
            "eviction": {"consecutiveFailures": 1},
        }
    # http upstreams must not render a TLS block.
    http_ir = _ir(
        upstreams=(
            UpstreamSpec("ups_a", "http://api.example.com/v1", "openai_chat", "keys/ups_a.key"),
        )
    )
    assert "tls" not in render_config(http_ir, 3600)["llm"]["models"][0]


def test_validation_requires_key_file_and_absolute_base_url():
    ir = _ir(
        upstreams=(
            UpstreamSpec("ups_a", "https://api.example.com/v1", "openai_chat", ""),
        )
    )
    result = validate_gateway_ir(ir)
    assert not result.ok and any("key_file" in e for e in result.errors)
    bad = _ir(
        upstreams=(
            UpstreamSpec("ups_a", "api.example.com/v1", "openai_chat", "keys/ups_a.key"),
        )
    )
    result = validate_gateway_ir(bad)
    assert not result.ok and any("http(s) URL" in e for e in result.errors)


def test_validation_rejects_4xx_retry_without_health_pairing():
    ir = _ir(policies=PoliciesSpec(retry=RetryPolicySpec(attempts=2, codes=(401, 500))))
    result = validate_gateway_ir(ir)
    assert not result.ok and any("4xx" in e and "health" in e for e in result.errors)
    ok = _ir(
        policies=PoliciesSpec(
            retry=RetryPolicySpec(attempts=2, codes=(401, 500)),
            health=HealthPolicySpec(
                unhealthy_expression="response.code >= 400", consecutive_failures=1
            ),
        )
    )
    assert validate_gateway_ir(ok).ok


def test_validation_rejects_health_expression_without_eviction():
    """E16/E17: expression-only health breaks eviction (the 4xx triple)."""
    ir = _ir(
        policies=PoliciesSpec(
            retry=RetryPolicySpec(attempts=2, codes=(500,)),
            health=HealthPolicySpec(unhealthy_expression="", consecutive_failures=0),
        )
    )
    result = validate_gateway_ir(ir)
    assert not result.ok
    assert any("unhealthyExpression" in e for e in result.errors)
    assert any("consecutiveFailures" in e for e in result.errors)


def test_model_aliases_raise_instead_of_being_dropped():
    with pytest.raises(ValueError, match="modelAliases"):
        render_config(
            _ir(model_aliases=(ModelAliasSpec(alias="legacy", target_model_id="m1"),)), 3600
        )


def test_model_level_conditional_or_response_body_transform_raises():
    from l02_domain.ir import HeaderRule, RewriteCondition

    conditional = TransformsSpec(
        request_headers=(
            HeaderRule(
                op="update",
                name="x-a",
                value="1",
                conditions=(RewriteCondition(field="x-b", mode="full", value="on"),),
            ),
        )
    )
    ir = _ir(
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
                transforms=conditional,
            ),
        )
    )
    with pytest.raises(ValueError, match="conditional"):
        render_config(ir, 3600)
    body = TransformsSpec(response_body=(BodyRule(op="delete", path="error"),))
    ir = _ir(
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
                transforms=body,
            ),
        )
    )
    with pytest.raises(ValueError, match="response_body"):
        render_config(ir, 3600)


def test_adapter_validate_rejects_retry_and_warns_max_buffer():
    """Scope: the capability matrix reopens with the M3 API surface.

    M2 already renders and pair-checks retry/health (tests above); adapter.validate
    keeps refusing policy-level retry so the existing /admin/policies contract and
    capability flags are unchanged until M3.
    """
    adapter = AgentgatewayAdapter(config_dir="unused")
    ir = _ir(
        policies=PoliciesSpec(
            retry=RetryPolicySpec(attempts=2, codes=(500,)),
            health=HealthPolicySpec(
                unhealthy_expression="response.code >= 400", consecutive_failures=1
            ),
        )
    )
    rejected = adapter.validate(ir)
    assert not rejected.ok and any("retry" in e for e in rejected.errors)
    big = _ir(
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
                max_buffer_bytes=9999999,
            ),
        )
    )
    result = adapter.validate(big)
    assert result.ok and any("maxBufferSize" in w for w in result.warnings)


def test_webhook_guard_renders_host_action_and_failure_mode():
    guard = GuardSpec(
        kind="webhook",
        action="audit",
        webhook_target="https://audit.example",
        failure_mode="failOpen",
        rejection_status=403,
        rejection_body="blocked",
    )
    ir = _ir(
        policies=PoliciesSpec(guardrails=PromptGuardSpec(request=(guard,))),
    )
    entry = render_config(ir, 3600)["llm"]["policies"]["guardrails"]["request"][0]
    assert entry == {
        "webhook": {
            "target": {"host": "https://audit.example"},
            "action": "audit",
            "failureMode": "failOpen",
        },
        "rejection": {"status": 403, "body": "blocked"},
    }


def test_stdio_mcp_target_renders_cmd_args_and_env():
    ir = _ir(
        mcp=McpSpec(
            supported=True,
            targets=(
                McpTargetSpec(
                    name="fs",
                    transport="stdio",
                    cmd="npx",
                    args=("a", "b"),
                    env=(("FOO", "bar"),),
                ),
            ),
        )
    )
    assert render_config(ir, 3600)["mcp"]["targets"] == [
        {"name": "fs", "stdio": {"cmd": "npx", "args": ["a", "b"], "env": {"FOO": "bar"}}}
    ]


def test_http_mcp_target_is_an_explicit_error():
    ir = _ir(
        mcp=McpSpec(
            supported=True,
            targets=(McpTargetSpec(name="web", transport="http", host="https://mcp.example"),),
        )
    )
    with pytest.raises(ValueError, match="http"):
        render_config(ir, 3600)


def test_api_key_toggle_omits_the_policy_block():
    ir = _ir(policies=PoliciesSpec(api_key=ApiKeyPolicySpec(enabled=False)))
    cfg = render_config(ir, 3600)
    assert "apiKey" not in cfg["llm"].get("policies", {})


# ── ADR-021 正文日志开关：config.logging.database.url + frontendPolicies ──────


def test_access_log_unset_renders_neither_block():
    cfg = render_config(_ir(), 3600)
    assert "config" not in cfg
    assert "frontendPolicies" not in cfg


def test_access_log_metadata_renders_llm_mode_explicitly():
    """metadata 也显式产出 llm：AG 缺省（legacy）行为会保存 CEL 捕获的正文。"""
    from l02_domain.ir import AccessLogSpec

    ir = _ir(policies=PoliciesSpec(access_log=AccessLogSpec(database_url="ag-data.db")))
    cfg = render_config(ir, 3600)
    assert cfg["config"]["logging"]["database"]["url"] == "ag-data.db"
    assert cfg["frontendPolicies"]["accessLog"]["database"]["llm"] == "metadata"


def test_access_log_full_renders_payload_capture():
    from l02_domain.ir import AccessLogSpec

    ir = _ir(
        policies=PoliciesSpec(
            access_log=AccessLogSpec(database_url="./.data_store/ag-data.db", llm="full")
        )
    )
    cfg = render_config(ir, 3600)
    assert cfg["config"]["logging"]["database"]["url"] == "./.data_store/ag-data.db"
    assert cfg["frontendPolicies"]["accessLog"]["database"]["llm"] == "full"


def test_access_log_without_db_url_renders_nothing():
    """缺省（未配置 AG 库路径）时不产出 logging 块。"""
    from l02_domain.ir import AccessLogSpec

    ir = _ir(policies=PoliciesSpec(access_log=AccessLogSpec(database_url="", llm="full")))
    cfg = render_config(ir, 3600)
    assert "config" not in cfg
    assert "frontendPolicies" not in cfg
