"""Role administration: seed built-ins, resolve permissions, manage custom roles.

The permission registry lives in l05_service.rbac; this module is the storage
face: admin_roles rows plus the users.role assignment (ADR-019: one user
table). Permission checks never look at a role name - they load the grant set
for the stored key, so a custom role is exactly as powerful as the permissions
it lists.
"""

from __future__ import annotations

import json
import re
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.orm import AdminRoleORM, UserORM
from l05_service import rbac

CUSTOM_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
MAX_ROLE_NAME = 64


def ensure_builtin_roles(session: Session) -> None:
    """Insert any missing built-in role rows; existing rows stay untouched."""
    changed = False
    for definition in rbac.BUILTIN_ROLES:
        existing = session.scalars(
            select(AdminRoleORM).where(AdminRoleORM.key == definition.key)
        ).first()
        if existing is not None:
            continue
        stamp = now_ms()
        session.add(
            AdminRoleORM(
                id=new_id("rol"),
                key=definition.key,
                name=definition.name,
                description=definition.description,
                builtin=True,
                all_permissions=definition.all_permissions,
                permissions_json=json.dumps(sorted(definition.permissions)),
                created_at_ms=stamp,
                updated_at_ms=stamp,
            )
        )
        changed = True
    if changed:
        session.commit()


def permissions_for(session: Session, role_key: str) -> frozenset[str]:
    """Grant set for a stored role key; falls back to built-in definitions."""
    key = rbac.normalize_role_key(role_key)
    row = session.scalars(select(AdminRoleORM).where(AdminRoleORM.key == key)).first()
    if row is None:
        return rbac.permissions_for_role_key(key)
    if row.all_permissions:
        return rbac.PERMISSION_KEYS
    return rbac.parse_permissions_json(row.permissions_json)


def member_count(session: Session, role_key: str) -> int:
    """Users whose stored role string maps to this canonical key (ADR-019)."""
    key = rbac.normalize_role_key(role_key)
    legacy = rbac.LEGACY_ALIASES_BY_KEY.get(key, ())
    return int(
        session.scalar(
            select(func.count())
            .select_from(UserORM)
            .where(UserORM.role.in_((key, *legacy)))
        )
        or 0
    )


def role_payload(session: Session, row: AdminRoleORM) -> dict:
    """API shape for one role, with a live permission list and member count."""
    permissions = (
        rbac.PERMISSION_KEYS
        if row.all_permissions
        else rbac.parse_permissions_json(row.permissions_json)
    )
    return {
        "id": row.id,
        "key": row.key,
        "name": row.name,
        "description": row.description,
        "builtin": bool(row.builtin),
        "all_permissions": bool(row.all_permissions),
        "permissions": sorted(permissions),
        "member_count": member_count(session, row.key),
        "created_at_ms": row.created_at_ms,
        "updated_at_ms": row.updated_at_ms,
    }


def list_roles(session: Session) -> list[dict]:
    """Built-in roles first (registry order), then custom roles by creation."""
    builtin_order = {definition.key: index for index, definition in enumerate(rbac.BUILTIN_ROLES)}
    rows = session.scalars(select(AdminRoleORM)).all()
    ordered = sorted(
        rows,
        key=lambda row: (
            0 if row.builtin else 1,
            builtin_order.get(row.key, 0),
            row.created_at_ms,
            row.key,
        ),
    )
    return [role_payload(session, row) for row in ordered]


def role_exists(session: Session, role_key: str) -> bool:
    key = rbac.normalize_role_key(role_key)
    if key in rbac.BUILTIN_ROLE_KEYS:
        return True
    return (
        session.scalars(select(AdminRoleORM).where(AdminRoleORM.key == key)).first()
        is not None
    )


def require_role(session: Session, role_key: str) -> str:
    """Validate an assignment target and return its canonical key."""
    key = rbac.normalize_role_key(role_key)
    if not role_exists(session, key):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"角色不存在: {role_key}",
            details={"role": role_key},
        )
    return key


def _unique_name(session: Session, name: str, *, exclude_id: str | None = None) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise AppError(ErrorCode.VALIDATION_ERROR, "角色名称不能为空")
    if len(cleaned) > MAX_ROLE_NAME:
        raise AppError(ErrorCode.VALIDATION_ERROR, "角色名称过长")
    rows = session.scalars(select(AdminRoleORM).where(AdminRoleORM.name == cleaned)).all()
    for row in rows:
        if row.id != exclude_id:
            raise AppError(ErrorCode.CONFLICT, f"角色名称已存在: {cleaned}")
    return cleaned


def _generate_key(session: Session) -> str:
    for _ in range(8):
        key = "custom_" + secrets.token_hex(4)
        if not role_exists(session, key):
            return key
    raise AppError(ErrorCode.INTERNAL_ERROR, "无法生成角色标识")


def create_role(
    session: Session,
    *,
    name: str,
    description: str = "",
    permissions: object = (),
    key: str | None = None,
) -> dict:
    """Create a custom role; permissions must be registered keys."""
    cleaned_name = _unique_name(session, name)
    granted = rbac.validate_permission_keys(list(permissions or ()))
    if key:
        candidate = key.strip()
        if not CUSTOM_KEY_RE.match(candidate):
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "角色标识须为 3-32 位小写字母/数字/下划线且以字母开头",
            )
        if candidate in rbac.RESERVED_ROLE_KEYS or role_exists(session, candidate):
            raise AppError(ErrorCode.CONFLICT, f"角色标识已保留或存在: {candidate}")
    else:
        candidate = _generate_key(session)
    stamp = now_ms()
    row = AdminRoleORM(
        id=new_id("rol"),
        key=candidate,
        name=cleaned_name,
        description=(description or "").strip()[:255],
        builtin=False,
        all_permissions=False,
        permissions_json=json.dumps(sorted(granted)),
        created_at_ms=stamp,
        updated_at_ms=stamp,
    )
    session.add(row)
    session.commit()
    return role_payload(session, row)


def get_role(session: Session, role_id: str) -> AdminRoleORM:
    row = session.get(AdminRoleORM, role_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"角色不存在: {role_id}")
    return row


def update_role(
    session: Session,
    role_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    permissions: object | None = None,
) -> dict:
    """Rename/re-describe a role or replace its grant set (custom roles only)."""
    row = get_role(session, role_id)
    if permissions is not None:
        if row.builtin:
            raise AppError(
                ErrorCode.CONFLICT,
                "内置角色的权限不可修改",
                details={"key": row.key},
            )
        row.permissions_json = json.dumps(sorted(rbac.validate_permission_keys(permissions)))
    if name is not None:
        row.name = _unique_name(session, name, exclude_id=row.id)
    if description is not None:
        row.description = description.strip()[:255]
    row.updated_at_ms = now_ms()
    session.commit()
    return role_payload(session, row)


def delete_role(session: Session, role_id: str) -> None:
    """Delete a custom role that no account still uses."""
    row = get_role(session, role_id)
    if row.builtin:
        raise AppError(
            ErrorCode.CONFLICT,
            "内置角色不可删除",
            details={"key": row.key},
        )
    used = member_count(session, row.key)
    if used:
        raise AppError(
            ErrorCode.CONFLICT,
            f"仍有 {used} 个用户使用该角色，无法删除",
            details={"member_count": used},
        )
    session.delete(row)
    session.commit()
