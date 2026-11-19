"""Golden contract: the rendered AG 1.7 config is byte-stable and reviewable.

The fixture is the review artifact: whenever the renderer changes, the diff of
this file is the contract change. It is validated by the real AG binary in
tests/integration/test_ag_validate.py.
"""

from __future__ import annotations

from pathlib import Path

from l02_domain.ir import (
    AccessLogSpec,
    BodyRule,
    ClientKeySpec,
    CorsPolicySpec,
    GatewayIR,
    GuardSpec,
    HeaderRule,
    HealthPolicySpec,
    LimitsSpec,
    McpPolicySpec,
    McpSpec,
    McpTargetSpec,
    PoliciesSpec,
    PromptCachingSpec,
    PromptGuardSpec,
    PublicModelSpec,
    RegexRuleSpec,
    RetryPolicySpec,
    RewriteCondition,
    TargetSpec,
    TimeoutPolicySpec,
    TransformsSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l03_adapters.agentgateway.render import render_artifact

FIXTURE = Path(__file__).parent / "fixtures" / "ag_1_7_full_config.yaml"


def golden_ir() -> GatewayIR:
    return GatewayIR(
        revision="rev_golden",
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
                transforms=TransformsSpec(
                    request_headers=(HeaderRule(op="update", name="x-trace", value="slipstream"),),
                    request_body=(BodyRule(op="update", path="temperature", value="0.2"),),
                    response_headers=(HeaderRule(op="delete", name="x-internal-debug"),),
                ),
                extra_headers=(("x-team", "slipstream"),),
            ),
            UpstreamSpec(
                id="ups_b",
                base_url="https://api.anthropic.com/v1",
                api_style="anthropic_messages",
                key_file="keys/ups_b.key",
            ),
        ),
        models=(
            UpstreamModelSpec(
                id="umdl_a",
                upstream_id="ups_a",
                upstream_model_name="glm-5.3",
                model_type="chat",
                guardrails=PromptGuardSpec(
                    request=(
                        GuardSpec(
                            action="mask",
                            rules=(RegexRuleSpec(pattern="secret-[0-9]+"),),
                            scope=("messages",),
                        ),
                    )
                ),
                prompt_caching=PromptCachingSpec(cache_system=True, min_tokens=1024),
            ),
            UpstreamModelSpec(
                id="umdl_b",
                upstream_id="ups_b",
                upstream_model_name="claude-sonnet-4-5",
                model_type="chat",
            ),
        ),
        public_models=(
            PublicModelSpec(
                name="flagship",
                targets=(
                    TargetSpec(id="mt_a", upstream_model_id="umdl_a", priority=10),
                    TargetSpec(id="mt_b", upstream_model_id="umdl_b", priority=0),
                ),
            ),
            PublicModelSpec(
                name="test-model",
                routing_mode="weighted",
                targets=(
                    TargetSpec(id="mt_w1", upstream_model_id="umdl_a", priority=0, weight=3),
                    TargetSpec(id="mt_w2", upstream_model_id="umdl_b", priority=0, weight=1),
                ),
            ),
            PublicModelSpec(
                name="route-by-header",
                routing_mode="conditional",
                targets=(
                    TargetSpec(
                        id="mt_c1",
                        upstream_model_id="umdl_a",
                        priority=0,
                        when='request.headers["x-route"] == "a"',
                    ),
                    TargetSpec(id="mt_c2", upstream_model_id="umdl_b", priority=0),
                ),
            ),
        ),
        api_keys=(
            ClientKeySpec(
                id="key_a",
                key_hash="sha256:" + "a" * 64,
                user_id="usr_a",
                key_suffix="abcd",
            ),
        ),
        limits=LimitsSpec(requests_per_minute=120, tokens_per_minute=200000),
        policies=PoliciesSpec(
            data_plane_cors=CorsPolicySpec(
                allow_origins=("https://app.example.com",),
                allow_credentials=True,
                allow_methods=("POST", "OPTIONS"),
                allow_headers=("authorization", "content-type"),
                expose_headers=("x-request-id",),
                max_age=600,
            ),
            global_transformations=TransformsSpec(
                request_headers=(
                    HeaderRule(
                        op="update",
                        name="x-tenant",
                        value="golden",
                        conditions=(RewriteCondition(field="x-mode", mode="full", value="golden"),),
                    ),
                ),
            ),
            guardrails=PromptGuardSpec(
                request=(
                    GuardSpec(
                        action="mask",
                        rules=(RegexRuleSpec(pattern="secret-[0-9]+"),),
                        scope=("messages",),
                    ),
                ),
            ),
            timeout=TimeoutPolicySpec(request_timeout="60s", backend_request_timeout="30s"),
            # ADR-024 M2: retry is a route-level policy; 4xx codes require the
            # paired health expression + eviction (E16/E17 4xx triple).
            retry=RetryPolicySpec(
                attempts=2,
                codes=(429, 500, 502, 503),
                backoff="100ms",
            ),
            health=HealthPolicySpec(
                unhealthy_expression="response.code >= 400",
                consecutive_failures=1,
            ),
            # ADR-021 full mode: the golden fixture pins the payload-logging
            # blocks so --validate-only keeps accepting them across upgrades.
            access_log=AccessLogSpec(database_url="ag-data.db", llm="full"),
        ),
        mcp=McpSpec(
            supported=True,
            targets=(
                McpTargetSpec(
                    name="files",
                    transport="sse",
                    host="https://mcp.example.com",
                ),
            ),
            policies=McpPolicySpec(
                cors=CorsPolicySpec(allow_origins=("https://app.example.com",)),
            ),
        ),
    )


def test_rendered_config_matches_the_golden_fixture():
    artifact = render_artifact(golden_ir(), llm_port=3600)
    assert FIXTURE.exists(), f"missing golden fixture: {FIXTURE}"
    assert artifact.content == FIXTURE.read_text(encoding="utf-8")


def test_golden_contract_has_the_ag_1_7_sections():
    content = FIXTURE.read_text(encoding="utf-8")
    for key in (
        "gateways:",
        "default:",
        "port: 3600",
        "llm:",
        "gateways: default",
        "providers:",
        "models:",
        "virtualModels:",
        "policies:",
        "tls:",
        "hostname:",
        "health:",
        "unhealthyExpression:",
        "eviction:",
        "consecutiveFailures: 1",
        "retry:",
        "attempts: 2",
        "apiKey:",
        "localRateLimit:",
        "timeout:",
        "guardrails:",
        "transformations:",
        "mcp:",
        "targets:",
        "logging:",
        "frontendPolicies:",
        "accessLog:",
        "visibility: internal",
        "priority: 0",
        "weight: 3",
        "when:",
    ):
        assert key in content, key
