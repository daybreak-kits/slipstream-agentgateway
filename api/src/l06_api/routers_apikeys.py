"""User + client-key routes (ADR-007/008/011/019/023): unified users, masked keys.

Users are one table now (ADR-019): creation takes/derives an immutable username
and always yields a password, returned exactly once as initial_password. Key
lists show the mask only (`sk-...abcd`); the plaintext copy exists purely for
the audited reveal endpoint (`apikeys:write` + user scope). A user holds up to 50 keys (ADR-023)
with name / last_used_at_ms surfaced in list payloads.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import ApiKeyORM, AuditLogORM, LedgerEntryORM, UserORM
from l05_service import auth, balances, client_keys, crud, rbac, roles, user_tree
from l05_service.rollout import Rollout
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import (
    ApiKeyIssue,
    ApiKeyRename,
    ApiKeyStatusPatch,
    BalanceAdjust,
    BalanceTopup,
    RefundCreate,
    UserCreate,
    UserPasswordReset,
    UserUpdate,
)

router = APIRouter(tags=["users-keys"])


def _user_body(session: Session, row: UserORM, snapshot: dict | None = None) -> dict:
    """User payload with hierarchy metrics (ticket 04); money filtered by callers."""
    tree = snapshot if snapshot is not None else user_tree.snapshot(session)
    metrics = tree["nodes"].get(
        row.id, {"depth": 0, "direct_children": 0, "subtree_size": 1}
    )
    return {
        "id": row.id,
        "name": row.name,
        # Every user is a login account (W7): the name is always a string, the
        # type column of the old console/API split is gone for good.
        "username": row.username or "",
        "balance_micro": row.balance_micro,
        "role": row.role or rbac.BUILTIN_ROLE_CUSTOMER,
        "parent_user_id": row.parent_user_id,
        "status": row.status or "active",
        "depth": metrics["depth"],
        "direct_children": metrics["direct_children"],
        "subtree_size": metrics["subtree_size"],
        "created_at_ms": row.created_at_ms,
        "updated_at_ms": row.updated_at_ms,
    }


def _resolve_username(session: Session, name: str, requested: str | None) -> str:
    """ADR-019: username is unique and immutable; derive it from name when omitted.

    An explicit username that is already taken is a CONFLICT; a derived one gets
    a numeric suffix so the creation call never fails on a display-name clash.
    """
    if requested is not None:
        cleaned = requested.strip()
        if not cleaned:
            raise AppError(ErrorCode.VALIDATION_ERROR, "username 不能为空")
        taken = session.scalars(
            select(UserORM.username).where(UserORM.username == cleaned)
        ).first()
        if taken is not None:
            raise AppError(ErrorCode.CONFLICT, f"username 已存在: {cleaned}")
        return cleaned
    base = (name.strip() or "user")[:120]
    candidate = base
    suffix = 2
    while (
        session.scalars(
            select(UserORM.username).where(UserORM.username == candidate)
        ).first()
        is not None
    ):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _scoped_users(session: Session, principal: auth.Principal) -> list[UserORM]:
    """Every user the caller may read, tree order (depth then creation)."""
    visible = user_tree.visible_ids(session, principal)
    stmt = select(UserORM).order_by(UserORM.created_at_ms, UserORM.id)
    if visible is not None:
        if not visible:
            return []
        stmt = stmt.where(UserORM.id.in_(visible))
    rows = [
        row for row in session.scalars(stmt).all() if not user_tree.is_system_user(row)
    ]
    tree = user_tree.snapshot(session)
    return sorted(
        rows, key=lambda row: (tree["nodes"][row.id]["depth"], row.created_at_ms, row.id)
    )


def _key_body(row: ApiKeyORM) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "name": row.name,
        "mask": client_keys.mask_of(row.prefix, row.key_suffix),
        "key_suffix": row.key_suffix,
        "status": row.status,
        "last_used_at_ms": row.last_used_at_ms,
        "created_at_ms": row.created_at_ms,
    }


def _box() -> AesGcmBox:
    return AesGcmBox(get_settings().secret_key)


def _visible_key(session: Session, principal, key_id: str) -> ApiKeyORM:
    """Load one key inside the caller's user scope (ADR-008 admin/global scope).

    Keys hang off a user, so the subtree rule that guards users guards them too:
    an all-permission admin sees every key, a subtree role sees its branch, and
    anyone else is stopped with 403 before the key is touched. 404 for an
    unknown key keeps the two cases from being distinguished from the outside.
    """
    row = session.get(ApiKeyORM, key_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"api key not found: {key_id}")
    user_tree.get_visible(session, principal, row.user_id)
    return row


def _audit(session: Session, *, actor: str, action: str, entity_id: str, detail: str) -> None:
    session.add(
        AuditLogORM(
            id=new_id("aud"),
            actor=actor,
            action=action,
            entity_type="api_key",
            entity_id=entity_id,
            detail_json=detail,
            created_at_ms=now_ms(),
        )
    )


# ---------------------------------------------------------------- users


@router.post("/admin/users", status_code=201, dependencies=[Depends(require("users:create"))])
def create_user(
    payload: UserCreate,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:create")),
) -> dict:
    """Create a user under the caller's node; an initial balance books a topup.

    ADR-019: password is mandatory - taken from the request or generated (12
    chars, upper/lower/digit/symbol). The plaintext is returned exactly once,
    as initial_password on THIS creation response; it is never retrievable.
    """
    role_key = roles.require_role(session, payload.role or rbac.BUILTIN_ROLE_CUSTOMER)
    role_key = user_tree.assert_can_grant_role(session, principal, role_key)
    if payload.parent_user_id:
        parent = user_tree.assert_parent_allowed(
            session, principal, payload.parent_user_id
        )
    elif user_tree.has_global_scope(principal):
        parent = user_tree.ensure_root_user(session)
    else:
        # 分销商：第一次创建下级时自动在 D 下开户并绑定当前登录
        parent = user_tree.ensure_principal_node(session, principal)
    username = _resolve_username(session, payload.name.strip(), payload.username)
    initial_password = payload.password or auth.generate_password()
    row = crud.create_user(
        session,
        name=payload.name.strip(),
        username=username,
        password_hash=auth.hash_password(initial_password),
        parent_user_id=parent.id,
        role=role_key,
        status=payload.status,
        actor=principal.username,
    )
    if payload.balance_micro > 0:
        balances.record_topup(
            session,
            user_id=row.id,
            amount_micro=payload.balance_micro,
            currency="USD",
            created_by=principal.username,
            note="initial balance at user creation",
        )
    session.commit()
    body = _user_body(session, row)
    body["initial_password"] = initial_password
    return body


@router.get("/admin/users", dependencies=[Depends(require("users:read"))])
def list_users(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Scoped user list: admin sees all, 分销商 its subtree, others only self."""
    limit, off = page_params(page_size, offset)
    rows = _scoped_users(session, principal)
    tree = user_tree.snapshot(session)
    return [_user_body(session, row, tree) for row in rows[off : off + limit]]


@router.get("/admin/users/tree", dependencies=[Depends(require("users:read"))])
def user_tree_view(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:read")),
) -> dict:
    """Flat tree payload for the user panel (ticket 04).

    "nodes" is ordered by depth; "root_ids" lists the visible nodes whose parent
    is outside the caller's scope, so a 分销商's subtree renders as its own
    forest instead of a dangling edge to D.
    """
    rows = _scoped_users(session, principal)
    tree = user_tree.snapshot(session)
    nodes = [_user_body(session, row, tree) for row in rows]
    visible = {node["id"] for node in nodes}
    root_ids = [
        node["id"]
        for node in nodes
        if not node["parent_user_id"] or node["parent_user_id"] not in visible
    ]
    return {
        "root_id": tree["root_id"],
        "root_ids": root_ids,
        "total": len(nodes),
        "nodes": nodes,
    }


@router.get("/admin/users/{user_id}", dependencies=[Depends(require("users:read"))])
def get_user(
    user_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:read")),
) -> dict:
    row = user_tree.get_visible(session, principal, user_id)
    return _user_body(session, row)


@router.patch(
    "/admin/users/{user_id}",
    dependencies=[Depends(require("users:update"))],
)
def update_user(
    user_id: str,
    payload: UserUpdate,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:update")),
) -> dict:
    """Edit name/role/status or re-parent a user inside the caller's scope.

    username is immutable (ADR-019): sending it is a 422 regardless of value.
    """
    if "username" in payload.model_fields_set:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "username 不可修改（ADR-019：登录名一经设定不可变更）",
            details={"field": "username"},
        )
    row = user_tree.get_visible(session, principal, user_id)
    root = user_tree.root_user(session)
    if "parent_user_id" in payload.model_fields_set:
        if root is not None and row.id == root.id:
            if payload.parent_user_id is not None:
                raise AppError(ErrorCode.VALIDATION_ERROR, "根用户必须位于树根")
            new_parent_id: str | None = None
        elif payload.parent_user_id is None:
            if not user_tree.has_global_scope(principal):
                raise AppError(
                    ErrorCode.FORBIDDEN, "只有管理用户可以把用户挂到根用户下"
                )
            new_parent_id = user_tree.ensure_root_user(session).id
        else:
            user_tree.assert_parent_allowed(session, principal, payload.parent_user_id)
            new_parent_id = payload.parent_user_id
            user_tree.assert_no_cycle(session, row.id, new_parent_id)
        row.parent_user_id = new_parent_id
    if payload.role is not None:
        role_key = roles.require_role(session, payload.role)
        row.role = user_tree.assert_can_grant_role(session, principal, role_key)
    if payload.name is not None:
        row.name = payload.name.strip() or row.name
    if payload.status is not None:
        if root is not None and row.id == root.id and payload.status != "active":
            raise AppError(ErrorCode.VALIDATION_ERROR, "根用户不可停用")
        row.status = payload.status
    row.updated_at_ms = now_ms()
    session.commit()
    return _user_body(session, row)


@router.delete(
    "/admin/users/{user_id}",
    dependencies=[Depends(require("users:delete"))],
)
def delete_user(
    user_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:delete")),
) -> dict:
    """Soft-delete (status=deleted); a root or a parent with children stays."""
    row = user_tree.get_visible(session, principal, user_id)
    root = user_tree.root_user(session)
    if root is not None and row.id == root.id:
        raise AppError(ErrorCode.CONFLICT, "根用户不可删除")
    tree = user_tree.snapshot(session)
    if tree["nodes"][row.id]["direct_children"] > 0:
        raise AppError(ErrorCode.CONFLICT, "请先迁移或删除该用户的下级")
    row.status = "deleted"
    row.updated_at_ms = now_ms()
    session.commit()
    return {"id": row.id, "status": row.status}


@router.put(
    "/admin/users/{user_id}/password",
    dependencies=[Depends(require("users:update"))],
)
def reset_user_password(
    user_id: str,
    payload: UserPasswordReset,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:update")),
) -> dict:
    """管理员/代理重置他人密码（ADR-019）：管理员全域，代理仅子树。

    Scope comes from user_tree.get_visible (403 across branches); resetting
    signs the account out everywhere so stale sessions cannot survive it.
    Self-service change (verify old password) lives in routers_auth.
    """
    row = user_tree.get_visible(session, principal, user_id)
    row.password_hash = auth.hash_password(payload.password)
    row.updated_at_ms = now_ms()
    auth.revoke_sessions_for_admin(session, row.id)
    session.commit()
    return {"id": row.id, "username": row.username}


@router.get("/admin/users/{user_id}/balance/precheck")
def balance_precheck(
    user_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:read")),
) -> dict:
    """ADR-011 precheck for stricter callers: negative balance blocks new calls."""
    row = user_tree.get_visible(session, principal, user_id)
    return {
        "user_id": user_id,
        "balance_micro": row.balance_micro,
        "allowed": row.balance_micro >= 0,
        "note": "fast check only; the data-plane bucket bills one request ahead (E10)",
    }


@router.post(
    "/admin/users/{user_id}/balance",
    dependencies=[Depends(require("users:update"))],
)
def topup_balance(
    user_id: str,
    payload: BalanceTopup,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal: auth.Principal = Depends(require("users:update")),
) -> dict:
    """Prepaid top-up (ADR-007: 预付余额) + one re-render so the bucket tracks it."""
    user_tree.get_visible(session, principal, user_id)
    row = balances.record_topup(
        session,
        user_id=user_id,
        amount_micro=payload.amount_micro,
        currency=payload.currency,
        created_by=principal.username,
        note=payload.note,
    )
    session.commit()
    Rollout(session, adapter).apply(
        principal.username, reason="balance-topup", on_failure="keep-booked"
    )
    session.commit()  # failed rollouts are archived; the balance stays booked
    return {"ledger_id": row.id, "balance_after_micro": row.balance_after_micro}


@router.post(
    "/admin/users/{user_id}/balance/adjust",
    dependencies=[Depends(require("users:update"))],
)
def adjust_balance(
    user_id: str,
    payload: BalanceAdjust,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:update")),
) -> dict:
    user_tree.get_visible(session, principal, user_id)
    row = balances.record_adjust(
        session,
        user_id=user_id,
        delta_micro=payload.delta_micro,
        currency=payload.currency,
        created_by=principal.username,
        note=payload.note,
    )
    session.commit()
    return {"ledger_id": row.id, "balance_after_micro": row.balance_after_micro}


@router.post(
    "/admin/users/{user_id}/balance/refund",
    dependencies=[Depends(require("users:update"))],
)
def refund_balance(
    user_id: str,
    payload: RefundCreate,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("users:update")),
) -> dict:
    user_tree.get_visible(session, principal, user_id)
    row = balances.record_refund(
        session,
        user_id=user_id,
        amount_micro=payload.amount_micro,
        currency=payload.currency,
        ref_type="charge_entry",
        ref_id=payload.charge_entry_id,
        created_by=principal.username,
        note=payload.note,
    )
    session.commit()
    return {"ledger_id": row.id, "balance_after_micro": row.balance_after_micro}


@router.get("/admin/users/{user_id}/ledger")
def user_ledger(
    user_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("ledger:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    user_tree.get_visible(session, principal, user_id)
    rows = session.scalars(
        select(LedgerEntryORM)
        .where(LedgerEntryORM.user_id == user_id)
        .order_by(LedgerEntryORM.created_at_ms.desc())
        .offset(off)
        .limit(limit)
    ).all()
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "delta_micro": row.delta_micro,
            "balance_after_micro": row.balance_after_micro,
            "currency": row.currency,
            "ref_type": row.ref_type,
            "ref_id": row.ref_id,
            "note": row.note,
            "created_by": row.created_by,
            "created_at_ms": row.created_at_ms,
        }
        for row in rows
    ]


# ---------------------------------------------------------------- api keys


@router.post(
    "/admin/users/{user_id}/api-keys",
    status_code=201,
    dependencies=[Depends(require("apikeys:write"))],
)
def issue_key(
    user_id: str,
    payload: ApiKeyIssue,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> dict:
    """Issue one more key (ADR-023: up to 50 per user); plaintext appears once.

    The target user must be inside the caller's scope (ADR-019 subtree rule), so
    a branch admin cannot mint a key for another branch.
    """
    user_tree.get_visible(session, principal, user_id)
    issued = client_keys.issue_client_key(
        session,
        user_id=user_id,
        box=_box(),
        length=payload.length,
        prefix=payload.prefix,
        name=payload.name,
    )
    _audit(
        session, actor=principal.username, action="issue_key", entity_id=issued.key_id, detail=""
    )
    session.commit()
    Rollout(session, adapter).apply(principal.username, reason="key-issue")
    session.commit()
    return {
        "id": issued.key_id,
        "name": session.get(ApiKeyORM, issued.key_id).name,
        "key": issued.plaintext,
        "key_hash": issued.key_hash,
        "note": "store this value now; it is only revealable through the audited endpoint",
    }


@router.get("/admin/api-keys", dependencies=[Depends(require("apikeys:read"))])
def list_keys(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("apikeys:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Keys of the users this caller may see (ADR-008/019); admin sees all.

    The subtree rule is the same one the user routes use, so a branch admin's key
    list stops at its own branch instead of leaking sibling key metadata.
    """
    limit, off = page_params(page_size, offset)
    visible = user_tree.visible_ids(session, principal)
    query = select(ApiKeyORM)
    if visible is not None:
        query = query.where(ApiKeyORM.user_id.in_(visible))
    rows = session.scalars(query.offset(off).limit(limit)).all()
    return [_key_body(row) for row in rows]


@router.patch(
    "/admin/api-keys/{key_id}",
    dependencies=[Depends(require("apikeys:write"))],
)
def rename_key(
    key_id: str,
    payload: ApiKeyRename,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> dict:
    """ADR-023: rename a key; console metadata only, no data-plane rollout.

    W7 B 方案：维护动作也要过 user scope——customer 拿到 apikeys:write 后
    也不能按 key id 改别人分支的密钥；未知 id 仍 404。
    """
    _visible_key(session, principal, key_id)
    row = client_keys.rename_client_key(session, key_id, payload.name)
    _audit(
        session,
        actor=principal.username,
        action="rename_key",
        entity_id=key_id,
        detail=payload.name,
    )
    session.commit()
    return _key_body(row)


@router.delete(
    "/admin/api-keys/{key_id}",
    status_code=204,
    dependencies=[Depends(require("apikeys:write"))],
)
def delete_key(
    key_id: str,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> None:
    """ADR-023: delete a key outright; keeping an active key is never required.

    W7 B 方案：删除同样按 user scope 鉴权（path 仍是 REST 风格，无 user 段）。
    """
    _visible_key(session, principal, key_id)
    client_keys.delete_client_key(session, key_id)
    _audit(session, actor=principal.username, action="delete_key", entity_id=key_id, detail="")
    session.commit()
    Rollout(session, adapter).apply(principal.username, reason="key-delete")
    session.commit()


@router.patch(
    "/admin/api-keys/{key_id}/status",
    dependencies=[Depends(require("apikeys:write"))],
)
def patch_key_status(
    key_id: str,
    payload: ApiKeyStatusPatch,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> dict:
    """ADR-023: enable/disable a key from the console row action.

    W7 B 方案：行操作的启停也按 user scope 鉴权，customer 不能动别人分支的密钥。
    """
    _visible_key(session, principal, key_id)
    row = client_keys.set_key_status(session, key_id, payload.status)
    _audit(
        session,
        actor=principal.username,
        action="set_key_status",
        entity_id=key_id,
        detail=payload.status,
    )
    session.commit()
    Rollout(session, adapter).apply(principal.username, reason=f"key-{payload.status}")
    session.commit()
    return _key_body(row)


@router.post(
    "/admin/api-keys/{key_id}/rotate",
    dependencies=[Depends(require("apikeys:write"))],
)
def rotate_key(
    key_id: str,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> dict:
    """ADR-023: rotate renews key material once; the old hash stops validating.

    W7 B 方案：重置同样按 user scope 鉴权（path 仍是 REST 风格，无 user 段）。
    """
    _visible_key(session, principal, key_id)
    issued = client_keys.rotate_client_key(session, key_id, _box())
    _audit(session, actor=principal.username, action="rotate_key", entity_id=key_id, detail="")
    session.commit()
    Rollout(session, adapter).apply(principal.username, reason="key-rotate")
    session.commit()
    return {
        "id": issued.key_id,
        "key": issued.plaintext,
        "key_hash": issued.key_hash,
        "note": "previous material stops working after this apply; store the new value now",
    }


@router.post(
    "/admin/api-keys/{key_id}/reveal",
    dependencies=[Depends(require("apikeys:write"))],
)
def reveal_key(
    key_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("apikeys:write")),
) -> dict:
    """ADR-008 copy-key feature: audited plaintext reveal (requires `apikeys:write`).

    Visibility follows the caller's user scope (ADR-019): the built-in admin role
    sees every key, a subtree role only its own branch, everyone else is 403.
    """
    _visible_key(session, principal, key_id)
    plaintext = client_keys.reveal_client_key(session, key_id, _box())
    _audit(
        session,
        actor=principal.username,
        action="reveal_key",
        entity_id=key_id,
        detail="plaintext revealed",
    )
    session.commit()
    return {"id": key_id, "key": plaintext}
