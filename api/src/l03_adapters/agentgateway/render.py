"""Render GatewayIR into an agentgateway 1.7 config (no files written here).

ADR-024 M2: the client-facing surface migrates to the full-form gateway shape,
but model-name routing STAYS on llm.virtualModels. Reason (proved by the M2
probes + pinned 1.7 source): full-form routes only match path/method/query/
header/host - there is no request-body/model match, and one route maps to one
AI backend. Slipstream serves ONE base URL (/v1/chat/completions) and selects
the public model from the JSON body, so a pure routes/backends[].ai layout
would collapse every public model into one backend and break the contract.

Shapes verified against the pinned 1.7 binary with --validate-only:
- llm.providers[] is a SEQUENCE of {name, provider, params, defaults}; a map
  keyed by provider id is rejected ("invalid type: map, expected a sequence").
- llm.models[] is a SEQUENCE of {name, provider: {reference}, visibility,
  params: {model}, ...}; internal visibility keeps direct upstream names 404.
- ADR-026 多密钥平权: build_render_plan expands every upstream key into its own
  provider ({upstream_id}#{seq}) and its own {model}#k{seq} llm.models entry;
  virtualModels reference every key entry in one same-priority layer (E18).
  The renderer self-checks the no-duplicate-name invariant below because AG's
  validate silently collapses same-name entries.
- gateways.<name>.port + llm.gateways: <name> supersede the deprecated
  llm.port; the implicit LLM route is namespace internal, name "llm:request".
- Per-model tls.hostname is emitted for https upstreams; per-model health
  {unhealthyExpression, eviction} carries the 4xx marks (E16/E17).
- llm.virtualModels[] routes public names to llm.models[] names.
- llm.policies carries apiKey/localRateLimit/transformations/cors/timeout/
  guardrails (retry is NOT accepted there); localRateLimit is a SEQUENCE.
- retry is a TOP-LEVEL policies[] entry: {name, target: {route: {name:
  llm:request, namespace: internal}}, phase: route, policy: {retry}}.
- MCP is a TOP-LEVEL mcp section (targets + policies), never inside llm.

Capability matrix: anything agentgateway 1.7 cannot express raises ValueError
instead of being silently dropped (remoteRateLimit, modelAliases,
maxBufferSize, model-level conditional/response-body transforms, unsupported
MCP). Per-user prepaid balances are NOT rendered as buckets: 1.7 allows only
one maxTokens per rule (E12), so the control-plane ledger stays authoritative.

ADR-010 constraints kept: default response-header deletes are appended after
user rows; no implicit response.code condition is injected into user body rules.
"""

from __future__ import annotations

from urllib.parse import urlsplit

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
from l03_adapters.agentgateway import telemetry
from l03_adapters.agentgateway.ca_bundle import CA_BUNDLE_RELATIVE_PATH
from l03_adapters.agentgateway.deployment import get_deployment
from l03_adapters.agentgateway.transforms import compile_transforms
from l03_adapters.spi import Artifact, make_artifact
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
AUTH_NOTE = (
    "client auth failures return plain-text 401 'authentication failed' (E4); "
    "every provider MUST carry its own apiKey file - without it AG forwards the "
    "client Authorization header to the upstream verbatim (E17 security red line)"
)
FAILOVER_NOTE = (
    "failover priority is numeric SMALL first; equal priorities form one group, "
    "groups are tried in ascending order. Layer switching is P2C/probabilistic "
    "inside one group and never happens after the first response byte (a failed "
    "stream is truncated, E14/E17). In-request group switch needs retry + health "
    "marks (ADR-024)"
)
RETRY_NOTE = (
    "request retry renders as a route-level policies[] entry targeting the "
    "implicit LLM route (internal/llm:request); llm.policies rejects retry. "
    "4xx codes only switch layers together with health.eviction, and the switch "
    "happens on the attempt AFTER the mark (attempts >= 2, E16/E17)"
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


def _render_health(health) -> dict:
    """llm.models[].health {unhealthyExpression, eviction} (E16/E17 4xx triple)."""
    if not health.unhealthy_expression:
        raise ValueError(
            "policies.health 缺少 unhealthyExpression：AG 只配 eviction 不会驱逐"
            "（E16/E17 4xx 三件套）"
        )
    eviction: dict = {"consecutiveFailures": health.consecutive_failures}
    if health.duration:
        eviction["duration"] = health.duration
    if health.restore_health:
        eviction["restoreHealth"] = health.restore_health
    return {"unhealthyExpression": health.unhealthy_expression, "eviction": eviction}


def _render_model_tls(upstream) -> dict | None:
    """https upstreams render llm.models[].tls (E17 TLS finding).

    The pinned 1.7 TLS dial needs the SNI/verification hostname explicitly;
    full-form used backendTLS.hostname, the hybrid model surface uses tls.
    root is a config-relative CA bundle materialized by the adapter: the
    pinned binary does not use the Windows system store, so a real HTTPS
    upstream otherwise fails with UnknownIssuer.
    """
    parts = urlsplit(upstream.base_url)
    if parts.scheme != "https":
        return None
    if not parts.hostname:
        raise ValueError(
            f"上游 {upstream.id} base_url 缺少 host，无法渲染 tls.hostname: "
            f"{upstream.base_url!r}"
        )
    return {"hostname": parts.hostname, "root": CA_BUNDLE_RELATIVE_PATH}


def _render_route_retry(ir: GatewayIR) -> list[dict]:
    """Route-level retry policy for the implicit LLM route.

    AG 1.7 rejects llm.policies.retry; the pinned binary accepts retry on the
    route that serves /v1/chat/completions. Route identity from the request log:
    gateway default/default, listener default, route internal/llm:request.
    """
    retry = ir.policies.retry
    if retry is None:
        return []
    body: dict = {"attempts": retry.attempts, "codes": list(retry.codes)}
    if retry.backoff:
        body["backoff"] = retry.backoff
    if retry.precondition:
        body["precondition"] = retry.precondition
    if retry.condition:
        body["condition"] = retry.condition
    return [
        {
            "name": {"name": "gateway-retry", "namespace": "default"},
            "target": {"route": {"name": "llm:request", "namespace": "internal"}},
            "phase": "route",
            "policy": {"retry": body},
        }
    ]


def _key_file_reference(key_file: str) -> str:
    """IR credential reference -> the provider ``apiKey.file`` entry.

    The system hands over the neutral credential ref (``{upstream_id}#{seq}``,
    the same string as ``CredentialFile.ref``); this adapter owns the on-disk
    layout, so a bare ref resolves to the managed ``keys/<ref>.key`` reference.
    AG reads provider key files relative to the config file, which is exactly
    where ``credentials.materialize`` wrote the plaintext. An explicit
    path-shaped reference (adapter-side IR construction, golden fixtures)
    passes through verbatim.
    """
    if "/" in key_file or "\\" in key_file or key_file.endswith(".key"):
        return key_file
    return f"keys/{key_file}.key"


def _render_provider(upstream) -> dict:
    provider_name = PROVIDER_BY_API_STYLE.get(upstream.api_style)
    if provider_name is None:
        raise ValueError(f"unmapped api_style: {upstream.api_style}")
    entry: dict = {
        "name": upstream.id,
        "provider": provider_name,
        "params": {
            "baseUrl": upstream.base_url,
            "apiKey": {"file": _key_file_reference(upstream.key_file)},
        },
    }
    if upstream.extra_headers:
        entry["defaults"] = {
            "requestHeaders": {"set": {name: value for name, value in upstream.extra_headers}}
        }
    return entry


def _render_model(model, upstream, default_deletes: tuple[str, ...], health) -> dict:
    entry: dict = {
        "name": model.id,
        "provider": {"reference": model.upstream_id},
        "visibility": model.visibility,
        "params": {"model": model.upstream_model_name},
    }
    tls = _render_model_tls(upstream)
    if tls is not None:
        entry["tls"] = tls
    if health is not None:
        entry["health"] = _render_health(health)
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
    when unset. The database URL is adapter-owned (ADR-029 ticket 04): the
    system leaves it empty and this renderer falls back to the deployment
    namespace's log DB location, keeping the bootstrap guarantee (an unset
    switch still renders a log DB source).
    """
    access_log = ir.policies.access_log
    if access_log is None:
        return {}, {}
    url = access_log.database_url or get_deployment().render_log_db_url
    if not url:
        return {}, {}
    config_block: dict = {"logging": {"database": {"url": url}}}
    frontend: dict = {"accessLog": {"database": {"llm": access_log.llm}}}
    return config_block, frontend


def _render_tracing() -> dict:
    """Adapter-private OTLP export, emitted only while the adapter receiver runs.

    ADR-028: tracing is not a control-plane policy. The agentgateway adapter owns
    both ends of its own telemetry pipe, so the system only stores normalized
    RequestAttempt facts. E19 pinned the shape: frontendPolicies.tracing, one
    host:port endpoint, OTLP/HTTP, fixed path, and randomSampling as the STRING
    "true" (AG 1.7 defaults to false and silently emits no spans otherwise).
    """
    if not telemetry.export_enabled():
        return {}
    return {
        "tracing": {
            "host": f"{telemetry.TRACE_HOST}:{telemetry.trace_port()}",
            "protocol": "http",
            "path": telemetry.TRACE_PATH,
            "randomSampling": "true",
        }
    }


def _assert_no_duplicate_model_names(models: list[dict]) -> None:
    """E18 不变量：llm.models[] 禁止同名条目（渲染层自检）。

    AG 1.7 validate 对同名多条静默通过且运行时首条独占、其余静默丢弃（60:0，
    无告警）——这是不能依赖的语义，validate 也抓不住，所以控制面渲染层必须
    把关：发现同名即 ValueError（rollout 记为失败 revision，绝不带病下发）。
    """
    seen: set[str] = set()
    for entry in models:
        name = entry["name"]
        if name in seen:
            raise ValueError(
                f"llm.models[] 出现同名条目 {name!r}：AG 会静默塌缩为首条独占"
                "（E18 实测 60:0 无告警），渲染层拒绝下发；请检查密钥展开命名"
            )
        seen.add(name)


def render_config(ir: GatewayIR, llm_port: int) -> dict:
    """Full config.yaml body for the ADR-024 hybrid shape.

    Client-facing surface: gateways.default.port + llm.gateways (full-form
    gateway shape). Model routing/public names stay on llm.models/virtualModels
    (full-form routes cannot match the request-body model field). Retry is a
    route-level policies[] entry; health/TLS ride on each llm.models[] entry.
    mcp stays top-level; access log keeps config.logging + frontendPolicies.
    """
    config: dict = {
        "gateways": {"default": {"port": llm_port}},
        "llm": {"gateways": "default"},
    }
    providers: list[dict] = []
    upstream_by_id = {}
    for upstream in ir.upstreams:
        providers.append(_render_provider(upstream))
        upstream_by_id[upstream.id] = upstream
    telemetry.register_upstream_paths((u.id, u.base_url) for u in ir.upstreams)
    models: list[dict] = []
    for model in ir.models:
        upstream = upstream_by_id.get(model.upstream_id)
        if upstream is None:
            raise ValueError(f"上游模型 {model.id} 指向未渲染的上游 {model.upstream_id}")
        default_deletes = ir.policies.transforms_defaults.default_response_header_deletes
        models.append(
            _render_model(model, upstream, default_deletes, ir.policies.health)
        )
    if ir.model_aliases:
        raise ValueError(
            "AG 1.7 没有 modelAliases 配置面；请删除模型别名或改用 llm.virtualModels"
        )
    _assert_no_duplicate_model_names(models)
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

    route_policies = _render_route_retry(ir)
    if route_policies:
        config["policies"] = route_policies

    mcp = _render_mcp(ir.mcp)
    if mcp is not None:
        config["mcp"] = mcp
    logging_block, frontend_policies = _render_access_log(ir)
    frontend_policies.update(_render_tracing())
    if logging_block:
        config["config"] = logging_block
    if frontend_policies:
        config["frontendPolicies"] = frontend_policies
    return config


def render_artifact(ir: GatewayIR, llm_port: int) -> Artifact:
    """Render -> deterministic YAML artifact with constraint header comments.

    The listen port is a deployment fact of the driver (ADR-029 ticket 04): the
    adapter passes its own ``llm_port``, so system layers never supply it.
    """
    content = to_yaml(render_config(ir, llm_port), header_comments=render_comments(ir))
    return make_artifact(content, revision=ir.revision)


def render_comments(ir: GatewayIR) -> list[str]:
    """Artifact header comments: constraint notes (no timestamps, byte-stable)."""
    comments = [
        BALANCE_NOTE,
        AUTH_NOTE,
        FAILOVER_NOTE,
        f"transforms: {TRANSFORMS_NOTE}",
    ]
    if ir.policies.retry is not None:
        comments.append(f"retry: {RETRY_NOTE}")
    if ir.policies.health is not None:
        comments.append(
            "health: every model renders unhealthyExpression + eviction; "
            "expression-only health breaks eviction (E16/E17)"
        )
    for upstream in ir.upstreams:
        if upstream.transforms is not None:
            comments.append(f"transforms present on upstream {upstream.id}")
    if ir.mcp.targets:
        comments.append(f"mcp: {len(ir.mcp.targets)} top-level target(s); not inside llm")
    return comments
