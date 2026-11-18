"""Render GatewayIR into an agentgateway 1.7 config (no files written here).

Shapes verified against the pinned 1.7 binary with --validate-only:
- llm.providers[] is a SEQUENCE of {name, provider, params, defaults}; a map
  keyed by provider id is rejected ("invalid type: map, expected a sequence").
- llm.models[] is a SEQUENCE of {name, provider: {reference}, visibility,
  params: {model}, ...}; internal visibility keeps direct upstream names 404.
- llm.virtualModels[] routes public names to llm.models[] names.
- llm.policies carries apiKey/localRateLimit/transformations/cors/timeout/
  guardrails; localRateLimit is a SEQUENCE of rate rules.
- MCP is a TOP-LEVEL mcp section (targets + policies), never inside llm.

Capability matrix: anything agentgateway 1.7 cannot express raises ValueError
instead of being silently dropped (retry, remoteRateLimit, modelAliases,
maxBufferSize, model-level conditional/response-body transforms, unsupported
MCP). Per-user prepaid balances are NOT rendered as buckets: 1.7 allows only
one maxTokens per rule (E12), so the control-plane ledger stays authoritative.

ADR-010 constraints kept: default response-header deletes are appended after
user rows; no implicit response.code condition is injected into user body rules.
"""

from __future__ import annotations

from l02_domain.ir import (
    CorsPolicySpec,
    GatewayIR,
    HeaderRule,
    McpSpec,
    PromptCachingSpec,
    PromptGuardSpec,
    TransformsSpec,
    sort_targets,
)
from l03_adapters.agentgateway.transforms import compile_transforms
from l03_adapters.spi import make_artifact
from l03_adapters.yaml_dumps import to_yaml

PROVIDER_BY_API_STYLE = {
    "openai_chat": "openai",
    "openai_responses": "openai",
    "anthropic_messages": "anthropic",
    "gemini": "gemini",
}

BALANCE_NOTE = (
    "rate limits are global request/token rules; limiter state resets on restart. "
    "Per-user prepaid balances are NOT rendered as buckets - AG 1.7 has one "
    "maxTokens per rule (E12), so the control-plane ledger is authoritative"
)
AUTH_NOTE = "client auth failures return plain-text 401 'authentication failed' (E4)"
FAILOVER_NOTE = (
    "failover priority is numeric SMALL first; equal priorities form one group, "
    "groups are tried in ascending order. failover affects SUBSEQUENT requests "
    "only, never in-request retries (E1)"
)
TRANSFORMS_NOTE = (
    "request transforms mount on llm.models[].requestTransformation; response "
    "header rules on llm.models[].responseHeaders; only the global "
    "llm.policies.transformations surface carries conditional rows"
)


def with_default_actions(transforms: TransformsSpec | None) -> TransformsSpec:
    """Compose ADR-010 default response-header deletes onto stored rules."""
    spec = transforms if transforms is not None else TransformsSpec()
    builtins = (
        HeaderRule(op="delete", name="server"),
        HeaderRule(op="delete", name="x-powered-by"),
    )
    return TransformsSpec(
        request_headers=spec.request_headers,
        request_body=spec.request_body,
        response_headers=spec.response_headers + builtins,
        response_body=spec.response_body,
    )


def _render_cors(cors: CorsPolicySpec) -> dict:
    out: dict = {}
    if cors.allow_origins:
        out["allowOrigins"] = list(cors.allow_origins)
    if cors.allow_credentials:
        out["allowCredentials"] = True
    if cors.allow_methods:
        out["allowMethods"] = list(cors.allow_methods)
    if cors.allow_headers:
        out["allowHeaders"] = list(cors.allow_headers)
    if cors.expose_headers:
        out["exposeHeaders"] = list(cors.expose_headers)
    if cors.max_age is not None:
        # CorsSerde.maxAge is a duration string in AG 1.7 (600s, not 600).
        out["maxAge"] = f"{cors.max_age}s"
    return out


def _render_rejection(item) -> dict:
    rejection: dict = {}
    if item.rejection_body:
        rejection["body"] = item.rejection_body
    if item.rejection_status:
        rejection["status"] = item.rejection_status
    return rejection


def _render_guard(item) -> dict:
    if getattr(item, "kind", "regex") == "webhook":
        # AG 1.7 webhook guard: host-only target, reject/audit, failureMode.
        # scope is rejected by the binary (always systemPrompt + messages).
        entry: dict = {
            "webhook": {
                "target": {"host": item.webhook_target},
                "action": item.action,
                "failureMode": item.failure_mode,
            }
        }
        rejection = _render_rejection(item)
        if rejection:
            entry["rejection"] = rejection
        return entry
    rules = []
    for rule in item.rules:
        rules.append({"pattern": rule.pattern} if rule.pattern else {"builtin": rule.builtin})
    entry = {"regex": {"action": item.action, "rules": rules}}
    if item.scope:
        entry["scope"] = list(item.scope)
    rejection = _render_rejection(item)
    if rejection:
        entry["rejection"] = rejection
    return entry


def _render_guardrails(guard: PromptGuardSpec) -> dict:
    out: dict = {}
    if guard.streaming != "Disabled":
        out["streaming"] = guard.streaming
    for phase in ("request", "response"):
        items = getattr(guard, phase)
        if items:
            out[phase] = [_render_guard(item) for item in items]
    return out


def _render_prompt_caching(cache: PromptCachingSpec) -> dict:
    out: dict = {}
    if cache.cache_system:
        out["cacheSystem"] = True
    if cache.cache_messages:
        out["cacheMessages"] = True
    if cache.cache_tools:
        out["cacheTools"] = True
    if cache.min_tokens:
        out["minTokens"] = cache.min_tokens
    if cache.cache_message_offset:
        out["cacheMessageOffset"] = cache.cache_message_offset
    return out


def _model_transforms(upstream) -> tuple[dict, dict]:
    """Compile one upstream's rules into model-level AG surfaces.

    agentgateway 1.7 llm.models[] has requestTransformation (LocalTransform) and
    responseHeaders (HeaderModifier) but no conditional list and no response
    body surface. Those cases are capability errors, not silent drops.
    """
    if upstream.transforms is None:
        return {}, {}
    compiled = compile_transforms(upstream.transforms)
    if compiled.get("conditional"):
        raise ValueError(
            "AG 1.7 的 llm.models[].requestTransformation/responseHeaders 不支持 "
            f"conditional 规则（上游 {upstream.id}）；请改配全局 llm.policies.transformations"
        )
    request = compiled.get("request") or {}
    response = compiled.get("response") or {}
    if "body" in response:
        raise ValueError(
            "AG 1.7 的 llm.models[].responseHeaders 不能表达 response_body 规则"
            f"（上游 {upstream.id}）；请移到全局 llm.policies.transformations"
        )
    return request, response


def _global_transformations(ir: GatewayIR) -> dict:
    """Operator global rules, conditional allowed.

    AG 1.7 parses llm.policies.transformations as an untagged enum: either
    request/response OR conditional, never both (--validate-only rejects the
    mix). Default header deletes live on each model instead, so a conditional
    policy block stays valid. Mixing the two is an explicit capability error.
    """
    spec = ir.policies.global_transformations
    if spec is None:
        return {}
    compiled = compile_transforms(spec)
    if compiled.get("conditional") and (compiled.get("request") or compiled.get("response")):
        raise ValueError(
            "AG 1.7 的 llm.policies.transformations 不能同时包含 request/response 与 "
            "conditional（--validate-only 拒绝）；请拆成模型级 requestTransformation/"
            "responseHeaders + 仅 conditional 的全局策略"
        )
    return compiled


def _render_provider(upstream) -> dict:
    provider_name = PROVIDER_BY_API_STYLE.get(upstream.api_style)
    if provider_name is None:
        raise ValueError(f"unmapped api_style: {upstream.api_style}")
    entry: dict = {
        "name": upstream.id,
        "provider": provider_name,
        "params": {"baseUrl": upstream.base_url, "apiKey": {"file": upstream.key_file}},
    }
    if upstream.extra_headers:
        entry["defaults"] = {
            "requestHeaders": {"set": {name: value for name, value in upstream.extra_headers}}
        }
    return entry


def _render_model(model, upstream, default_deletes: tuple[str, ...]) -> dict:
    entry: dict = {
        "name": model.id,
        "provider": {"reference": model.upstream_id},
        "visibility": model.visibility,
        "params": {"model": model.upstream_model_name},
    }
    if model.display_name:
        raise ValueError(
            f"AG 1.7 的 llm.models[] 没有 displayName 字段（--validate-only: unknown field）；"
            f"上游模型 {model.id} 的展示名无法渲染"
        )
    if model.aliases:
        raise ValueError(
            f"AG 1.7 没有 modelAliases 配置面，上游模型 {model.id} 的 aliases 无法渲染"
        )
    request, response = _model_transforms(upstream)
    if request:
        entry["requestTransformation"] = request
    # ADR-010 #1 defaults are appended after user response-header rows so user
    # fallbacks stay ahead. This also keeps the global policy block free of a
    # response key when the operator needs conditional-only transformations.
    remove = list(response.get("remove", ()))
    for name in default_deletes:
        if name not in remove:
            remove.append(name)
    response["remove"] = remove
    entry["responseHeaders"] = response
    if model.guardrails is not None:
        entry["guardrails"] = _render_guardrails(model.guardrails)
    if model.prompt_caching is not None:
        caching = _render_prompt_caching(model.prompt_caching)
        if caching:
            entry["promptCaching"] = caching
    return entry


def _routing_entry(public, target) -> dict:
    model_name = target.upstream_model_id
    if public.routing_mode == "weighted":
        return {"model": model_name, "weight": target.weight}
    if public.routing_mode == "conditional":
        entry = {"model": model_name}
        if target.when:
            entry["when"] = target.when
        return entry
    return {"model": model_name, "priority": target.priority}


def _render_virtual_models(ir: GatewayIR, model_ids: set[str]) -> list[dict]:
    virtual_models: list[dict] = []
    for public in ir.public_models:
        if not public.targets:
            continue  # invariant: a public model with no targets is never rendered
        if public.routing_mode == "failover":
            # ADR-014/AG 1.7: numeric small first; sorted() is stable, so equal
            # priorities keep their builder order inside one group.
            ordered = sort_targets(public.targets)
        else:
            ordered = public.targets  # weighted ratio / conditional predicate order
        chain: list[dict] = []
        for target in ordered:
            if target.upstream_model_id not in model_ids:
                raise ValueError(
                    f"对外模型 {public.name} 目标 {target.id} 指向未渲染的上游模型 "
                    f"{target.upstream_model_id}"
                )
            chain.append(_routing_entry(public, target))
        routing = {public.routing_mode: {"targets": chain}}
        virtual_models.append({"name": public.name, "routing": routing})
    return virtual_models


def _render_api_key_policy(ir: GatewayIR) -> dict | None:
    if not ir.policies.api_key.enabled:
        return None
    enabled = [key for key in ir.api_keys if key.enabled]
    if not enabled:
        return None
    return {
        "mode": ir.policies.api_key.mode,
        "keys": [
            {
                "keyHash": key.key_hash,
                "metadata": {
                    "name": key.id,
                    "key_id": key.id,
                    "user_id": key.user_id,
                },
            }
            for key in enabled
        ],
    }


def _render_rate_limits(ir: GatewayIR) -> list[dict]:
    limits = ir.limits
    if limits is None:
        return []
    entries: list[dict] = []
    key_expr = "apiKey.metadata.user_id"
    if limits.requests_per_minute:
        entries.append(
            {
                "key": key_expr,
                "type": "requests",
                "maxTokens": limits.requests_per_minute,
                "fillInterval": "1m",
            }
        )
    if limits.tokens_per_minute:
        entries.append(
            {
                "key": key_expr,
                "type": "tokens",
                "maxTokens": limits.tokens_per_minute,
                "fillInterval": "1m",
            }
        )
    return entries


def _render_mcp(mcp: McpSpec) -> dict | None:
    if not mcp.targets and mcp.policies is None:
        return None
    if not mcp.supported:
        raise ValueError(
            "MCP 未声明支持却包含 targets/policies：AG 适配器拒绝渲染（能力矩阵 "
            "mcp.targets=false），不会静默丢弃"
        )
    out: dict = {}
    if mcp.port is not None:
        out["port"] = mcp.port
    if mcp.targets:
        targets: list[dict] = []
        for target in mcp.targets:
            if target.transport == "http":
                raise ValueError(
                    f"AG 1.7 pinned binary 拒绝 http MCP target（{target.name}）："
                    "只支持 sse/stdio，能力矩阵 mcp.transport.http=false"
                )
            if target.url:
                raise ValueError(
                    f"AG 1.7 的 mcp.targets 使用 host、不接受 url（{target.name}）"
                )
            transport: dict = {}
            if target.transport == "stdio":
                transport["cmd"] = target.cmd
                if target.args:
                    transport["args"] = list(target.args)
                if target.env:
                    transport["env"] = dict(target.env)
            else:
                if target.host:
                    transport["host"] = target.host
                if target.port:
                    transport["port"] = target.port
                if target.path:
                    transport["path"] = target.path
            targets.append({"name": target.name, target.transport: transport})
        out["targets"] = targets
    if mcp.policies is not None and mcp.policies.cors is not None:
        cors = _render_cors(mcp.policies.cors)
        if cors:
            out["policies"] = {"cors": cors}
    return out


def _render_access_log(ir: GatewayIR) -> tuple[dict, dict]:
    """ADR-021: (config.logging block, frontendPolicies block) for the log switch.

    AG shapes (schema-config.json + --validate-only evidence): the SQLite log
    store is enabled by the top-level `config:` block (RawConfig) at
    config.logging.database.url; frontendPolicies.accessLog.database.llm
    selects `metadata` (no prompt/completion bodies in the payload table) or
    `full`. llm is emitted explicitly in both modes because AG's omitted-field
    legacy behavior would keep storing captured content. Nothing is rendered
    when unset.
    """
    access_log = ir.policies.access_log
    if access_log is None or not access_log.database_url:
        return {}, {}
    config_block: dict = {"logging": {"database": {"url": access_log.database_url}}}
    frontend: dict = {"accessLog": {"database": {"llm": access_log.llm}}}
    return config_block, frontend


def render_config(ir: GatewayIR, llm_port: int) -> dict:
    """Full config.yaml body: llm section plus optional top-level mcp."""
    config: dict = {"llm": {"port": llm_port}}
    providers: list[dict] = []
    upstream_by_id = {}
    for upstream in ir.upstreams:
        providers.append(_render_provider(upstream))
        upstream_by_id[upstream.id] = upstream
    models: list[dict] = []
    for model in ir.models:
        upstream = upstream_by_id.get(model.upstream_id)
        if upstream is None:
            raise ValueError(f"上游模型 {model.id} 指向未渲染的上游 {model.upstream_id}")
        default_deletes = ir.policies.transforms_defaults.default_response_header_deletes
        models.append(_render_model(model, upstream, default_deletes))
    if ir.model_aliases:
        raise ValueError(
            "AG 1.7 没有 modelAliases 配置面；请删除模型别名或改用 llm.virtualModels"
        )
    model_ids = {model.id for model in ir.models}
    virtual_models = _render_virtual_models(ir, model_ids)

    policies: dict = {}
    api_key = _render_api_key_policy(ir)
    if api_key is not None:
        policies["apiKey"] = api_key
    rate_limits = _render_rate_limits(ir)
    if rate_limits:
        policies["localRateLimit"] = rate_limits
    if ir.policies.data_plane_cors is not None:
        cors = _render_cors(ir.policies.data_plane_cors)
        if cors:
            policies["cors"] = cors
    if ir.policies.timeout is not None:
        timeout = {
            key: value
            for key, value in (
                ("requestTimeout", ir.policies.timeout.request_timeout),
                ("backendRequestTimeout", ir.policies.timeout.backend_request_timeout),
                ("responseIdleTimeout", ir.policies.timeout.response_idle_timeout),
            )
            if value
        }
        if timeout:
            policies["timeout"] = timeout
    if ir.policies.guardrails is not None:
        guardrails = _render_guardrails(ir.policies.guardrails)
        if guardrails:
            policies["guardrails"] = guardrails
    transformations = _global_transformations(ir)
    if transformations:
        policies["transformations"] = transformations
    if ir.policies.retry is not None:
        raise ValueError(
            "AG 1.7 的 llm.policies 拒绝 retry（unknown field）：该能力未验证，"
            "请关闭请求级重试（能力矩阵 policies.retry=false）"
        )
    if ir.policies.remote_rate_limit is not None:
        raise ValueError(
            "AG 1.7 的 llm.policies 没有 remoteRateLimit 的安全配置面："
            "拒绝渲染而不是静默丢弃"
        )
    config["llm"]["providers"] = providers
    config["llm"]["models"] = models
    config["llm"]["virtualModels"] = virtual_models
    if policies:
        config["llm"]["policies"] = policies

    mcp = _render_mcp(ir.mcp)
    if mcp is not None:
        config["mcp"] = mcp
    logging_block, frontend_policies = _render_access_log(ir)
    if logging_block:
        config["config"] = logging_block
    if frontend_policies:
        config["frontendPolicies"] = frontend_policies
    return config


def render_artifact(ir: GatewayIR, llm_port: int | None = None):
    """Render -> deterministic YAML artifact with constraint header comments."""
    from l01_core.settings import get_settings

    settings = get_settings()
    port = llm_port if llm_port is not None else settings.ag_llm_port
    content = to_yaml(render_config(ir, port), header_comments=render_comments(ir))
    return make_artifact(content, revision=ir.revision)


def render_comments(ir: GatewayIR) -> list[str]:
    """Artifact header comments: constraint notes (no timestamps, byte-stable)."""
    comments = [
        BALANCE_NOTE,
        AUTH_NOTE,
        FAILOVER_NOTE,
        f"transforms: {TRANSFORMS_NOTE}",
    ]
    for upstream in ir.upstreams:
        if upstream.transforms is not None:
            comments.append(f"transforms present on upstream {upstream.id}")
    if ir.mcp.targets:
        comments.append(f"mcp: {len(ir.mcp.targets)} top-level target(s); not inside llm")
    return comments
