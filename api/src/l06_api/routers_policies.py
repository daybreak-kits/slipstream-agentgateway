"""Editable policies, guardrails and MCP servers (ticket 11).

Every write is dry-run validated through the same IR -> adapter pipeline the
apply path uses: generic IR rules + adapter capability checks + render. A
document that would fail apply is rejected with 422 and never stored. Saving
does not apply; the UI then calls POST /admin/config/apply, so the operator
sees the resulting revision in the normal rollout history.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l04_repo.orm import ApiKeyORM, PublicModelORM, UpstreamORM, UserORM
from l05_service.policies import GUARDRAILS_NOTE, guardrails_spec, mcp_spec
from l05_service.policy_store import (
    DEFAULT_GUARDRAIL_CONFIG,
    DEFAULT_MCP_CONFIG,
    DEFAULT_POLICY_CONFIG,
    GUARDRAIL_KEY,
    POLICY_KEY,
    capability,
    load_guardrail_config,
    load_mcp_config,
    load_policy_config,
    mcp_capabilities,
    mcp_spec_from_config,
    policy_capabilities,
    policy_effective,
    reset_config,
    save_guardrail_config,
    save_mcp_config,
    save_policy_config,
    validate_configuration,
)
from l06_api.adapter_factory import make_adapter
from l06_api.deps import require, session_of
from l06_api.schemas import (
    GuardrailConfigIn,
    GuardrailItemOut,
    McpConfig,
    McpServerIn,
    PolicyConfigIn,
    PolicyCountsOut,
)

router = APIRouter(tags=["policies"])

NOTES = {
    "cors": (
        "控制面 CORS 由 SLIPSTREAM_CORS_ORIGINS 决定；"
        "此处的 enabled 控制数据面 llm.policies.cors"
    ),
    "api_key": "enabled=false 表示数据面匿名放行（不渲染 llm.policies.apiKey），密钥仍保留在台账",
    "rate_limit": "请求级限流为全局规则；预付费余额由控制面账本执行，不渲染逐用户桶（E12）",
    "timeout": "humantime 字符串（如 60s/500ms）；留空表示不渲染该字段",
    "retry": (
        "请求内重试渲染为顶层 policies[]（target route internal/llm:request），"
        "attempts 为首次之后的尝试次数（>=2 才能跨层 failover）；"
        "codes 含 4xx 时必须同时配置 health（unhealthy_expression + consecutive_failures）"
    ),
    "health": (
        "逐模型健康标记与驱逐（llm.models[].health）；"
        "表达式单独配置不会驱逐主层（E16/E17），必须带 consecutive_failures >= 1"
    ),
    "transformations": "默认响应头删除按 ADR-010 追加在用户规则之后；保护头仅控制面记录",
    "guardrails_webhook": "webhook 护栏仅 reject/audit，target 只能是 host（无路径），不支持 scope",
    "mcp_http": "pinned AG 1.7 拒绝 http 变体；只支持 sse/stdio，http 会在保存时被 422 拒绝",
}


def _counts(session: Session) -> PolicyCountsOut:
    """Row counts the policies page shows; one query per table, no joins."""
    return PolicyCountsOut(
        upstreams=session.scalar(select(func.count()).select_from(UpstreamORM)) or 0,
        public_models=session.scalar(select(func.count()).select_from(PublicModelORM)) or 0,
        api_keys_active=session.scalar(
            select(func.count()).select_from(ApiKeyORM).where(ApiKeyORM.status == "active")
        )
        or 0,
        users=session.scalar(select(func.count()).select_from(UserORM)) or 0,
    )


def _policy_payload(session: Session, config: dict, updated_at_ms: int) -> dict:
    adapter = make_adapter(get_settings())
    return {
        "config": config,
        "defaults": DEFAULT_POLICY_CONFIG,
        "effective": policy_effective(config),
        "counts": _counts(session),
        "capabilities": policy_capabilities(adapter),
        "notes": NOTES,
        "updated_at_ms": updated_at_ms,
    }


def _ensure_valid(
    session: Session,
    *,
    policy_config: dict,
    guardrail_config: dict,
    mcp_config: dict,
    title: str,
) -> None:
    adapter = make_adapter(get_settings())
    result = validate_configuration(
        policy_config=policy_config,
        guardrail_config=guardrail_config,
        mcp_config=mcp_config,
        adapter=adapter,
    )
    if not result.ok:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            title,
            details={"errors": list(result.errors), "warnings": list(result.warnings)},
        )


@router.get("/admin/policies", dependencies=[Depends(require("policies:read"))])
def current_policies(session: Session = Depends(session_of)) -> dict:
    """Editable document plus the effective data-plane preview and capabilities."""
    config, updated = load_policy_config(session)
    return _policy_payload(session, config, updated)


@router.put("/admin/policies", dependencies=[Depends(require("policies:write"))])
def update_policies(payload: PolicyConfigIn, session: Session = Depends(session_of)) -> dict:
    config = payload.config.model_dump()
    guardrail_config, _ = load_guardrail_config(session)
    mcp_config, _ = load_mcp_config(session)
    _ensure_valid(
        session,
        policy_config=config,
        guardrail_config=guardrail_config,
        mcp_config=mcp_config,
        title="策略配置未通过 AG 1.7 校验，未保存",
    )
    updated = save_policy_config(session, config)
    session.commit()
    return _policy_payload(session, config, updated)


@router.delete("/admin/policies", dependencies=[Depends(require("policies:write"))])
def reset_policies(session: Session = Depends(session_of)) -> dict:
    reset_config(session, POLICY_KEY)
    session.commit()
    return _policy_payload(session, DEFAULT_POLICY_CONFIG, 0)


@router.post(
    "/admin/policies/validate",
    dependencies=[Depends(require("policies:read"))],
)
def validate_policies(payload: PolicyConfigIn, session: Session = Depends(session_of)) -> dict:
    guardrail_config, _ = load_guardrail_config(session)
    mcp_config, _ = load_mcp_config(session)
    result = validate_configuration(
        policy_config=payload.config.model_dump(),
        guardrail_config=guardrail_config,
        mcp_config=mcp_config,
        adapter=make_adapter(get_settings()),
    )
    return {"ok": result.ok, "errors": list(result.errors), "warnings": list(result.warnings)}


def _guardrail_payload(session: Session, config: dict, updated_at_ms: int) -> dict:
    adapter = make_adapter(get_settings())
    block = guardrails_spec(adapter)
    return {
        "config": config,
        "defaults": DEFAULT_GUARDRAIL_CONFIG,
        "adapter": block.adapter,
        "items": [
            GuardrailItemOut(
                key=item.key,
                supported=item.supported,
                since_version=item.since_version,
                note=item.note,
                verified=item.verified,
            )
            for item in block.items
        ],
        "capabilities": {
            "regex": capability(adapter, "policies.guardrails.regex"),
            "webhook": capability(adapter, "policies.guardrails.webhook"),
        },
        "note": GUARDRAILS_NOTE,
        "updated_at_ms": updated_at_ms,
    }


@router.get("/admin/guardrails", dependencies=[Depends(require("policies:read"))])
def guardrails(session: Session = Depends(session_of)) -> dict:
    config, updated = load_guardrail_config(session)
    return _guardrail_payload(session, config, updated)


@router.put("/admin/guardrails", dependencies=[Depends(require("policies:write"))])
def update_guardrails(
    payload: GuardrailConfigIn, session: Session = Depends(session_of)
) -> dict:
    config = payload.config.model_dump()
    policy_config, _ = load_policy_config(session)
    mcp_config, _ = load_mcp_config(session)
    _ensure_valid(
        session,
        policy_config=policy_config,
        guardrail_config=config,
        mcp_config=mcp_config,
        title="护栏配置未通过 AG 1.7 校验，未保存",
    )
    updated = save_guardrail_config(session, config)
    session.commit()
    return _guardrail_payload(session, config, updated)


@router.delete(
    "/admin/guardrails", dependencies=[Depends(require("policies:write"))]
)
def reset_guardrails(session: Session = Depends(session_of)) -> dict:
    reset_config(session, GUARDRAIL_KEY)
    session.commit()
    return _guardrail_payload(session, DEFAULT_GUARDRAIL_CONFIG, 0)


@router.post(
    "/admin/guardrails/validate",
    dependencies=[Depends(require("policies:read"))],
)
def validate_guardrails(
    payload: GuardrailConfigIn, session: Session = Depends(session_of)
) -> dict:
    policy_config, _ = load_policy_config(session)
    mcp_config, _ = load_mcp_config(session)
    result = validate_configuration(
        policy_config=policy_config,
        guardrail_config=payload.config.model_dump(),
        mcp_config=mcp_config,
        adapter=make_adapter(get_settings()),
    )
    return {"ok": result.ok, "errors": list(result.errors), "warnings": list(result.warnings)}


def _mcp_payload(session: Session, config: dict, updated_at_ms: int) -> dict:
    adapter = make_adapter(get_settings())
    block = mcp_spec_from_config(config, adapter)
    return {
        "servers": config.get("servers") or [],
        "port": config.get("port"),
        "defaults": DEFAULT_MCP_CONFIG,
        "supported": block.supported,
        "transports": mcp_capabilities(adapter),
        "note": block.note or mcp_spec(adapter).note,
        "updated_at_ms": updated_at_ms,
    }


def _find_server(config: dict, name: str) -> int:
    for index, server in enumerate(config.get("servers") or ()):
        if server.get("name") == name:
            return index
    raise AppError(ErrorCode.NOT_FOUND, f"MCP 服务器不存在: {name}")


@router.get("/admin/mcp-servers", dependencies=[Depends(require("policies:read"))])
def list_mcp_servers(session: Session = Depends(session_of)) -> dict:
    config, updated = load_mcp_config(session)
    return _mcp_payload(session, config, updated)


@router.post("/admin/mcp-servers", dependencies=[Depends(require("policies:write"))])
def create_mcp_server(server: McpServerIn, session: Session = Depends(session_of)) -> dict:
    config, _ = load_mcp_config(session)
    servers = list(config.get("servers") or ())
    if any(item.get("name") == server.name for item in servers):
        raise AppError(ErrorCode.CONFLICT, f"MCP 服务器已存在: {server.name}")
    servers.append(server.model_dump())
    next_config = dict(config)
    next_config["servers"] = servers
    policy_config, _ = load_policy_config(session)
    guardrail_config, _ = load_guardrail_config(session)
    _ensure_valid(
        session,
        policy_config=policy_config,
        guardrail_config=guardrail_config,
        mcp_config=next_config,
        title="MCP 服务器未通过 AG 1.7 校验，未保存",
    )
    updated = save_mcp_config(session, next_config)
    session.commit()
    return _mcp_payload(session, next_config, updated)


@router.put("/admin/mcp-servers", dependencies=[Depends(require("policies:write"))])
def replace_mcp_servers(payload: McpConfig, session: Session = Depends(session_of)) -> dict:
    """Whole-document replace used by the raw JSON editor."""
    config = payload.model_dump()
    names = [server.get("name") for server in config["servers"]]
    if len(names) != len(set(names)):
        raise AppError(ErrorCode.CONFLICT, "MCP 服务器名称重复")
    policy_config, _ = load_policy_config(session)
    guardrail_config, _ = load_guardrail_config(session)
    _ensure_valid(
        session,
        policy_config=policy_config,
        guardrail_config=guardrail_config,
        mcp_config=config,
        title="MCP 配置未通过 AG 1.7 校验，未保存",
    )
    updated = save_mcp_config(session, config)
    session.commit()
    return _mcp_payload(session, config, updated)


@router.put(
    "/admin/mcp-servers/{name}", dependencies=[Depends(require("policies:write"))]
)
def update_mcp_server(
    name: str, server: McpServerIn, session: Session = Depends(session_of)
) -> dict:
    config, _ = load_mcp_config(session)
    servers = list(config.get("servers") or ())
    index = _find_server(config, name)
    if server.name != name and any(item.get("name") == server.name for item in servers):
        raise AppError(ErrorCode.CONFLICT, f"MCP 服务器已存在: {server.name}")
    servers[index] = server.model_dump()
    next_config = dict(config)
    next_config["servers"] = servers
    policy_config, _ = load_policy_config(session)
    guardrail_config, _ = load_guardrail_config(session)
    _ensure_valid(
        session,
        policy_config=policy_config,
        guardrail_config=guardrail_config,
        mcp_config=next_config,
        title="MCP 服务器未通过 AG 1.7 校验，未保存",
    )
    updated = save_mcp_config(session, next_config)
    session.commit()
    return _mcp_payload(session, next_config, updated)


@router.delete(
    "/admin/mcp-servers/{name}", dependencies=[Depends(require("policies:write"))]
)
def delete_mcp_server(name: str, session: Session = Depends(session_of)) -> Response:
    config, _ = load_mcp_config(session)
    servers = list(config.get("servers") or ())
    index = _find_server(config, name)
    servers.pop(index)
    next_config = dict(config)
    next_config["servers"] = servers
    save_mcp_config(session, next_config)
    session.commit()
    return Response(status_code=204)


@router.post(
    "/admin/mcp-servers/validate",
    dependencies=[Depends(require("policies:read"))],
)
def validate_mcp_servers(
    payload: McpConfig, session: Session = Depends(session_of)
) -> dict:
    policy_config, _ = load_policy_config(session)
    guardrail_config, _ = load_guardrail_config(session)
    result = validate_configuration(
        policy_config=policy_config,
        guardrail_config=guardrail_config,
        mcp_config=payload.model_dump(),
        adapter=make_adapter(get_settings()),
    )
    return {"ok": result.ok, "errors": list(result.errors), "warnings": list(result.warnings)}
