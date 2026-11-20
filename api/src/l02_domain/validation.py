"""Gateway-agnostic IR validation (no gateway nouns, no adapter imports).

Moved out of l03_adapters so the service layer can self-validate without
reaching into the driver package (S2). Rules come from
docs/contracts/ir-and-rendering.md §3 (render invariants) and
docs/contracts/adapter-spi.md §5 (validate must reject illegal IR).

ValidationResult lives here for the same reason: it is the shared result type,
and l02 may not import l03. l03_adapters.spi re-exports it so drivers keep one
type identity.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from l02_domain.ir import (
    API_KEY_MODES,
    BUILTIN_GUARD_RULES,
    GUARD_ACTIONS,
    GUARD_KINDS,
    GUARD_SCOPES,
    GUARD_STREAMING,
    MCP_TRANSPORTS,
    ROUTING_MODES,
    VISIBILITIES,
    WEBHOOK_FAILURE_MODES,
    WEBHOOK_GUARD_ACTIONS,
    GatewayIR,
    GuardSpec,
    PublicModelSpec,
)

_DURATION_RE = re.compile(r"^[1-9][0-9]*(ms|s|m|h)$")


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Outcome of an IR check; warnings are non-blocking notes (ADR-014)."""

    ok: bool
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


def validate_gateway_ir(ir: GatewayIR) -> ValidationResult:
    """Structural validation only: identity, references and routing invariants."""
    errors: list[str] = []
    warnings: list[str] = []

    upstream_ids = [u.id for u in ir.upstreams]
    dup_upstreams = _duplicates(upstream_ids)
    if dup_upstreams:
        errors.append(f"重复的上游 id: {', '.join(sorted(dup_upstreams))}")

    model_ids = [m.id for m in ir.models]
    dup_models = _duplicates(model_ids)
    if dup_models:
        errors.append(f"重复的上游模型 id: {', '.join(sorted(dup_models))}")

    public_names = [p.name for p in ir.public_models]
    dup_publics = _duplicates(public_names)
    if dup_publics:
        errors.append(f"重复的对外模型名: {', '.join(sorted(dup_publics))}")

    upstream_set = set(upstream_ids)
    model_set = set(model_ids)
    model_upstream_by_id = {m.id: m.upstream_id for m in ir.models}
    for upstream in ir.upstreams:
        # Ticket 16: the id is rendered into provider names and keys/{id}#{seq}.key.
        _validate_render_id(upstream.id, "上游 id", _KEY_EXPANDED_PROVIDER, errors)
        _validate_key_file(upstream, errors)
        # E17 安全红线：without a per-provider credential AG forwards the
        # client's Authorization header to the upstream verbatim.
        if not upstream.key_file:
            errors.append(
                f"上游 {upstream.id} 缺少 key_file：AG 会把客户端 Authorization "
                "透传上游（E17 安全红线）"
            )
        # Hybrid render surface (ADR-024 M2): the dial address is llm.params.baseUrl,
        # so it must be an absolute http(s) URL whose host can feed tls.hostname.
        parts = urlsplit(upstream.base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            errors.append(
                f"上游 {upstream.id} base_url 不是合法的绝对 http(s) URL: "
                f"{upstream.base_url!r}（AG 1.7 llm.params.baseUrl；https 上游渲染 "
                "llm.models[].tls.hostname）"
            )
    for model in ir.models:
        # Ticket 16: one model expands into {model_id}#k{seq} llm.models entries.
        _validate_render_id(model.id, "上游模型 id", _KEY_EXPANDED_MODEL, errors)
        if model.upstream_id not in upstream_set:
            errors.append(f"上游模型 {model.id} 指向不存在的上游 {model.upstream_id}")
        if model.visibility not in VISIBILITIES:
            errors.append(
                f"上游模型 {model.id} visibility 非法: {model.visibility!r}"
                f"（允许: {VISIBILITIES}）"
            )
        if model.guardrails is not None:
            _validate_guardrails(model.guardrails, f"上游模型 {model.id}", errors)
        if model.prompt_caching is not None:
            cache = model.prompt_caching
            if cache.min_tokens < 0 or cache.cache_message_offset < 0:
                errors.append(f"上游模型 {model.id} promptCaching 的 minTokens/offset 不能为负")

    key_ids = [k.id for k in ir.api_keys]
    dup_keys = _duplicates(key_ids)
    if dup_keys:
        errors.append(f"重复的客户端密钥 id: {', '.join(sorted(dup_keys))}")

    for public in ir.public_models:
        target_ids = [t.id for t in public.targets]
        dup_targets = _duplicates(target_ids)
        if dup_targets:
            errors.append(
                f"对外模型 {public.name} 存在重复目标 id: {', '.join(sorted(dup_targets))}"
            )
        if public.routing_mode not in ROUTING_MODES:
            errors.append(
                f"对外模型 {public.name} routing_mode 非法: {public.routing_mode!r}"
                f"（允许: {ROUTING_MODES}）"
            )
        catch_all_seen = False  # conditional: a when-empty entry has been seen
        for index, target in enumerate(public.targets):
            if target.upstream_model_id not in model_set:
                errors.append(
                    f"对外模型 {public.name} 目标 {target.id} "
                    f"指向不存在的上游模型 {target.upstream_model_id}"
                )
            # ADR-014 + AG 1.7: failover priority is numeric SMALL first and the
            # control plane accepts integers >= 0. AG's --validate-only accepts
            # priority 0, so the control plane must self-check the range (E8).
            if public.routing_mode == "failover":
                if (
                    not isinstance(target.priority, int)
                    or isinstance(target.priority, bool)
                    or target.priority < 0
                ):
                    errors.append(
                        f"对外模型 {public.name} 目标 {target.id} "
                        f"priority 必须为 >= 0 的整数，得到 {target.priority!r}"
                    )
                if target.weight:
                    warnings.append(
                        f"对外模型 {public.name} 目标 {target.id}: failover 模式忽略 weight"
                    )
            elif public.routing_mode == "weighted":
                if (
                    not isinstance(target.weight, int)
                    or isinstance(target.weight, bool)
                    or target.weight <= 0
                ):
                    errors.append(
                        f"对外模型 {public.name} 目标 {target.id} "
                        f"weight 必须为正整数，得到 {target.weight!r}"
                    )
                if target.priority not in (0, 1):
                    warnings.append(
                        f"对外模型 {public.name} 目标 {target.id}: "
                        f"weighted 模式忽略 priority={target.priority}"
                    )
            else:  # conditional
                # E20（AG 1.7 实测）：无 when 兜底**至多 1 条且必须是末条**——AG 把
                # 该约束实现为硬校验（拒收原文 "conditional fallback target must
                # be last"，连可达性都不检查）。旧不变量「无 when 条目必须是连续
                # 末段」比 AG 真实约束宽（多密钥兜底展开成 N 条末段会被 AG
                # validate 拒收，P0-RESULTS §E20 T1-mixed-kn2），故收紧。
                if not target.when:
                    if catch_all_seen:
                        errors.append(
                            f"对外模型 {public.name} 目标 {target.id}: "
                            "conditional 模式无 when 兜底至多 1 条"
                            "（AG: conditional fallback target must be last，E20）"
                        )
                    if index != len(public.targets) - 1:
                        errors.append(
                            f"对外模型 {public.name} 目标 {target.id}: "
                            "conditional 模式无 when 兜底必须位于末位"
                            "（AG: conditional fallback target must be last，E20）"
                        )
                    catch_all_seen = True
                elif catch_all_seen:
                    errors.append(
                        f"对外模型 {public.name} 目标 {target.id}: "
                        "conditional 模式仅末位目标可省略 when（无 when 兜底"
                        "至多 1 条且必须末位；AG: conditional fallback target "
                        "must be last，E20）"
                    )
        # E20：conditional × 多密钥组合可用但密钥平权失效——不 422，warning 提示
        # （详见 _conditional_multikey_warning）。
        if public.routing_mode == "conditional":
            warning = _conditional_multikey_warning(ir, public, model_upstream_by_id)
            if warning:
                warnings.append(warning)

    for alias in ir.model_aliases:
        if alias.target_model_id not in model_set:
            errors.append(
                f"模型别名 {alias.alias} 指向不存在的上游模型 {alias.target_model_id}"
            )

    if ir.users:
        warnings.append(
            "按用户余额（UserBalanceSpec）只由控制面账本执行：数据面渲染器无法表达"
            "逐用户 maxTokens（AG 1.7 每个限流规则只有一个 maxTokens），因此不渲染"
            "localRateLimit buckets"
        )
    if ir.limits is not None:
        limits = ir.limits
        for field_name, value in (
            ("requests_per_minute", limits.requests_per_minute),
            ("tokens_per_minute", limits.tokens_per_minute),
        ):
            if value is not None and value <= 0:
                errors.append(f"limits.{field_name} 必须为正整数，得到 {value!r}")
        if limits.budget_usd is not None:
            warnings.append("limits.budget_usd 仅由控制面账本执行，不进入数据面配置")

    _validate_policies(ir, errors)
    _validate_mcp(ir, errors)
    return ValidationResult(ok=not errors, errors=tuple(errors), warnings=tuple(warnings))


#: ADR-026 密钥展开命名：provider id = ``{upstream_id}#{seq}``、上游模型别名 =
#: ``{model}#k{seq}``（唯一事实源在 l05_service/rendering.py 的 provider_id /
#: model_alias；这里只做同形后缀剥离，用于把展开后的条目归并回逻辑上游）。
_PROVIDER_SEQ_SUFFIX = re.compile(r"#\d+$")


def provider_base_id(provider: str) -> str:
    """Merge an ADR-026 key-expanded provider id back to its logical upstream.

    The renderer names every per-key provider "{upstream_id}#{seq}" and usage
    rows copy that name verbatim; anything comparing providers to upstream ids
    (E20 warnings, billing attribution) must strip the suffix first. Names that
    are not key-expanded ids pass through unchanged.
    """
    return _PROVIDER_SEQ_SUFFIX.sub("", provider or "")


#: Ticket 16: Windows forbids these characters in a file name, and ADR-026 puts
#: the upstream id into the managed key file path (keys/{id}#{seq}.key), so an id
#: carrying one either fails the OS call or escapes the keys/ directory.
_UNSAFE_FILE_NAME_CHARS = frozenset('<>:"/\\|?*')

#: ADR-026 expanded names: provider = {base}#{seq}, model alias = {base}#k{seq}.
#: A '#' in an id may only be that renderer-assigned key-sequence suffix.
_KEY_EXPANDED_PROVIDER = re.compile(r"^[^#]+#\d+$")
_KEY_EXPANDED_MODEL = re.compile(r"^[^#]+#k\d+$")


def _validate_render_id(
    name: str, label: str, expanded: re.Pattern[str], errors: list[str]
) -> None:
    """T16: ids become provider names AND key file names, so they must be safe.

    Rejects path separators / Windows-reserved characters / control characters
    (the renderer would write keys/{id}#{seq}.key), '.'/'..' and any '#' that is
    not the renderer's key-sequence suffix (otherwise the ADR-026 naming
    protocol is ambiguous: provider_base_id could strip a user-supplied tail).
    """
    if not name:
        errors.append(f"{label}不能为空")
        return
    unsafe = sorted(
        {
            character
            for character in name
            if character in _UNSAFE_FILE_NAME_CHARS
            or ord(character) < 0x20
            or ord(character) == 0x7F
        }
    )
    if unsafe:
        shown = "".join(unsafe).encode("unicode_escape").decode("ascii")
        errors.append(
            f"{label} {name!r} 含跨平台不安全的文件名字符 {shown!r}：ADR-026 会把它渲染成"
            " provider 名与 keys/ 下的密钥文件名（Windows 禁止 < > : \" / \\ | ? * 与控制字符）"
        )
    if name in (".", ".."):
        errors.append(f"{label} {name!r} 不能是 . 或 ..（会破坏受管密钥文件路径）")
    if "#" in name and not expanded.match(name):
        errors.append(
            f"{label} {name!r} 的 # 只允许 ADR-026 密钥序号后缀"
            "（上游 id 形如 base#1、上游模型别名形如 base#k1；# 由渲染层分配）"
        )


def _validate_key_file(upstream, errors: list[str]) -> None:
    """T16: the key file path must stay inside the managed keys/ directory."""
    segments = re.split(r"[\\/]", upstream.key_file)
    if ".." in segments:
        errors.append(
            f"上游 {upstream.id} key_file 不得包含 .. 路径段（必须位于受管 keys/ 目录内）: "
            f"{upstream.key_file!r}"
        )


def _conditional_multikey_warning(
    ir: GatewayIR, public: PublicModelSpec, model_upstream_by_id: dict[str, str]
) -> str:
    """E20：conditional × 多密钥 = 密钥平权失效，给 warning 不给 422。

    ADR-026 把每把密钥展开为独立 provider（id 形如 ``{upstream_id}#{seq}``），
    所以同一逻辑上游出现多个 provider 即「多密钥」。E20 证实 AG 对 conditional
    targets 按 first-match 求值：同谓词条目首条独占（40:0，无告警）、兜底多把
    密钥被 validate 拒收、when 条目间无请求内切换——可用，但每目标只用第一把
    密钥，密钥级平权/容错只有 failover/weighted 支持。
    """
    bases: set[str] = set()
    for target in public.targets:
        upstream_id = model_upstream_by_id.get(target.upstream_model_id)
        if upstream_id:
            bases.add(provider_base_id(upstream_id))
    if not bases:
        return ""
    providers_per_base: dict[str, int] = {}
    for upstream in ir.upstreams:
        base = provider_base_id(upstream.id)
        providers_per_base[base] = providers_per_base.get(base, 0) + 1
    multi = sorted(base for base in bases if providers_per_base.get(base, 0) > 1)
    if not multi:
        return ""
    return (
        f"对外模型 {public.name}: conditional 模式密钥平权不生效（E20）：上游 "
        f"{', '.join(multi)} 配了多把密钥，AG conditional targets 按 first-match "
        "首条独占（同谓词其余密钥 0 流量、无请求内切换），每目标仅使用第一把密钥；"
        "密钥级平权/容错只有 failover/weighted 模式支持"
    )


def _validate_policies(ir: GatewayIR, errors: list[str]) -> None:
    policies = ir.policies
    if policies.api_key.mode not in API_KEY_MODES:
        errors.append(
            f"policies.apiKey.mode 非法: {policies.api_key.mode!r}（允许: {API_KEY_MODES}）"
        )
    if policies.guardrails is not None:
        _validate_guardrails(policies.guardrails, "llm.policies", errors)
    if policies.timeout is not None:
        timeout = policies.timeout
        for field_name, value in (
            ("requestTimeout", timeout.request_timeout),
            ("backendRequestTimeout", timeout.backend_request_timeout),
            ("responseIdleTimeout", timeout.response_idle_timeout),
        ):
            if value and not _DURATION_RE.match(value):
                errors.append(
                    f"policies.timeout.{field_name} 不是合法时长: {value!r}（如 60s/500ms）"
                )
    if policies.retry is not None:
        retry = policies.retry
        if (
            not isinstance(retry.attempts, int)
            or isinstance(retry.attempts, bool)
            or not 1 <= retry.attempts <= 10
        ):
            errors.append(
                f"policies.retry.attempts 必须为 1-10 的整数，得到 {retry.attempts!r}"
                "（E16：attempts=2 即最多 3 次上游尝试；跨层切换发生在驱逐标记后的下一次尝试）"
            )
        if not retry.codes:
            errors.append("policies.retry.codes 不能为空（如 [429, 500, 502, 503]）")
        illegal_codes = [
            code
            for code in retry.codes
            if not isinstance(code, int) or isinstance(code, bool) or not 400 <= code <= 599
        ]
        if illegal_codes:
            errors.append(f"policies.retry.codes 含非法状态码: {illegal_codes!r}（仅允许 400-599）")
        if retry.backoff and not _DURATION_RE.match(retry.backoff):
            errors.append(
                f"policies.retry.backoff 不是合法时长: {retry.backoff!r}（如 100ms/1s）"
            )
        # ADR-024 mandatory pairing: E16/E17 show that retry codes containing a
        # 4xx only reach the next priority layer when health marks + eviction are
        # rendered together (codes alone keep retrying the same backend).
        four_xx_codes = sorted(set(code for code in retry.codes if 400 <= code <= 499))
        if four_xx_codes and policies.health is None:
            labels = ", ".join(str(code) for code in four_xx_codes)
            errors.append(
                f"policies.retry.codes 含 4xx（{labels}）时必须同时配置 policies.health"
                "（unhealthy_expression 非空 + consecutive_failures >= 1）："
                "E16/E17 证实仅靠 retry codes 不会换组"
            )
    if policies.health is not None:
        health = policies.health
        if not health.unhealthy_expression:
            errors.append(
                "policies.health.unhealthyExpression 不能为空（如 response.code >= 400）"
            )
        if (
            not isinstance(health.consecutive_failures, int)
            or isinstance(health.consecutive_failures, bool)
            or health.consecutive_failures < 1
        ):
            errors.append(
                "policies.health.eviction.consecutiveFailures 必须为 >= 1 的整数："
                "E16/E17 证实仅配置表达式而不驱逐会让 4xx 永不离开主层"
            )
        if health.duration and not _DURATION_RE.match(health.duration):
            errors.append(
                f"policies.health.eviction.duration 不是合法时长: {health.duration!r}"
                "（如 60s/5m）"
            )
        if health.restore_health < 0:
            errors.append("policies.health.eviction.restoreHealth 不能为负")
    if policies.remote_rate_limit is not None and not policies.remote_rate_limit.domain:
        errors.append("policies.remote_rate_limit.domain 不能为空")
    if policies.data_plane_cors is not None:
        cors = policies.data_plane_cors
        if "*" in cors.allow_origins and cors.allow_credentials:
            errors.append("policies.cors 不允许 allowCredentials=true 配合 allow_origins=*")
        if cors.max_age is not None and cors.max_age < 0:
            errors.append("policies.cors.maxAge 不能为负")


def _validate_guardrails(guard: object, owner: str, errors: list[str]) -> None:
    streaming = getattr(guard, "streaming", "Disabled")
    if streaming not in GUARD_STREAMING:
        errors.append(
            f"{owner} guardrails.streaming 非法: {streaming!r}"
            f"（允许: {GUARD_STREAMING}）"
        )
    for phase in ("request", "response"):
        for index, item in enumerate(getattr(guard, phase, ())):
            label = f"{owner} guardrails.{phase}[{index}]"
            _validate_guard(item, label, errors)


def _validate_guard(item: GuardSpec, label: str, errors: list[str]) -> None:
    if item.kind not in GUARD_KINDS:
        errors.append(f"{label}.kind 非法: {item.kind!r}（允许: {GUARD_KINDS}）")
        return
    if item.rejection_status and not 400 <= item.rejection_status <= 599:
        errors.append(f"{label}.rejection.status 必须是 4xx/5xx")
    if item.kind == "webhook":
        if item.action not in WEBHOOK_GUARD_ACTIONS:
            errors.append(
                f"{label}.action 非法: {item.action!r}"
                f"（webhook 允许: {WEBHOOK_GUARD_ACTIONS}）"
            )
        if not item.webhook_target:
            errors.append(f"{label}.webhook_target 不能为空")
        elif "://" not in item.webhook_target:
            errors.append(f"{label}.webhook_target 必须是 http(s) 地址")
        if item.failure_mode not in WEBHOOK_FAILURE_MODES:
            errors.append(
                f"{label}.failure_mode 非法: {item.failure_mode!r}"
                f"（允许: {WEBHOOK_FAILURE_MODES}）"
            )
        if item.scope:
            errors.append(
                f"{label}.scope 不受 AG 1.7 webhook 护栏支持"
                "（webhook 固定检查 systemPrompt + messages）"
            )
        if item.rules:
            errors.append(f"{label}.rules 只能用于 regex 护栏，webhook 请置空")
        return
    if item.action not in GUARD_ACTIONS:
        errors.append(f"{label}.action 非法: {item.action!r}（允许: {GUARD_ACTIONS}）")
    for scope in item.scope:
        if scope not in GUARD_SCOPES:
            errors.append(f"{label}.scope 非法: {scope!r}（允许: {GUARD_SCOPES}）")
    if not item.rules:
        errors.append(f"{label}.rules 不能为空")
    for rule_index, rule in enumerate(item.rules):
        has_pattern = bool(rule.pattern)
        has_builtin = bool(rule.builtin)
        if has_pattern == has_builtin:
            errors.append(
                f"{label}.rules[{rule_index}] 必须且只能设置 pattern 或 builtin 之一"
            )
        if has_builtin and rule.builtin not in BUILTIN_GUARD_RULES:
            errors.append(
                f"{label}.rules[{rule_index}].builtin 非法: {rule.builtin!r}"
                f"（允许: {BUILTIN_GUARD_RULES}）"
            )


def _validate_mcp(ir: GatewayIR, errors: list[str]) -> None:
    mcp = ir.mcp
    if (mcp.targets or mcp.policies) and not mcp.supported:
        errors.append(
            "MCP 未声明支持却包含 targets/policies：拒绝渲染而不是静默丢弃"
            "（能力矩阵 mcp.targets=false）"
        )
    names = [target.name for target in mcp.targets]
    dup_names = _duplicates(names)
    if dup_names:
        errors.append(f"重复的 MCP target 名称: {', '.join(sorted(dup_names))}")
    for target in mcp.targets:
        if not target.name:
            errors.append("MCP target name 不能为空")
        if target.transport not in MCP_TRANSPORTS:
            errors.append(
                f"MCP target {target.name} transport 非法: {target.transport!r}"
                f"（允许: {MCP_TRANSPORTS}）"
            )
        elif target.transport == "stdio":
            if not target.cmd:
                errors.append(f"MCP target {target.name} stdio 必须提供 cmd")
            if target.url or target.host or target.port or target.path:
                errors.append(
                    f"MCP target {target.name} stdio 不接受 url/host/port/path"
                )
        else:
            if not target.host:
                errors.append(
                    f"MCP target {target.name} 必须提供 host"
                    "（AG 1.7 mcp.targets 没有 url 字段）"
                )
            if target.port and not target.path:
                errors.append(f"MCP target {target.name} port 必须与 path 成对出现")
            if target.path and not target.port:
                errors.append(f"MCP target {target.name} path 必须与 port 成对出现")
            if target.port and not 1 <= target.port <= 65535:
                errors.append(f"MCP target {target.name} port 必须在 1-65535")


def _duplicates(values: list[str]) -> set[str]:
    seen: set[str] = set()
    dupes: set[str] = set()
    for value in values:
        if value in seen:
            dupes.add(value)
        seen.add(value)
    return dupes
