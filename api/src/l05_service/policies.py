"""Typed policy/guardrail/MCP blocks (IR M4) shared by rendering and the API.

The IR builder (what the next apply enforces) and the read-only admin endpoints
both call these builders, so a documented policy cannot diverge from the state
the render path uses. Pure data: no driver is created here (S2) - the caller
injects an adapter when it wants the capability matrix filled.
"""

from __future__ import annotations

from l01_core.cors import cors_origins
from l02_domain.ir import (
    ApiKeyPolicySpec,
    CorsPolicySpec,
    GuardrailItemSpec,
    GuardrailsSpec,
    LocalRateLimitPolicySpec,
    McpSpec,
    PoliciesSpec,
    TransformsPolicySpec,
)
from l03_adapters.spi import DataPlaneAdapter

GUARDRAILS_NOTE = "supported=False 为路线图说明而非今日可配置；verified=False 表示尚未经数据面实测"
MCP_NOTE = (
    "无适配器时 MCP 视为未支持：targets 仅在适配器声明 mcp.targets 能力后渲染，"
    "且始终是顶层 mcp 段，绝不写进 llm"
)
MCP_SUPPORTED_NOTE = (
    "AG 1.7 支持顶层 mcp.targets[] + mcp.policies（sse/stdio；http 被 pinned 1.7 拒绝）；"
    "该形态已用 --validate-only 验证，targets 由 MCP 配置生成"
)


def policies_spec() -> PoliciesSpec:
    """Static control-plane policy contract (defaults are code-enforced)."""
    return PoliciesSpec(
        cors=CorsPolicySpec(allow_origins=tuple(cors_origins())),
        api_key=ApiKeyPolicySpec(),
        local_rate_limit=LocalRateLimitPolicySpec(),
        transforms_defaults=TransformsPolicySpec(),
    )


def guardrails_spec(adapter: DataPlaneAdapter | None = None) -> GuardrailsSpec:
    """Adapter capability matrix; empty when the caller has no driver instance."""
    if adapter is None:
        return GuardrailsSpec()
    info = adapter.describe()
    return GuardrailsSpec(
        adapter=info.adapter_id,
        items=tuple(
            GuardrailItemSpec(
                key=cap.key,
                supported=cap.supported,
                since_version=cap.since_version,
                note=cap.note,
                verified=cap.verified,
            )
            for cap in info.capabilities
        ),
    )


def mcp_spec(adapter: DataPlaneAdapter | None = None) -> McpSpec:
    """MCP support is capability-driven; never fabricate servers or targets."""
    supported = False
    note = MCP_NOTE
    if adapter is not None:
        capabilities = {cap.key: cap for cap in adapter.describe().capabilities}
        capability = capabilities.get("mcp.targets")
        if capability is not None and capability.supported:
            supported = True
            note = MCP_SUPPORTED_NOTE
    return McpSpec(servers=(), supported=supported, note=note)


def build_policy_blocks(
    adapter: DataPlaneAdapter | None = None,
) -> tuple[PoliciesSpec, GuardrailsSpec, McpSpec]:
    """All three M4 blocks in IR order."""
    return policies_spec(), guardrails_spec(adapter), mcp_spec(adapter)
