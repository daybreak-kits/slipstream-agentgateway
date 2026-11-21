"""Fold admin_users into users (ADR-019): one user table, one login identity.

Dry-run by default: prints the planned merge. Pass --apply to write it. The
script is idempotent — an admin whose username already lives on the linked
users row (same hash) is skipped, so re-running after a partial run is safe.

Rules (docs/DECISIONS.md ADR-019 + W1b task card):
- admin_users rows linked through users.admin_user_id merge IN PLACE: the user
  row receives the admin's username and password hash.
- Unlinked admin rows become NEW users rows hanging under the tree root D.
- username conflicts always favour admin_users; a displaced users row is
  renamed `<name>-merged<N>` (loop-safe: N grows until the name is free).
- admin_sessions.admin_id is remapped onto the merged users row so existing
  logins keep working. No table is dropped; users.admin_user_id stays as the
  retired linkage column.

Run from the api directory:

    PYTHONPATH=src python scripts/migrate_unify_users.py                 # dry-run
    PYTHONPATH=src python scripts/migrate_unify_users.py --apply        # write
    PYTHONPATH=src python scripts/migrate_unify_users.py --apply --json # machine-readable
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import (
    BigInteger,
    Column,
    MetaData,
    String,
    Table,
    func,
    select,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from scripts.migrate_roles_w6 import canonical_role_key  # noqa: E402

from l01_core.ids import new_id  # noqa: E402
from l01_core.settings import get_settings  # noqa: E402
from l01_core.timeutil import now_ms  # noqa: E402
from l04_repo.base import init_db, make_engine, make_sessionmaker  # noqa: E402
from l04_repo.orm import AdminSessionORM, UserORM  # noqa: E402

MERGE_SUFFIX = "-merged"

# The retired admin_users table (ADR-019) is no longer part of the live ORM
# schema: init_db never creates it, so the migration owns its definition here.
# A separate MetaData keeps it out of Base.metadata (create_all must not
# resurrect the table); the Core Table is only ever SELECTed, never created.
LEGACY_ADMIN_USERS = Table(
    "admin_users",
    MetaData(),
    Column("id", String(64), primary_key=True),
    Column("username", String(255)),
    Column("password_hash", String(256)),
    Column("role", String(32)),
    Column("display_name", String(255)),
    Column("status", String(16)),
    Column("created_at_ms", BigInteger),
    Column("updated_at_ms", BigInteger),
)


def _legacy_admin_rows(session) -> list:
    """The admin_users rows of an old database; [] when the table is gone.

    Unified-era databases (created after ADR-019) have no admin_users table at
    all, so a run against them must be a clean no-op instead of an SQL error.
    """
    from sqlalchemy import inspect

    if not inspect(session.connection()).has_table("admin_users"):
        return []
    return list(
        session.execute(
            select(LEGACY_ADMIN_USERS)
            .order_by(LEGACY_ADMIN_USERS.c.created_at_ms, LEGACY_ADMIN_USERS.c.id)
        ).all()
    )


@dataclass
class MergePlan:
    """Every action of one pass; doubles as the printed/statistics payload."""

    linked_merges: list[dict] = field(default_factory=list)
    new_rows: list[dict] = field(default_factory=list)
    renames: list[dict] = field(default_factory=list)
    session_remaps: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    admin_total: int = 0
    users_total: int = 0

    def as_dict(self) -> dict:
        return {
            "admin_rows": self.admin_total,
            "linked_merges": self.linked_merges,
            "new_rows": self.new_rows,
            "renames": self.renames,
            "session_remaps": self.session_remaps,
            "skipped": self.skipped,
            "users_total": self.users_total,
        }


def _live_username_holder(session, username: str) -> UserORM | None:
    """The users row currently occupying a username (NULL usernames never match)."""
    return session.scalars(
        select(UserORM).where(UserORM.username == username)
    ).first()


def _root_row(session) -> UserORM | None:
    """The tree root D (parent-less, oldest first); None only on an empty table."""
    return session.scalars(
        select(UserORM)
        .where(UserORM.parent_user_id.is_(None))
        .order_by(UserORM.created_at_ms, UserORM.id)
    ).first()


def run_unify_users(session, *, apply: bool) -> MergePlan:
    """One merge pass; writes only when apply=True, otherwise reports the plan.

    The decision loop is shared by dry-run and apply so the printed plan and
    the written result can never diverge. Pending usernames are tracked in
    memory, which keeps rename accounting accurate inside a single pass.

    Idempotency: rows created for unlinked admins get the retired
    users.admin_user_id stamped with their admin id — the migration is the only
    writer of that column, and the stamp is what makes a re-run recognise its
    own output ("linked merge, username+hash already equal -> skip").
    """
    plan = MergePlan()
    stamp = now_ms()
    admins = _legacy_admin_rows(session)
    plan.admin_total = len(admins)
    root = _root_row(session)
    # username -> user id that WILL hold it once this pass lands (dry-run aware).
    pending: dict[str, str] = {}
    rename_counter = 0

    for admin in admins:
        target = session.scalars(
            select(UserORM).where(UserORM.admin_user_id == admin.id)
        ).first()
        if target is not None:
            if target.username == admin.username and target.password_hash == admin.password_hash:
                plan.skipped.append({"admin_id": admin.id, "username": admin.username})
                continue
            plan.linked_merges.append(
                {"admin_id": admin.id, "username": admin.username, "user_id": target.id}
            )
            pending[admin.username] = target.id
            if apply:
                target.username = admin.username
                target.password_hash = admin.password_hash
                target.updated_at_ms = stamp
            continue

        holder = _live_username_holder(session, admin.username)
        if holder is None and admin.username in pending:
            holder = session.get(UserORM, pending[admin.username])
        if holder is not None and holder.id == pending.get(admin.username):
            # Assigned earlier in this very pass (rename or create).
            plan.skipped.append({"admin_id": admin.id, "username": admin.username})
            continue
        if root is None:
            plan.skipped.append(
                {"admin_id": admin.id, "username": admin.username, "reason": "no root user"}
            )
            continue

        # ADR-019 conflict rule: admin_users wins the username; the displaced
        # users row is renamed <name>-merged<N> until the name is free. The
        # unique index means at most ONE live row occupies the name, so a
        # single rename frees it — no re-query (sessions run autoflush=False).
        if holder is not None:
            base = holder.name or holder.username or "user"
            displaced = f"{base}{MERGE_SUFFIX}{rename_counter + 1}"
            rename_counter += 1
            while _live_username_holder(session, displaced) is not None or displaced in pending:
                rename_counter += 1
                displaced = f"{base}{MERGE_SUFFIX}{rename_counter}"
            plan.renames.append(
                {"user_id": holder.id, "old": holder.username, "new": displaced}
            )
            pending[displaced] = holder.id
            if apply:
                holder.username = displaced
                holder.updated_at_ms = stamp

        user_id = new_id("user")
        plan.new_rows.append(
            {
                "admin_id": admin.id,
                "username": admin.username,
                "user_id": user_id,
                "under_root": root.id,
            }
        )
        pending[admin.username] = user_id
        if apply:
            session.add(
                UserORM(
                    id=user_id,
                    name=admin.display_name or admin.username,
                    username=admin.username,
                    password_hash=admin.password_hash,
                    balance_micro=0,
                    role=canonical_role_key(admin.role),
                    parent_user_id=root.id,
                    status=admin.status,
                    admin_user_id=admin.id,  # merge ledger only; retired column
                    created_at_ms=admin.created_at_ms or stamp,
                    updated_at_ms=stamp,
                )
            )
            session.flush()

    # Remap live sessions onto the merged users rows so nobody is logged out.
    # (Legacy admin rows are Core rows, so the lookup is a dict instead of a join.)
    if apply and admins:
        admin_by_id = {admin.id: admin for admin in admins}
        session_rows = session.scalars(
            select(AdminSessionORM).where(
                AdminSessionORM.admin_id.in_(list(admin_by_id))
            )
        ).all()
        for session_row in session_rows:
            admin = admin_by_id.get(session_row.admin_id)
            if admin is None:
                continue
            target = session.scalars(
                select(UserORM).where(UserORM.admin_user_id == admin.id)
            ).first()
            if target is None and admin.username in pending:
                target = session.get(UserORM, pending[admin.username])
            if target is None or session_row.admin_id == target.id:
                continue
            plan.session_remaps.append(
                {"session_id": session_row.id, "from": session_row.admin_id, "to": target.id}
            )
            session_row.admin_id = target.id

    users_total = int(session.scalar(select(func.count()).select_from(UserORM)) or 0)
    if not apply:
        # Dry-run projection: the created rows are not flushed yet.
        users_total += len(plan.new_rows)
    plan.users_total = users_total
    return plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=None, help="defaults to SLIPSTREAM_DATABASE_URL")
    parser.add_argument("--apply", action="store_true", help="write the merge (default: dry-run)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    url = args.database_url or get_settings().database_url
    engine = make_engine(url)
    init_db(engine)
    factory = make_sessionmaker(engine)
    try:
        with factory() as session:
            plan = run_unify_users(session, apply=args.apply)
            if args.apply:
                session.commit()
            payload = {"database_url": url, "applied": bool(args.apply), **plan.as_dict()}
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        verb = "已合并" if args.apply else "预演（加 --apply 落库）"
        print(f"admin_users -> users {verb}; {url}")
        print(
            "统计: admin 行 {admin_rows} | 就地并入 {linked} | 新建挂根 {created} | "
            "改名 {renamed} | 会话改道 {remapped} | 跳过 {skipped} | users 总数 {total}".format(
                admin_rows=payload["admin_rows"],
                linked=len(payload["linked_merges"]),
                created=len(payload["new_rows"]),
                renamed=len(payload["renames"]),
                remapped=len(payload["session_remaps"]),
                skipped=len(payload["skipped"]),
                total=payload["users_total"],
            )
        )
        for item in payload["linked_merges"]:
            print(
                f"  并入: admin {item['admin_id']} -> user {item['user_id']}"
                f" ({item['username']})"
            )
        for item in payload["new_rows"]:
            print(
                f"  新建: admin {item['admin_id']} -> user {item['user_id']}"
                f" 挂根 ({item['username']})"
            )
        for item in payload["renames"]:
            print(f"  改名: user {item['user_id']}: {item['old']} -> {item['new']}")
        for item in payload["session_remaps"]:
            print(f"  会话: {item['session_id']}: {item['from']} -> {item['to']}")
        if payload["skipped"]:
            print(f"  跳过 {len(payload['skipped'])} 行（已并入或无根用户）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
