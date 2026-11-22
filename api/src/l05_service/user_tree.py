"""User hierarchy (ticket 04): root user D, parent/child tree, data scope.

User accounts (`users`) form a tree through `parent_user_id`; the seeded root
`D` is the ancestor of every account. Since ADR-019 there is ONE user table:
the console login IS a users row, so the subtree rule binds by identity —

- an all-permission role (管理用户) sees every user;
- a role holding `billing:subtree` sees its own node plus every descendant;
- every other role sees only its own node.

Cross-branch reads/writes raise 403 here instead of returning empty data, so a
分销商 cannot probe whether a sibling account exists. The billing/dashboard
tickets call `visible_ids` too: this module is the single implementation of the
subtree rule.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l04_repo.orm import UserORM
from l05_service import rbac

if TYPE_CHECKING:
    from l05_service.auth import Principal

ROOT_USER_NAME = "D"
SYSTEM_USER_NAME = "playground"


def is_system_user(row: UserORM) -> bool:
    """Internal identities have no login name and must stay out of user management."""
    return row.name == SYSTEM_USER_NAME and not row.username


# ---------------------------------------------------------------- root


def root_user(session: Session) -> UserORM | None:
    """The root consumer `D` (read-only lookup; `ensure_root_user` creates it)."""
    return session.scalars(
        select(UserORM).where(UserORM.name == ROOT_USER_NAME)
    ).first()


def ensure_root_user(session: Session) -> UserORM:
    """Create root `D` if missing and re-parent every orphan account under it.

    Idempotent; called once per app start and by the demo seed. Existing users
    whose `parent_user_id` is NULL (v1 data) join D's subtree on the next start.
    Caller commits.
    """
    root = root_user(session)
    changed = False
    if root is None:
        root = UserORM(
            id=new_id("user"),
            name=ROOT_USER_NAME,
            balance_micro=0,
            role=rbac.BUILTIN_ROLE_ADMIN,
            parent_user_id=None,
            status="active",
            created_at_ms=now_ms(),
            updated_at_ms=now_ms(),
        )
        session.add(root)
        session.flush()
        changed = True
    elif root.parent_user_id is not None:
        root.parent_user_id = None
        changed = True
    orphans = session.scalars(
        select(UserORM).where(UserORM.parent_user_id.is_(None), UserORM.id != root.id)
    ).all()
    for row in orphans:
        row.parent_user_id = root.id
        changed = True
    if changed:
        session.flush()
    return root


# ---------------------------------------------------------------- tree math


def _children_map(session: Session) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {}
    for user_id, parent_id in session.execute(
        select(UserORM.id, UserORM.parent_user_id)
    ).all():
        if parent_id:
            children.setdefault(parent_id, []).append(user_id)
    return children


def descendant_ids(session: Session, root_id: str) -> list[str]:
    """`root_id` plus every descendant, breadth-first; cycles are cut by `seen`."""
    children = _children_map(session)
    seen: set[str] = {root_id}
    order: list[str] = []
    queue: list[str] = [root_id]
    while queue:
        current = queue.pop(0)
        order.append(current)
        for child in children.get(current, ()):
            if child in seen:
                continue
            seen.add(child)
            queue.append(child)
    return order


def descendants(session: Session, root_id: str) -> list[UserORM]:
    """ORM rows of `root_id` and its descendants, breadth-first."""
    rows = {row.id: row for row in session.scalars(select(UserORM)).all()}
    return [rows[user_id] for user_id in descendant_ids(session, root_id) if user_id in rows]


def snapshot(session: Session) -> dict:
    """Tree metrics for the whole table: depth, direct children, subtree size."""
    rows = [row for row in session.scalars(select(UserORM)).all() if not is_system_user(row)]
    by_id = {row.id: row for row in rows}
    children = {row.id: 0 for row in rows}
    sizes = {row.id: 1 for row in rows}
    depths: dict[str, int] = {}

    def depth_of(user_id: str) -> int:
        if user_id in depths:
            return depths[user_id]
        seen: set[str] = set()
        depth = 0
        current = by_id.get(user_id)
        while (
            current is not None
            and current.parent_user_id in by_id
            and current.id not in seen
        ):
            seen.add(current.id)
            current = by_id[current.parent_user_id]
            depth += 1
        depths[user_id] = depth
        return depth

    for row in rows:
        if row.parent_user_id in children:
            children[row.parent_user_id] += 1
    # Deepest rows first so each parent accumulates its complete subtree.
    for row in sorted(rows, key=lambda item: depth_of(item.id), reverse=True):
        if row.parent_user_id in sizes:
            sizes[row.parent_user_id] += sizes[row.id]
    root = next(
        (row for row in rows if row.name == ROOT_USER_NAME and row.parent_user_id is None),
        None,
    )
    return {
        "root_id": root.id if root is not None else None,
        "nodes": {
            row.id: {
                "depth": depth_of(row.id),
                "direct_children": children[row.id],
                "subtree_size": sizes[row.id],
            }
            for row in rows
        },
    }


# ---------------------------------------------------------------- scope


def has_global_scope(principal: Principal) -> bool:
    """True for an unrestricted role (the built-in 管理用户 role holds every key)."""
    return rbac.PERMISSION_KEYS <= frozenset(principal.permissions)


def principal_node(session: Session, principal: Principal) -> UserORM | None:
    """The users row behind this console login: identity, not a linkage column.

    ADR-019: session.admin_id IS users.id; a login whose row was deleted
    (e.g. soft-deleted while the session was alive) has no node at all.
    """
    return session.get(UserORM, principal.admin_id)


def _role_key_for(principal: Principal) -> str:
    if principal.role in rbac.BUILTIN_ROLE_KEYS:
        return principal.role
    return rbac.BUILTIN_ROLE_CUSTOMER


def ensure_principal_node(session: Session, principal: Principal) -> UserORM:
    """Return the login's own user row, recreating it under root if it vanished.

    Can only miss when the row was deleted while a session stayed alive; the
    recreated row reuses the same id so the session keeps resolving to it.
    """
    node = principal_node(session, principal)
    if node is not None:
        return node
    root = ensure_root_user(session)
    node = UserORM(
        id=principal.admin_id,
        name=principal.name or principal.username,
        username=principal.username or None,
        balance_micro=0,
        role=_role_key_for(principal),
        parent_user_id=root.id,
        status="active",
        created_at_ms=now_ms(),
        updated_at_ms=now_ms(),
    )
    session.add(node)
    session.flush()
    return node


def visible_ids(session: Session, principal: Principal) -> frozenset[str] | None:
    """User ids this principal may read; None means "all users"."""
    if has_global_scope(principal):
        return None
    node = principal_node(session, principal)
    if node is None:
        return frozenset()
    if "billing:subtree" in principal.permissions:
        return frozenset(descendant_ids(session, node.id))
    return frozenset({node.id})


def can_see(session: Session, principal: Principal, user_id: str) -> bool:
    ids = visible_ids(session, principal)
    return ids is None or user_id in ids


def get_visible(session: Session, principal: Principal, user_id: str) -> UserORM:
    """Load one user inside the principal's scope; 404 unknown, 403 cross-branch."""
    row = session.get(UserORM, user_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"user not found: {user_id}")
    if not can_see(session, principal, user_id):
        raise AppError(
            ErrorCode.FORBIDDEN,
            "无权访问其它分支的用户",
            details={"user_id": user_id},
        )
    return row


def assert_parent_allowed(
    session: Session, principal: Principal, parent_id: str
) -> UserORM:
    """The chosen parent must be inside the caller's scope (no re-parenting out)."""
    return get_visible(session, principal, parent_id)


def assert_can_grant_role(session: Session, principal: Principal, role_key: str) -> str:
    """Only an unrestricted role may create/anoint another 管理用户."""
    if role_key == rbac.BUILTIN_ROLE_ADMIN and not has_global_scope(principal):
        raise AppError(
            ErrorCode.FORBIDDEN,
            "只有管理用户可分配管理用户角色",
            details={"role": role_key},
        )
    return role_key


def assert_no_cycle(session: Session, user_id: str, parent_id: str) -> None:
    """Re-parenting into one's own subtree would orphan the tree; reject it."""
    if user_id == parent_id:
        raise AppError(ErrorCode.VALIDATION_ERROR, "不能把用户挂到自己下面")
    current: str | None = parent_id
    seen: set[str] = set()
    while current:
        if current == user_id:
            raise AppError(ErrorCode.VALIDATION_ERROR, "不能把用户挂到自己的子树下")
        if current in seen:
            break
        seen.add(current)
        row = session.get(UserORM, current)
        current = row.parent_user_id if row is not None else None
