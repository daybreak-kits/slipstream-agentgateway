"""Editable policy/guardrail/MCP configuration: storage, IR mapping, validation.

The admin pages edit three JSON documents in app_settings. This module is the
single translator from those documents to the typed IR blocks, so the API's
"effective" preview and the render path cannot diverge. Unsupported fields are
rejected by the IR/adapter validation (422 at the API boundary), never dropped.

Storage keys are plain app_settings rows; no schema migration is needed.
"""

from __future__ import annotations

import copy
import json
from dataclasses import replace

from sqlalchemy.orm import Session

from l01_core.cors import cors_origins
from l01_core.timeutil import now_ms
from l02_domain.ir import (
    ApiKeyPolicySpec,
    CorsPolicySpec,
    GatewayIR,
    GuardrailsSpec,
    GuardSpec,
    LimitsSpec,
    McpPolicySpec,
    McpSpec,
    McpTargetSpec,
    PoliciesSpec,
    PromptGuardSpec,
    RegexRuleSpec,
    RetryPolicySpec,
    TimeoutPolicySpec,
    TransformsPolicySpec,
)
from l02_domain.validation import ValidationResult, validate_gateway_ir
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import AppSettingORM
from l04_repo.repository import put_setting
from l05_service.policies import guardrails_spec, mcp_spec, policies_spec

POLICY_KEY = "policy_config"
GUARDRAIL_KEY = "guardrail_config"
MCP_KEY = "mcp_config"

DEFAULT_POLICY_CONFIG: dict = {
    "cors": {
        "enabled": False,
        "allow_origins": list(cors_origins()),
        "allow_credentials": False,
        "expose_headers": ["x-request-id"],
        "allow_methods": [],
        "allow_headers": [],
        "max_age": None,
    },
    "api_key": {"enabled": True, "mode": "strict"},
    "local_rate_limit": {"requests_per_minute": None, "tokens_per_minute": None},
    "timeout": {
        "request_timeout": "",
        "backend_request_timeout": "",
        "response_idle_timeout": "",
    },
    "transformations": {
        "default_response_header_deletes": ["server", "x-powered-by"],
        "protected_request_headers": list(
            TransformsPolicySpec().protected_request_headers
        ),
    },
    "retry": None,
}

DEFAULT_GUARDRAIL_CONFIG: dict = {
    "streaming": "Disabled",
    "request": [],
    "response": [],
}

DEFAULT_MCP_CONFIG: dict = {"servers": [], "port": None}


def _default(base: dict) -> dict:
    return copy.deepcopy(base)


def _merge(base: dict, stored: dict) -> dict:
    """Shallow-per-section merge so an older stored document gains new keys."""
    out = _default(base)
    for key, value in stored.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key].update(value)
        else:
            out[key] = value
    return out


def _load(session: Session, key: str, default: dict) -> tuple[dict, int]:
    row = session.get(AppSettingORM, key)
    if row is None:
        return _default(default), 0
    try:
        stored = json.loads(row.value_json)
    except (TypeError, ValueError):
        return _default(default), row.updated_at_ms
    if not isinstance(stored, dict):
        return _default(default), row.updated_at_ms
    return _merge(default, stored), row.updated_at_ms


def load_policy_config(session: Session) -> tuple[dict, int]:
    return _load(session, POLICY_KEY, DEFAULT_POLICY_CONFIG)


def load_guardrail_config(session: Session) -> tuple[dict, int]:
    return _load(session, GUARDRAIL_KEY, DEFAULT_GUARDRAIL_CONFIG)


def load_mcp_config(session: Session) -> tuple[dict, int]:
    return _load(session, MCP_KEY, DEFAULT_MCP_CONFIG)


def save_policy_config(session: Session, config: dict) -> int:
    timestamp = now_ms()
    put_setting(
        session, POLICY_KEY, json.dumps(config, ensure_ascii=False, sort_keys=True), timestamp
    )
    return timestamp


def save_guardrail_config(session: Session, config: dict) -> int:
    timestamp = now_ms()
    put_setting(
        session,
        GUARDRAIL_KEY,
        json.dumps(config, ensure_ascii=False, sort_keys=True),
        timestamp,
    )
    return timestamp


def save_mcp_config(session: Session, config: dict) -> int:
    timestamp = now_ms()
    put_setting(
        session, MCP_KEY, json.dumps(config, ensure_ascii=False, sort_keys=True), timestamp
    )
    return timestamp


def reset_config(session: Session, key: str) -> None:
    row = session.get(AppSettingORM, key)
    if row is not None:
        session.delete(row)
        session.flush()


def _cors_spec(config: dict) -> CorsPolicySpec:
    return CorsPolicySpec(
        allow_origins=tuple(config.get("allow_origins") or ()),
        allow_credentials=bool(config.get("allow_credentials")),
        expose_headers=tuple(config.get("expose_headers") or ()),
        allow_methods=tuple(config.get("allow_methods") or ()),
        allow_headers=tuple(config.get("allow_headers") or ()),
        max_age=config.get("max_age"),
    )


def policies_spec_from_config(config: dict) -> PoliciesSpec:
    """Translate the editable policy document into the IR policy block."""
    cors = config.get("cors") or {}
    api_key = config.get("api_key") or {}
    timeout = config.get("timeout") or {}
    transforms = config.get("transformations") or {}
    timeout_values = (
        timeout.get("request_timeout") or "",
        timeout.get("backend_request_timeout") or "",
        timeout.get("response_idle_timeout") or "",
    )
    base = policies_spec()
    return replace(
        base,
        api_key=ApiKeyPolicySpec(
            enabled=bool(api_key.get("enabled", True)),
            mode=str(api_key.get("mode") or "strict"),
        ),
        transforms_defaults=replace(
            base.transforms_defaults,
            default_response_header_deletes=tuple(
                transforms.get("default_response_header_deletes")
                or base.transforms_defaults.default_response_header_deletes
            ),
            protected_request_headers=tuple(
                transforms.get("protected_request_headers")
                or base.transforms_defaults.protected_request_headers
            ),
        ),
        data_plane_cors=_cors_spec(cors) if cors.get("enabled") else None,
        timeout=TimeoutPolicySpec(*timeout_values) if any(timeout_values) else None,
        retry=_retry_spec(config.get("retry")),
    )


def _retry_spec(raw: object) -> RetryPolicySpec | None:
    if not raw:
        return None
    if not isinstance(raw, dict):
        return RetryPolicySpec()
    return RetryPolicySpec(
        attempts=int(raw.get("attempts", 1)),
        backoff=str(raw.get("backoff") or ""),
        codes=tuple(int(code) for code in raw.get("codes") or (502, 503, 504)),
        precondition=str(raw.get("precondition") or ""),
        condition=str(raw.get("condition") or ""),
    )


def limits_from_config(config: dict) -> LimitsSpec | None:
    limits = config.get("local_rate_limit") or {}
    requests = limits.get("requests_per_minute")
    tokens = limits.get("tokens_per_minute")
    if requests is None and tokens is None:
        return None
    return LimitsSpec(requests_per_minute=requests, tokens_per_minute=tokens)


def _guard_spec(raw: dict) -> GuardSpec:
    rules = tuple(
        RegexRuleSpec(
            pattern=str(rule.get("pattern") or ""),
            builtin=str(rule.get("builtin") or ""),
        )
        for rule in raw.get("rules") or ()
    )
    return GuardSpec(
        action=str(raw.get("action") or "mask"),
        rules=rules,
        scope=tuple(raw.get("scope") or ()),
        rejection_status=int(raw.get("rejection_status") or 0),
        rejection_body=str(raw.get("rejection_body") or ""),
        kind=str(raw.get("kind") or "regex"),
        webhook_target=str(raw.get("webhook_target") or ""),
        failure_mode=str(raw.get("failure_mode") or "failClosed"),
    )


def prompt_guard_from_config(config: dict) -> PromptGuardSpec:
    return PromptGuardSpec(
        streaming=str(config.get("streaming") or "Disabled"),
        request=tuple(_guard_spec(item) for item in config.get("request") or ()),
        response=tuple(_guard_spec(item) for item in config.get("response") or ()),
    )


def mcp_spec_from_config(config: dict, adapter: DataPlaneAdapter | None) -> McpSpec:
    base = mcp_spec(adapter)
    targets = tuple(
        McpTargetSpec(
            name=str(server.get("name") or ""),
            transport=str(server.get("transport") or "sse"),
            url=str(server.get("url") or ""),
            host=str(server.get("host") or ""),
            port=int(server.get("port") or 0),
            path=str(server.get("path") or ""),
            cmd=str(server.get("cmd") or ""),
            args=tuple(str(arg) for arg in server.get("args") or ()),
            env=tuple(
                (str(key), str(value))
                for key, value in (server.get("env") or {}).items()
            ),
        )
        for server in config.get("servers") or ()
    )
    policies = None
    cors = (config.get("policies") or {}).get("cors")
    if cors is not None:
        policies = McpPolicySpec(cors=_cors_spec(cors))
    return replace(
        base,
        servers=tuple(target.name for target in targets),
        targets=targets,
        policies=policies,
        port=config.get("port"),
    )


def _ir_for_validation(
    policy_config: dict,
    guardrail_config: dict,
    mcp_config: dict,
    adapter: DataPlaneAdapter | None,
) -> GatewayIR:
    policies = replace(
        policies_spec_from_config(policy_config),
        guardrails=prompt_guard_from_config(guardrail_config),
    )
    return GatewayIR(
        revision="validate",
        upstreams=(),
        models=(),
        public_models=(),
        api_keys=(),
        limits=limits_from_config(policy_config),
        policies=policies,
        mcp=mcp_spec_from_config(mcp_config, adapter),
    )


def validate_configuration(
    *,
    policy_config: dict,
    guardrail_config: dict,
    mcp_config: dict,
    adapter: DataPlaneAdapter | None,
) -> ValidationResult:
    """Full dry-run: generic IR rules + adapter validate + render.

    A save must never store a document the next apply would reject. The render
    step catches surfaces only the renderer refuses (e.g. http MCP targets).
    """
    ir = _ir_for_validation(policy_config, guardrail_config, mcp_config, adapter)
    base = validate_gateway_ir(ir)
    errors = list(base.errors)
    warnings = list(base.warnings)
    if adapter is None:
        errors.append("没有可用的数据面适配器，拒绝保存未经校验的配置")
    else:
        result = adapter.validate(ir)
        errors.extend(result.errors)
        warnings.extend(result.warnings)
        try:
            adapter.render(ir)
        except ValueError as exc:
            errors.append(str(exc))
    unique = list(dict.fromkeys(errors))
    unique_warnings = list(dict.fromkeys(warnings))
    return ValidationResult(
        ok=not unique, errors=tuple(unique), warnings=tuple(unique_warnings)
    )


def capability(adapter: DataPlaneAdapter | None, key: str) -> dict:
    if adapter is None:
        return {"supported": False, "verified": False, "since_version": "", "note": "无适配器"}
    capabilities = {cap.key: cap for cap in adapter.describe().capabilities}
    cap = capabilities.get(key)
    if cap is None:
        return {"supported": False, "verified": False, "since_version": "", "note": "未声明"}
    return {
        "supported": cap.supported,
        "verified": cap.verified,
        "since_version": cap.since_version,
        "note": cap.note,
    }


def policy_capabilities(adapter: DataPlaneAdapter | None) -> dict:
    return {
        "cors": capability(adapter, "policies.cors"),
        "api_key": capability(adapter, "policies.apiKey.strict"),
        "local_rate_limit": capability(adapter, "policies.localRateLimit.global"),
        "timeout": capability(adapter, "policies.timeout"),
        "transformations": capability(adapter, "policies.transformations.conditional"),
        "retry": capability(adapter, "policies.retry"),
        "guardrails_regex": capability(adapter, "policies.guardrails.regex"),
        "guardrails_webhook": capability(adapter, "policies.guardrails.webhook"),
    }


def mcp_capabilities(adapter: DataPlaneAdapter | None) -> dict:
    return {
        transport: capability(adapter, f"mcp.transport.{transport}")
        for transport in ("sse", "stdio", "http")
    }


def policy_effective(config: dict) -> dict:
    """Human-readable preview of what the data plane will receive."""
    spec = policies_spec_from_config(config)
    limits = limits_from_config(config)
    rate = spec.local_rate_limit
    return {
        "cors": {
            "enabled": spec.data_plane_cors is not None,
            "allow_origins": list(spec.data_plane_cors.allow_origins)
            if spec.data_plane_cors
            else [],
            "allow_credentials": bool(
                spec.data_plane_cors and spec.data_plane_cors.allow_credentials
            ),
        },
        "key_auth": {
            "enabled": spec.api_key.enabled,
            "mode": spec.api_key.mode,
            "scheme": spec.api_key.scheme,
            "storage": "unsalted sha256(key) key_hash（E11）",
            "failure": spec.api_key.failure,
        },
        "local_rate_limit": {
            "key": rate.key,
            "type": rate.type,
            "requests_per_minute": limits.requests_per_minute if limits else None,
            "tokens_per_minute": limits.tokens_per_minute if limits else None,
            "semantics": rate.semantics,
        },
        "transforms_defaults": {
            "response_header_deletes": list(
                spec.transforms_defaults.default_response_header_deletes
            ),
            "protected_request_headers": sorted(
                spec.transforms_defaults.protected_request_headers
            ),
            "body_editable_paths": spec.transforms_defaults.body_editable_paths,
        },
        "routing": {
            "modes": list(spec.routing_modes),
            "note": "priority 数值小者优先；weighted 按权重比例；conditional 用 CEL 兜底",
        },
        "timeout": (
            {
                "request_timeout": spec.timeout.request_timeout,
                "backend_request_timeout": spec.timeout.backend_request_timeout,
                "response_idle_timeout": spec.timeout.response_idle_timeout,
            }
            if spec.timeout
            else None
        ),
        "guardrails": {
            "streaming": spec.guardrails.streaming if spec.guardrails else "Disabled",
            "request": len(spec.guardrails.request) if spec.guardrails else 0,
            "response": len(spec.guardrails.response) if spec.guardrails else 0,
        },
        "retry": None,
    }


def stored_policy_blocks(
    session: Session, adapter: DataPlaneAdapter | None
) -> tuple[PoliciesSpec, GuardrailsSpec, McpSpec, LimitsSpec | None]:
    """Read all three documents and return the IR blocks plus global limits."""
    policy_config, _ = load_policy_config(session)
    guardrail_config, _ = load_guardrail_config(session)
    mcp_config, _ = load_mcp_config(session)
    policies = replace(
        policies_spec_from_config(policy_config),
        guardrails=prompt_guard_from_config(guardrail_config),
    )
    return (
        policies,
        guardrails_spec(adapter),
        mcp_spec_from_config(mcp_config, adapter),
        limits_from_config(policy_config),
    )


__all__ = [
    "DEFAULT_GUARDRAIL_CONFIG",
    "DEFAULT_MCP_CONFIG",
    "DEFAULT_POLICY_CONFIG",
    "GUARDRAIL_KEY",
    "MCP_KEY",
    "POLICY_KEY",
    "capability",
    "limits_from_config",
    "load_guardrail_config",
    "load_mcp_config",
    "load_policy_config",
    "mcp_capabilities",
    "mcp_spec_from_config",
    "policy_capabilities",
    "policy_effective",
    "policies_spec_from_config",
    "prompt_guard_from_config",
    "reset_config",
    "save_guardrail_config",
    "save_mcp_config",
    "save_policy_config",
    "stored_policy_blocks",
    "validate_configuration",
]
