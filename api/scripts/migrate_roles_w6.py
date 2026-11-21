"""Rename console role keys user→customer, agent→reseller (W6 ticket 21).

Dry-run by default: prints the planned rename and counts. Pass ``--apply`` to
write it. The script is idempotent — a database that has already been migrated
reports zero changes and writes nothing.

Rules (ticket 21 + docs/GLOSSARY.md §7):
- ``users.role`` and ``admin_roles.key`` move user→customer and agent→reseller.
- The historical database names owner/operator/viewer are folded in the same
  pass (owner→admin, operator→reseller, viewer→customer), because the alias
  layer is removed with this change: old rows must not lose access.
- Permissions and access scope are preserved: an existing built-in row brings
  its grants along even when the new code already seeded the target key. Two
  old keys that map to one target must carry identical grants; a collision with
  a custom role is a hard, diagnosable failure (no silent merge).
- Display names become 客户 / 分销商 (admin keeps 管理用户).
- No old key remains an alias: the app has no built-in definition for it. A
  pre-migration database may still have old admin_roles/users.role rows; this
  script renames or merges them rather than mapping them to the new builtin in
  code, so run it before the new code serves users.

Run from the api directory:

    ./.venv/Scripts/python.exe scripts/migrate_roles_w6.py                 # dry-run
    ./.venv/Scripts/python.exe scripts/migrate_roles_w6.py --apply         # write
    ./.venv/Scripts/python.exe scripts/migrate_roles_w6.py --apply --json  # machine-readable
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, inspect, select, update

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from l01_core.settings import get_settings  # noqa: E402
from l04_repo.base import init_db, make_engine, make_sessionmaker  # noqa: E402
from l04_repo.orm import AdminRoleORM, UserORM  # noqa: E402
from l05_service import rbac, roles  # noqa: E402

# Old key -> new canonical key. Keep this mapping in the migration only: rbac
# deliberately has no alias table any more.
ROLE_RENAMES: dict[str, str] = {
    "user": rbac.BUILTIN_ROLE_CUSTOMER,
    "viewer": rbac.BUILTIN_ROLE_CUSTOMER,
    "agent": rbac.BUILTIN_ROLE_RESELLER,
    "operator": rbac.BUILTIN_ROLE_RESELLER,
    "owner": rbac.BUILTIN_ROLE_ADMIN,
}

# One target may absorb several historical keys; grant sets must agree.
TARGET_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("customer", ("user", "viewer")),
    ("reseller", ("agent", "operator")),
    ("admin", ("owner",)),
)

BUILTIN_DISPLAY: dict[str, tuple[str, str]] = {
    "admin": ("管理用户", "拥有全部权限，可维护角色、管理员与所有配置"),
    "customer": ("客户", "只读查看，可看自己的花费并试用模型"),
    "reseller": ("分销商", "在客户基础上可创建下级并查看子树花费"),
}


def canonical_role_key(role_key: str) -> str:
    """Map a retired DB role name to its new key (unknown/custom keys unchanged).

    The historical unify-users script uses this so a database folded after the
    switch cannot reintroduce the retired keys.
    """
    return ROLE_RENAMES.get(role_key, role_key)


class RoleMigrationError(RuntimeError):
    """Base class for a diagnosable migration failure."""


class RoleMigrationConflict(RoleMigrationError):
    """A rename would silently change someone's grants; nothing was written."""


@dataclass
class RoleMigrationPlan:
    """Every action of one pass; doubles as the printed/statistics payload."""

    users_updated: dict[str, int] = field(default_factory=dict)
    roles_renamed: list[dict] = field(default_factory=list)
    roles_merged: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "users_updated": dict(self.users_updated),
            "roles_renamed": self.roles_renamed,
            "roles_merged": self.roles_merged,
            "warnings": self.warnings,
        }


def _ensure_schema(session) -> None:
    inspector = inspect(session.connection())
    missing = [
        table
        for table in ("users", "admin_roles")
        if not inspector.has_table(table)
    ]
    if missing:
        raise RoleMigrationError(
            "数据库缺少表 "
            + ", ".join(missing)
            + "；请先启动一次控制面（init_db）或运行 seed，再执行角色迁移"
        )


def _grants(row: AdminRoleORM) -> frozenset[str] | str:
    """Comparable grant fingerprint; invalid JSON is a hard diagnostic."""
    if row.all_permissions:
        return "*"
    try:
        data = json.loads(row.permissions_json or "[]")
    except (TypeError, ValueError) as exc:
        raise RoleMigrationError(
            f"角色 {row.key} ({row.id}) 的 permissions_json 不是合法 JSON: {exc}"
        ) from exc
    if not isinstance(data, list):
        raise RoleMigrationError(
            f"角色 {row.key} ({row.id}) 的 permissions_json 不是数组"
        )
    return frozenset(str(item) for item in data)


def _grant_diff(rows: list[AdminRoleORM]) -> bool:
    return len({_grants(row) for row in rows}) > 1


def _build_plan(
    session,
    rows_by_key: dict[str, AdminRoleORM],
    user_counts: dict[str, int],
) -> RoleMigrationPlan:
    """Decide every action without writing; conflicts abort the whole pass."""
    plan = RoleMigrationPlan()

    for target_key, old_keys in TARGET_GROUPS:
        sources = [
            (old, rows_by_key[old]) for old in old_keys if old in rows_by_key
        ]
        target = rows_by_key.get(target_key)

        if _grant_diff([row for _, row in sources]):
            raise RoleMigrationConflict(
                f"旧角色 {', '.join(old for old, _ in sources)} 都映射到 "
                f"{target_key}，但权限集合不同；无法在不改变现有访问范围的前提下合并"
            )

        if target is not None and sources:
            target_builtin = bool(target.builtin)
            source_builtins = {bool(row.builtin) for _, row in sources}
            if target_builtin not in source_builtins or len(source_builtins) > 1:
                raise RoleMigrationConflict(
                    f"角色 {target_key}（id={target.id}, builtin={target_builtin}）"
                    f"与旧角色 {', '.join(old for old, _ in sources)} 的内置属性不同；"
                    "拒绝静默合并"
                )
            if _grants(target) != _grants(sources[0][1]) and user_counts.get(
                target_key, 0
            ):
                raise RoleMigrationConflict(
                    f"角色 {target_key} 已有 {user_counts[target_key]} 个成员，"
                    f"但旧角色 {sources[0][0]} 的权限集合不同；"
                    "拒绝改变现有成员的访问范围"
                )

        representative = sources[0][1] if sources else target
        if target is not None:
            kept_id = target.id
            for old, row in sources:
                plan.roles_merged.append(
                    {
                        "id": row.id,
                        "old": old,
                        "new": target_key,
                        "kept_id": kept_id,
                    }
                )
        else:
            kept_id = representative.id if representative is not None else ""
            for index, (old, row) in enumerate(sources):
                if index == 0:
                    plan.roles_renamed.append(
                        {"id": row.id, "old": old, "new": target_key}
                    )
                else:
                    plan.roles_merged.append(
                        {
                            "id": row.id,
                            "old": old,
                            "new": target_key,
                            "kept_id": kept_id,
                        }
                    )
            if sources and not representative.builtin:
                raise RoleMigrationConflict(
                    f"自定义角色 {sources[0][0]}（id={representative.id}）占用旧键，"
                    f"但 {target_key} 是内置保留键；拒绝把自定义角色改名为内置角色"
                )

        for old in old_keys:
            count = user_counts.get(old, 0)
            if count:
                plan.users_updated[old] = count

    unknown = sorted(
        key
        for key in user_counts
        if key
        and key not in rows_by_key
        and key not in rbac.BUILTIN_ROLE_KEYS
        and key not in ROLE_RENAMES
    )
    for key in unknown:
        plan.warnings.append(
            f"users.role={key!r} 在 admin_roles 中没有定义；迁移不处理自定义键，"
            "请确认该角色是否为孤儿数据"
        )
    return plan


def run_role_migration(session, *, apply: bool) -> RoleMigrationPlan:
    """One migration pass; writes only when apply=True, otherwise reports.

    The decision loop is shared by dry-run and apply so the printed plan and the
    written result cannot diverge. Idempotency is structural: the source keys
    simply do not exist after a successful pass, so a re-run plans nothing.
    """
    _ensure_schema(session)
    rows_by_key = {
        row.key: row for row in session.scalars(select(AdminRoleORM)).all()
    }
    user_counts = {
        str(key): int(count)
        for key, count in session.execute(
            select(UserORM.role, func.count()).group_by(UserORM.role)
        ).all()
    }
    plan = _build_plan(session, rows_by_key, user_counts)
    if not apply:
        return plan

    # Apply the role-row side first: the grant copy onto an existing new-code
    # row must happen before users are pointed at it.
    for target_key, old_keys in TARGET_GROUPS:
        sources = [
            (old, rows_by_key[old]) for old in old_keys if old in rows_by_key
        ]
        target = rows_by_key.get(target_key)
        if sources:
            representative = sources[0][1]
            if target is not None:
                # Preserve the grants existing members already have, then
                # retire the old row. (The plan already refused this when
                # target members would be affected by a different grant set.)
                target.permissions_json = representative.permissions_json
                target.all_permissions = representative.all_permissions
                if target.builtin and target_key in BUILTIN_DISPLAY:
                    target.name, target.description = BUILTIN_DISPLAY[target_key]
                for _old, row in sources:
                    session.delete(row)
                rows_by_key.pop(target_key, None)
                rows_by_key[target_key] = target
            else:
                representative.key = target_key
                if representative.builtin and target_key in BUILTIN_DISPLAY:
                    representative.name, representative.description = BUILTIN_DISPLAY[
                        target_key
                    ]
                for _old, row in sources[1:]:
                    session.delete(row)
                for old, _row in sources:
                    rows_by_key.pop(old, None)
                rows_by_key[target_key] = representative

        # Users can carry a retired key even when its admin_roles row is gone
        # (the old code fell back to the built-in definition). Always rewrite.
        for old in old_keys:
            session.execute(
                update(UserORM).where(UserORM.role == old).values(role=target_key)
            )

    session.flush()
    # A database where the old built-in row was missing entirely still needs
    # the canonical rows; this is a no-op once all three exist.
    roles.ensure_builtin_roles(session)
    return plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url", default=None, help="defaults to SLIPSTREAM_DATABASE_URL"
    )
    parser.add_argument(
        "--apply", action="store_true", help="write the migration (default: dry-run)"
    )
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    url = args.database_url or get_settings().database_url
    engine = make_engine(url)
    init_db(engine)
    factory = make_sessionmaker(engine)
    try:
        with factory() as session:
            plan = run_role_migration(session, apply=args.apply)
            if args.apply:
                session.commit()
            payload = {"database_url": url, "applied": bool(args.apply), **plan.as_dict()}
    except RoleMigrationError as exc:
        print(f"迁移失败: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - any DB failure must stay diagnosable
        print(f"迁移失败: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    verb = "已落库" if args.apply else "预演（加 --apply 落库）"
    print(f"角色 key 迁移 {verb}; {url}")
    updated = payload["users_updated"]
    print(
        "统计: 用户改键 "
        + (
            "、".join(f"{old}→{ROLE_RENAMES[old]} {count}" for old, count in updated.items())
            if updated
            else "0"
        )
        + f" | 角色改名 {len(payload['roles_renamed'])}"
        + f" | 角色合并 {len(payload['roles_merged'])}"
        + f" | 警告 {len(payload['warnings'])}"
    )
    for item in payload["roles_renamed"]:
        print(f"  改名: role {item['id']}: {item['old']} -> {item['new']}")
    for item in payload["roles_merged"]:
        print(
            f"  合并: role {item['id']}: {item['old']} -> {item['new']}"
            f"（保留 {item['kept_id']}）"
        )
    for warning in payload["warnings"]:
        print(f"  警告: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
