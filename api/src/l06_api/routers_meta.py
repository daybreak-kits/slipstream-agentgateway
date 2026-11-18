"""Meta routes the frontend already calls but the skeleton lacked (task-170).

Four endpoints, all additive and isolated here so other router owners are not
touched:

* GET/PUT /admin/settings      - app_settings key/value store (label + updated_at)
* GET /admin/audit-logs        - paged, filterable audit trail
* GET /admin/config/revisions/latest - newest revision (404 when none)
* GET /admin/overview          - alias of /admin/reports/overview
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.timeutil import ms_to_iso, now_ms
from l04_repo.orm import AppSettingORM, AuditLogORM, ConfigRevisionORM
from l04_repo.repository import get_setting, put_setting
from l05_service import auth, settings_schema
from l06_api.deps import current_principal, require, session_of
from l06_api.routers_config import _body as revision_body
from l06_api.routers_reports import overview as reports_overview
from l06_api.schemas import ConfigRevisionOut, SettingsSchemaOut

router = APIRouter(tags=["meta"])

# Editable settings are declared once in l05_service.settings_schema; this router
# only adapts HTTP (read stored values, forward PUT to the shared validator).
CONNECTION_DEFAULT_PORT = settings_schema.CONNECTION_DEFAULT_PORT


def _read_value(session: Session, key: str) -> tuple[str, int]:
    """Stored JSON value rendered as display text, plus updated_at_ms (0 = unset)."""
    raw = get_setting(session, key)
    if raw is None:
        return settings_schema.default_text(key), 0
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw, 0
    row = session.get(AppSettingORM, key)
    updated = row.updated_at_ms if row is not None else 0
    if isinstance(value, bool):
        return ("true" if value else "false"), updated
    if isinstance(value, (int, float)):
        return str(value), updated
    if isinstance(value, str):
        return value, updated
    return json.dumps(value, ensure_ascii=False), updated


def _settings_payload(session: Session) -> dict[str, Any]:
    items = []
    for key, field in settings_schema.SETTING_FIELDS.items():
        value, updated_ms = _read_value(session, key)
        items.append(
            {
                "key": key,
                "value": value,
                "label": field.label,
                "updated_at": ms_to_iso(updated_ms) if updated_ms else "",
            }
        )
    return {"items": items}


@router.get("/admin/settings", dependencies=[Depends(require("settings:read"))])
def get_settings(session: Session = Depends(session_of)) -> dict[str, Any]:
    """All editable settings, in a stable order; missing rows fall back to defaults."""
    return _settings_payload(session)


@router.get(
    "/admin/settings/schema",
    dependencies=[Depends(require("settings:read"))],
    response_model=SettingsSchemaOut,
)
def get_settings_schema() -> SettingsSchemaOut:
    """Machine-readable field table: the UI renders labels/kinds/ranges from it."""
    return SettingsSchemaOut.model_validate({"groups": settings_schema.wire_groups()})


@router.put("/admin/settings", dependencies=[Depends(require("settings:write"))])
def put_settings(
    payload: dict[str, Any], session: Session = Depends(session_of)
) -> dict[str, Any]:
    """Update only the provided keys; unknown keys are rejected with 422.

    Body: {"values": {"base_currency": "USD"}}. The response repeats the GET
    shape and additionally echoes the accepted values for older clients.
    """
    values = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(values, dict) or not values:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "body must be {\"values\": {<key>: <value>, ...}}",
            details={"body": payload},
        )
    unknown = sorted(set(values) - set(settings_schema.SETTING_FIELDS))
    if unknown:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown setting keys: {', '.join(unknown)}",
            details={"unknown": unknown, "known": sorted(settings_schema.SETTING_FIELDS)},
        )
    accepted: dict[str, str] = {}
    for key, raw in values.items():
        accepted[key] = settings_schema.coerce_setting(key, raw)
    stamp = now_ms()
    for key, text in accepted.items():
        put_setting(session, key, json.dumps(text, ensure_ascii=False), stamp)
    session.commit()
    payload_out = _settings_payload(session)
    payload_out["values"] = accepted
    return payload_out


@router.get("/admin/connection")
def connection_info(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(current_principal),
) -> dict[str, Any]:
    """统一连接地址：所有登录用户可读，运营设置里可改（ticket 16）。

    空字符串 = 未配置，前端回退到浏览器当前 host + 3600 端口；控制面只存显式
    配置的公网地址，读取侧不需要 settings:read，避免普通用户看不到接入信息。
    """
    raw = get_setting(session, "gateway_base_url")
    configured = ""
    if raw is not None:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = raw
        if isinstance(value, str):
            configured = value
    row = session.get(AppSettingORM, "gateway_base_url")
    return {
        "base_url": configured,
        "configured": bool(configured),
        "default_port": CONNECTION_DEFAULT_PORT,
        # Only the three paths verified against the real data plane (E14);
        # anything else would be guesswork, so the list stays server-owned.
        "endpoints": ["/v1/chat/completions", "/v1/models", "/v1/embeddings"],
        "updated_at": ms_to_iso(row.updated_at_ms) if row is not None and row.updated_at_ms else "",
        "editable": "settings:write" in principal.permissions,
    }


@router.get("/admin/audit-logs", dependencies=[Depends(require("audits:read"))])
def list_audit_logs(
    session: Session = Depends(session_of),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str = "",
    actor: str = "",
) -> dict[str, Any]:
    """Audit trail, newest first; action/actor are substring filters."""
    rows = session.scalars(
        select(AuditLogORM).order_by(
            AuditLogORM.created_at_ms.desc(), AuditLogORM.id.desc()
        )
    ).all()
    if action:
        needle = action.lower()
        rows = [r for r in rows if needle in (r.action or "").lower()]
    if actor:
        needle = actor.lower()
        rows = [r for r in rows if needle in (r.actor or "").lower()]
    total = len(rows)
    page = rows[offset : offset + limit]
    items = [
        {
            "id": row.id,
            "actor": row.actor or "",
            "action": row.action or "",
            "target": row.entity_id or "",
            "detail": row.detail_json or "",
            "created_at": ms_to_iso(row.created_at_ms),
        }
        for row in page
    ]
    next_offset = offset + len(items)
    return {
        "items": items,
        "total": total,
        "next_offset": next_offset if next_offset < total else None,
    }


@router.get(
    "/admin/config/revisions/latest",
    response_model=ConfigRevisionOut,
    dependencies=[Depends(require("config:read"))],
)
def latest_revision(session: Session = Depends(session_of)) -> ConfigRevisionOut:
    """Alias used by the dashboard: newest archived revision, 404 when empty."""
    row = session.scalars(
        select(ConfigRevisionORM)
        .order_by(ConfigRevisionORM.created_at_ms.desc())
        .limit(1)
    ).first()
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, "no config revision yet")
    return revision_body(row)


@router.get("/admin/overview", dependencies=[Depends(require("reports:read"))])
def admin_overview(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    from_ms: int = 0,
    to_ms: int = 0,
) -> dict[str, Any]:
    """Alias of /admin/reports/overview so dashboard clients keep one path."""
    return reports_overview(
        session=session, principal=principal, from_ms=from_ms, to_ms=to_ms
    )
