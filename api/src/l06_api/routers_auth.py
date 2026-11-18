"""Console session routes: login, logout, current identity (ticket 02).

Cookie policy: httpOnly (no JS access), SameSite=Lax (blocks cross-site POST
CSRF while keeping top-level navigation), Path=/, absolute Max-Age from
settings.session_ttl_seconds, Secure when SLIPSTREAM_COOKIE_SECURE=1 (required
behind TLS in production; left off for the local http:// dev server).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l01_core.timeutil import ms_to_iso, now_ms
from l04_repo.orm import UserORM
from l04_repo.repository import get_setting, put_setting
from l05_service import auth, roles
from l06_api.deps import (
    SESSION_COOKIE,
    UNAUTHENTICATED_MESSAGE,
    current_principal,
    session_of,
)
from l06_api.schemas import SelfPasswordChange

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    """Console credentials; length caps keep the hash cost bounded."""

    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class ProfileIn(BaseModel):
    """个人资料：目前只开放显示名，登录名/角色由管理员维护。"""

    name: str = Field(min_length=1, max_length=255)


class PreferencesIn(BaseModel):
    """用户设置（主题 / 通知偏好），按账号存进 app_settings。"""

    theme: str = Field(default="system", max_length=16)
    notify_email: bool = True
    notify_browser: bool = False
    notify_weekly: bool = True
    bio: str = Field(default="", max_length=500)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client is not None else ""


@router.post("/admin/auth/login")
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    session: Session = Depends(session_of),
) -> dict:
    """Verify credentials (users table, ADR-019), mint a DB session, set the cookie."""
    user = auth.authenticate(
        session,
        username=payload.username.strip(),
        password=payload.password,
        client_ip=_client_ip(request),
    )
    settings = get_settings()
    token, _row = auth.create_session(
        session,
        admin_id=user.id,
        user_agent=request.headers.get("user-agent", ""),
        client_ip=_client_ip(request),
    )
    session.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    permissions = roles.permissions_for(session, user.role)
    return {
        "user": auth.to_public(user, permissions),
        "expires_in": settings.session_ttl_seconds,
    }


@router.post("/admin/auth/logout")
def logout(request: Request, response: Response, session: Session = Depends(session_of)) -> dict:
    """Idempotent: revoke the presented session (if any) and clear the cookie."""
    auth.revoke_session(session, request.cookies.get(SESSION_COOKIE))
    session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/admin/auth/me")
def me(
    principal: auth.Principal = Depends(current_principal),
    session: Session = Depends(session_of),
) -> dict:
    """Identity + live permission list; the SPA gates navigation on it."""
    user = session.get(UserORM, principal.admin_id)
    if user is None or user.status != "active":
        raise AppError(ErrorCode.UNAUTHORIZED, UNAUTHENTICATED_MESSAGE)
    payload = auth.to_public(user, principal.permissions)
    payload["expires_at"] = ms_to_iso(principal.expires_at_ms)
    payload["auth_disabled"] = False
    return payload


@router.patch("/admin/auth/me")
def update_me(
    payload: ProfileIn,
    principal: auth.Principal = Depends(current_principal),
    session: Session = Depends(session_of),
) -> dict:
    """用户设置·个人资料：登录者可改自己的显示名，登录名与角色由管理员维护。"""
    user = session.get(UserORM, principal.admin_id)
    if user is None or user.status != "active":
        raise AppError(ErrorCode.UNAUTHORIZED, UNAUTHENTICATED_MESSAGE)
    name = payload.name.strip()
    if not name:
        raise AppError(ErrorCode.VALIDATION_ERROR, "显示名不能为空")
    user.name = name
    user.updated_at_ms = now_ms()
    session.commit()
    return auth.to_public(user, principal.permissions)


@router.post("/admin/auth/change-password")
def change_password(
    payload: SelfPasswordChange,
    principal: auth.Principal = Depends(current_principal),
    session: Session = Depends(session_of),
) -> dict:
    """自助改密（ADR-019）：验证旧密码后设置新密码。

    其他已登录会话全部吊销，当前会话保留（改密请求本身正在使用它）；旧密码
    错误返回 401，与登录共用同一句文案，不区分账号是否存在。
    """
    user = session.get(UserORM, principal.admin_id)
    if user is None or user.status != "active":
        raise AppError(ErrorCode.UNAUTHORIZED, UNAUTHENTICATED_MESSAGE)
    if not auth.verify_password(payload.old_password, user.password_hash):
        raise AppError(ErrorCode.UNAUTHORIZED, "旧密码不正确")
    user.password_hash = auth.hash_password(payload.new_password)
    user.updated_at_ms = now_ms()
    revoked = auth.revoke_other_sessions(session, principal.session_id, principal.admin_id)
    session.commit()
    return {"ok": True, "revoked_sessions": revoked}


# ── 用户设置：主题与通知偏好（ticket 16）────────────────────────────────────
# 存在 app_settings 的 user_pref:<admin_id> 键里：沿用已有的键值表，不需要新表；
# GET /admin/settings 只遍历 SETTING_META，所以这些键不会混进运营设置列表。
PREFERENCES_KEY_PREFIX = "user_pref:"
DEFAULT_PREFERENCES: dict[str, object] = {
    "theme": "system",
    "notify_email": True,
    "notify_browser": False,
    "notify_weekly": True,
    "bio": "",
}
THEMES = ("light", "dark", "system")


def _preferences_key(admin_id: str) -> str:
    return PREFERENCES_KEY_PREFIX + admin_id


def _read_preferences(session: Session, admin_id: str) -> dict:
    """Stored preferences merged onto defaults; unknown/invalid stored keys are dropped."""
    raw = get_setting(session, _preferences_key(admin_id))
    merged = dict(DEFAULT_PREFERENCES)
    if raw is None:
        return merged
    try:
        stored = json.loads(raw)
    except json.JSONDecodeError:
        return merged
    if not isinstance(stored, dict):
        return merged
    theme = stored.get("theme")
    if theme in THEMES:
        merged["theme"] = theme
    for key in ("notify_email", "notify_browser", "notify_weekly"):
        if isinstance(stored.get(key), bool):
            merged[key] = stored[key]
    if isinstance(stored.get("bio"), str):
        merged["bio"] = stored["bio"][:500]
    return merged


@router.get("/admin/auth/preferences")
def get_preferences(
    principal: auth.Principal = Depends(current_principal),
    session: Session = Depends(session_of),
) -> dict:
    """当前账号的主题与通知偏好；未保存过时返回默认值。"""
    return _read_preferences(session, principal.admin_id)


@router.put("/admin/auth/preferences")
def put_preferences(
    payload: PreferencesIn,
    principal: auth.Principal = Depends(current_principal),
    session: Session = Depends(session_of),
) -> dict:
    """保存主题与通知偏好；theme 只接受 light/dark/system。"""
    theme = payload.theme.strip().lower()
    if theme not in THEMES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"theme must be one of {THEMES}",
            details={"theme": payload.theme},
        )
    values: dict[str, object] = {
        "theme": theme,
        "notify_email": payload.notify_email,
        "notify_browser": payload.notify_browser,
        "notify_weekly": payload.notify_weekly,
        "bio": payload.bio.strip()[:500],
    }
    put_setting(
        session,
        _preferences_key(principal.admin_id),
        json.dumps(values, ensure_ascii=False),
        now_ms(),
    )
    session.commit()
    return values
