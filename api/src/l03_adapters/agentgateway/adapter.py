"""AgentgatewayAdapter: the DataPlaneAdapter implementation over render/apply/usage."""

from __future__ import annotations

from l02_domain.ir import GatewayIR
from l02_domain.validation import ValidationResult, validate_gateway_ir
from l03_adapters.agentgateway.apply import ConfigApplier
from l03_adapters.agentgateway.binary_validate import build_validator
from l03_adapters.agentgateway.render import render_artifact
from l03_adapters.agentgateway.transforms import compile_transforms
from l03_adapters.agentgateway.usage import fetch_events, open_readonly
from l03_adapters.spi import (
    AdapterInfo,
    ApplyResult,
    Artifact,
    Capability,
    DataPlaneStatus,
    HealthSnapshot,
    UsageCursor,
    UsagePage,
)

DEFAULT_MAX_BUFFER_BYTES = 2097152


def validate_agentgateway_ir(ir: GatewayIR) -> ValidationResult:
    """Generic IR rules + explicit AG 1.7 capability matrix.

    The 1.7 binary accepts several fields only at other layers (retry on routes,
    not llm.policies) and has no modelAliases/maxBufferSize surface. Those are
    reported here and raised again by the renderer - never silently dropped.
    """
    base = validate_gateway_ir(ir)
    errors = list(base.errors)
    warnings = list(base.warnings)
    if ir.policies.retry is not None and ir.policies.retry.attempts < 2:
        warnings.append(
            "policies.retry.attempts=1 只会在同一后端重试一次；E16/E17 证实跨层 failover "
            "发生在驱逐标记后的下一次尝试，建议 attempts >= 2"
        )
    if ir.policies.remote_rate_limit is not None:
        errors.append(
            "AG 1.7 没有 remoteRateLimit 的安全配置面"
            "（能力矩阵 policies.remoteRateLimit=false）"
        )
    if ir.model_aliases:
        errors.append("AG 1.7 没有 modelAliases 配置面；请删除模型别名或改用 virtualModels")
    for model in ir.models:
        if model.aliases:
            errors.append(f"上游模型 {model.id} 的 aliases 无法在 AG 1.7 渲染")
        if model.display_name:
            errors.append(f"上游模型 {model.id} 的 displayName 无法在 AG 1.7 渲染（无该字段）")
    for upstream in ir.upstreams:
        if upstream.max_buffer_bytes != DEFAULT_MAX_BUFFER_BYTES:
            warnings.append(
                f"上游 {upstream.id} 的 maxBufferSize={upstream.max_buffer_bytes} 在 AG 1.7 "
                "没有对应字段，已忽略（能力矩阵 provider.maxBufferSize=false）"
            )
        if upstream.transforms is None:
            continue
        compiled = compile_transforms(upstream.transforms)
        if compiled.get("conditional"):
            errors.append(
                f"上游 {upstream.id} 的 conditional 规则无法放在模型级 transformations；"
                "请改配全局 llm.policies.transformations"
            )
        if "body" in (compiled.get("response") or {}):
            errors.append(
                f"上游 {upstream.id} 的 response_body 规则无法放在 llm.models[].responseHeaders；"
                "请改配全局 llm.policies.transformations"
            )
    if ir.policies.global_transformations is not None:
        compiled = compile_transforms(ir.policies.global_transformations)
        if compiled.get("conditional") and (compiled.get("request") or compiled.get("response")):
            errors.append(
                "AG 1.7 的 llm.policies.transformations 不能同时包含 request/response 与 "
                "conditional；请拆分（能力矩阵 policies.transformations.conditional）"
            )
    for target in ir.mcp.targets:
        if target.transport == "http":
            errors.append(
                f"AG 1.7 pinned binary 拒绝 http MCP target（{target.name}）：只支持 sse/stdio"
                "（能力矩阵 mcp.transport.http=false）"
            )
        if target.url:
            errors.append(
                f"AG 1.7 的 mcp.targets 使用 host、不接受 url（{target.name}）"
            )
    for guard in _all_guardrails(ir):
        for phase in ("request", "response"):
            for index, item in enumerate(getattr(guard, phase, ())):
                if item.kind != "webhook":
                    continue
                label = f"guardrails.{phase}[{index}]"
                if "://" in item.webhook_target:
                    path = item.webhook_target.split("://", 1)[1].split("/", 1)
                    if len(path) == 2 and path[1]:
                        errors.append(
                            f"{label}.webhook_target 不能带路径：AG 1.7 只接受 host"
                        )
    return ValidationResult(ok=not errors, errors=tuple(errors), warnings=tuple(warnings))


def _all_guardrails(ir: GatewayIR):
    if ir.policies.guardrails is not None:
        yield ir.policies.guardrails
    for model in ir.models:
        if model.guardrails is not None:
            yield model.guardrails


class AgentgatewayAdapter:
    """Official-binary driver. Never starts, stops or rewrites the AG process itself."""

    def __init__(
        self,
        config_dir: str,
        filename: str = "config.yaml",
        ag_db_path: str | None = None,
        ag_binary: str | None = None,
    ) -> None:
        # None auto-detects the pinned binary; "" disables the gate explicitly
        # (tests and hosts without the gateway install); a path pins one binary.
        self._applier = ConfigApplier(
            config_dir, filename, validator=build_validator(ag_binary)
        )
        self._ag_db_path = ag_db_path

    def describe(self) -> AdapterInfo:
        return AdapterInfo(
            adapter_id="agentgateway",
            version="pinned-binary",
            capabilities=(
                Capability(
                    "routing.priority_failover", True, "1.7.0", "分层故障转移", verified=False
                ),
                Capability(
                    "routing.weighted", True, "1.7.0", "加权路由 (ADR-014)", verified=False
                ),
                Capability(
                    "routing.conditional", True, "1.7.0", "条件路由 CEL (ADR-014)", verified=False
                ),
                Capability(
                    "llm.providers.array",
                    True,
                    "1.7.0",
                    "providers[] 必须是数组；映射形态被 --validate-only 拒绝",
                    verified=True,
                ),
                Capability(
                    "llm.models.internal_visibility",
                    True,
                    "1.7.0",
                    "上游模型渲染为 llm.models[]，默认 internal（E4/E5）",
                    verified=True,
                ),
                Capability(
                    "llm.models.guardrails",
                    True,
                    "1.7.0",
                    "模型级 guardrails（regex 规则）",
                    verified=False,
                ),
                Capability(
                    "llm.models.promptCaching",
                    True,
                    "1.7.0",
                    "promptCaching 字段：cacheSystem/cacheMessages/cacheTools/"
                    "minTokens/cacheMessageOffset",
                    verified=False,
                ),
                Capability(
                    "llm.models.displayName",
                    False,
                    "",
                    "AG 1.7 llm.models[] 没有 displayName 字段；出现时显式报错",
                    verified=True,
                ),
                Capability(
                    "llm.modelAliases",
                    False,
                    "",
                    "AG 1.7 没有 modelAliases 配置面；出现 alias 时显式报错",
                    verified=True,
                ),
                Capability(
                    "provider.maxBufferSize",
                    False,
                    "",
                    "AG 1.7 没有 provider/model maxBufferSize 字段；非默认值告警并忽略",
                    verified=True,
                ),
                Capability(
                    "policies.apiKey.strict",
                    True,
                    "1.7.0",
                    "keyHash + metadata，mode: strict；enabled=false 时整段不渲染（匿名）",
                    verified=True,
                ),
                Capability(
                    "policies.localRateLimit.global",
                    True,
                    "1.7.0",
                    "localRateLimit 是数组；只有全局规则，无逐用户 maxTokens（E12）",
                    verified=True,
                ),
                Capability(
                    "policies.transformations.conditional",
                    True,
                    "1.7.0",
                    "仅全局 llm.policies.transformations 支持 conditional",
                    verified=True,
                ),
                Capability(
                    "policies.guardrails.regex",
                    True,
                    "1.7.0",
                    "llm.policies.guardrails（regex mask/reject/audit + 内置敏感信息规则）",
                    verified=True,
                ),
                Capability(
                    "policies.guardrails.webhook",
                    True,
                    "1.7.0",
                    "webhook 护栏仅 reject/audit，target 只能 host（无路径），不支持 scope",
                    verified=True,
                ),
                Capability(
                    "policies.timeout",
                    True,
                    "1.7.0",
                    "request/backend/responseIdle 时长",
                    verified=False,
                ),
                Capability(
                    "policies.cors",
                    True,
                    "1.7.0",
                    "数据面 CORS（显式配置才渲染）",
                    verified=False,
                ),
                Capability(
                    "policies.retry",
                    True,
                    "1.7.0",
                    "渲染为顶层 policies[]（target route internal/llm:request）；"
                    "llm.policies 仍拒绝 retry（E16/E17）",
                    verified=True,
                ),
                Capability(
                    "policies.health",
                    True,
                    "1.7.0",
                    "逐模型 llm.models[].health（unhealthyExpression + eviction）；"
                    "retry codes 含 4xx 时必须成对（E16/E17）",
                    verified=True,
                ),
                Capability(
                    "frontendPolicies.tracing",
                    True,
                    "1.7.0",
                    "frontendPolicies.tracing {host,protocol:http,randomSampling:\"true\"} "
                    "→ OTLP/HTTP /v1/traces；每请求 1 server 根 span + 每次上游尝试 1 "
                    "client span（E19），顶层 tracing 键被 1.7 拒绝",
                    verified=True,
                ),
                Capability(
                    "policies.remoteRateLimit",
                    False,
                    "",
                    "没有安全配置面；显式报错而不是丢弃",
                    verified=True,
                ),
                Capability(
                    "mcp.targets",
                    True,
                    "1.7.0",
                    "顶层 mcp.targets[] + mcp.policies；sse/stdio 已验证，http 被 pinned 1.7 拒绝",
                    verified=True,
                ),
                Capability(
                    "mcp.transport.sse", True, "1.7.0", "sse target 使用 host", verified=True
                ),
                Capability(
                    "mcp.transport.stdio",
                    True,
                    "1.7.0",
                    "stdio target: cmd/args/env/clear_env，已 --validate-only 验证",
                    verified=True,
                ),
                Capability(
                    "mcp.transport.http",
                    False,
                    "",
                    "pinned 1.7 拒绝 http 变体（no variant of enum LocalMcpTargetSpec）",
                    verified=True,
                ),
                Capability("auth.api_key_static", True, "1.7.0", "静态密钥表", verified=False),
                Capability(
                    "observe.request_log", True, "1.7.0", "请求日志落自身 SQLite", verified=False
                ),
                Capability(
                    "config.validate_only",
                    True,
                    "1.7.0",
                    "下发前用官方二进制 --validate-only 预校验候选配置；拒绝则不落盘",
                    verified=True,
                ),
                Capability(
                    "config.hot_reload", True, "1.7.0", "热加载；在飞影响待 P0-R2", verified=False
                ),
                Capability("usage.read_events", True, "1.7.0", "SQLite 只读增量", verified=False),
                Capability(
                    "health.eviction_params",
                    True,
                    "1.7.0",
                    "llm.models[].health: unhealthyExpression + eviction"
                    "（consecutiveFailures/duration/restoreHealth），M2 渲染已接通",
                    verified=True,
                ),
                Capability(
                    "backends.session_affinity",
                    False,
                    "",
                    "会话亲和仅 backends 层级，简化模式不可配",
                    verified=False,
                ),
                Capability(
                    "health.fine_policies",
                    True,
                    "1.7.0",
                    "按模型渲染 health；expression 必须与 eviction 成对，"
                    "4xx 还需与 retry codes 成对（ADR-024/E16/E17）",
                    verified=True,
                ),
            ),
        )

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return validate_agentgateway_ir(ir)

    def render(self, ir: GatewayIR) -> Artifact:
        return render_artifact(ir)

    def apply(self, artifact: Artifact) -> ApplyResult:
        return self._applier.apply(artifact)

    def status(self) -> DataPlaneStatus:
        return self._applier.status()

    def usage(self, cursor: UsageCursor | None) -> UsagePage:
        if not self._ag_db_path:
            return UsagePage(events=(), next_cursor=cursor)
        conn = open_readonly(self._ag_db_path)
        try:
            return fetch_events(conn, cursor)
        finally:
            conn.close()

    def health(self) -> HealthSnapshot:
        from l01_core.timeutil import now_ms

        status = self.status()
        return HealthSnapshot(
            healthy=status.config_hash is not None,
            detail="applied" if status.config_hash else "no config applied",
            checked_at_ms=now_ms(),
        )

    def rollback(self, revision_id: str) -> ApplyResult:
        return self._applier.rollback(revision_id)
