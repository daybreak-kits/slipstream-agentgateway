"""W6 ticket 21: DB role keys migrate user→customer and agent→reseller.

The HTTP seam is the acceptance boundary: the same users.id and session token
are used before and after ``scripts/migrate_roles_w6.py``, and the permission
list plus a representative set of reachable GET endpoints must not change.

The fixture starts the new code on purpose: ``create_app`` seeds the new built-in
role rows while the old user/agent rows still exist, which is the realistic
"deploy first, migrate second" database. The clean rename path, legacy
owner/operator/viewer folds, idempotency, CLI no-op and a diagnosable conflict
are covered as separate cases.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.migrate_roles_w6 import RoleMigrationConflict, run_role_migration
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from tests.conftest import DEMO_PASSWORD, _app_client, make_admin, new_session_token

from l04_repo.base import init_db
from l04_repo.orm import AdminRoleORM, UserORM
from l05_service import rbac
from l06_api.deps import SESSION_COOKIE

API_ROOT = Path(__file__).resolve().parents[2]

# Representative reads spanning the grants that differ between the three roles.
GET_PATHS = (
    "/admin/upstreams",
    "/admin/users",
    "/admin/roles",
    "/admin/reports/overview",
    "/admin/overview",
    "/admin/audit-logs",
    "/admin/policies",
    "/admin/settings",
    "/admin/prices/upstream",
    "/admin/reports/margin",
    "/admin/my/models",
)


def _legacy_customer_permissions() -> frozenset[str]:
    # Deliberately narrower than the new registry row: migration must preserve
    # the grants an existing user already had, not silently widen them.
    return rbac.role_definition("customer").permissions - {"playground:use"}


def _legacy_reseller_permissions() -> frozenset[str]:
    return rbac.role_definition("reseller").permissions - {"users:update"}


def _seed_legacy_role_rows(
    factory,
    *,
    customer_permissions: frozenset[str],
    reseller_permissions: frozenset[str],
) -> None:
    with factory() as session:
        session.add(
            AdminRoleORM(
                id="rol_legacy_admin",
                key="admin",
                name="管理用户",
                description="拥有全部权限，可维护角色、管理员与所有配置",
                builtin=True,
                all_permissions=True,
                permissions_json="[]",
                created_at_ms=1,
                updated_at_ms=1,
            )
        )
        session.add(
            AdminRoleORM(
                id="rol_legacy_user",
                key="user",
                name="普通用户",
                description="只读查看，可看自己的花费并试用模型",
                builtin=True,
                all_permissions=False,
                permissions_json=json.dumps(sorted(customer_permissions)),
                created_at_ms=1,
                updated_at_ms=1,
            )
        )
        session.add(
            AdminRoleORM(
                id="rol_legacy_agent",
                key="agent",
                name="代理用户",
                description="在普通用户基础上可创建下级并查看子树花费",
                builtin=True,
                all_permissions=False,
                permissions_json=json.dumps(sorted(reseller_permissions)),
                created_at_ms=1,
                updated_at_ms=1,
            )
        )
        session.commit()


def _seed_legacy_accounts(factory) -> dict[str, str]:
    return {
        "admin": make_admin(
            factory,
            username="legacy-admin",
            role="admin",
            password=DEMO_PASSWORD,
            user_id="usr_legacy_admin",
        ),
        "customer": make_admin(
            factory,
            username="legacy-customer",
            role="user",
            password=DEMO_PASSWORD,
            user_id="usr_legacy_customer",
        ),
        "reseller": make_admin(
            factory,
            username="legacy-reseller",
            role="agent",
            password=DEMO_PASSWORD,
            user_id="usr_legacy_reseller",
        ),
    }


def _snapshot(client, cookies: dict[str, str]) -> dict:
    me = client.get("/admin/auth/me", cookies=cookies)
    assert me.status_code == 200, me.text
    body = me.json()
    return {
        "role": body["role"],
        "permissions": body["permissions"],
        "endpoints": {
            path: client.get(path, cookies=cookies).status_code for path in GET_PATHS
        },
    }


def _role_rows(factory) -> dict[str, AdminRoleORM]:
    with factory() as session:
        return {row.key: row for row in session.scalars(select(AdminRoleORM)).all()}


def test_migration_keeps_permissions_and_endpoint_access(engine_and_sessionmaker):
    """Same user + same token: grants and reachable GETs are byte-for-byte stable."""
    _, factory = engine_and_sessionmaker
    customer_permissions = _legacy_customer_permissions()
    reseller_permissions = _legacy_reseller_permissions()
    _seed_legacy_role_rows(
        factory,
        customer_permissions=customer_permissions,
        reseller_permissions=reseller_permissions,
    )
    ids = _seed_legacy_accounts(factory)

    # New code starts first: it seeds admin/customer/reseller rows next to the
    # old user/agent rows, exactly like a deploy before the migration runs.
    client = _app_client(factory)
    cookies = {
        name: {SESSION_COOKIE: new_session_token(factory, user_id)}
        for name, user_id in ids.items()
    }
    before = {name: _snapshot(client, jar) for name, jar in cookies.items()}

    assert before["customer"]["role"] == "user"
    assert before["customer"]["permissions"] == sorted(customer_permissions)
    assert before["reseller"]["role"] == "agent"
    assert before["reseller"]["permissions"] == sorted(reseller_permissions)
    assert before["admin"]["permissions"] == sorted(rbac.PERMISSION_KEYS)

    with factory() as session:
        plan = run_role_migration(session, apply=True)
        session.commit()
        assert plan.users_updated == {"user": 1, "agent": 1}
        assert {item["new"] for item in plan.roles_merged} == {"customer", "reseller"}

    after = {name: _snapshot(client, jar) for name, jar in cookies.items()}
    for name in ids:
        assert after[name]["permissions"] == before[name]["permissions"], name
        assert after[name]["endpoints"] == before[name]["endpoints"], name
    assert after["customer"]["role"] == "customer"
    assert after["reseller"]["role"] == "reseller"
    assert after["admin"]["role"] == "admin"

    rows = _role_rows(factory)
    assert set(rows) == {"admin", "customer", "reseller"}
    assert rows["customer"].name == "客户"
    assert rows["reseller"].name == "分销商"
    assert json.loads(rows["customer"].permissions_json) == sorted(customer_permissions)
    assert json.loads(rows["reseller"].permissions_json) == sorted(reseller_permissions)

    with factory() as session:
        stored = {
            row.id: row.role for row in session.scalars(select(UserORM)).all()
            if row.id in ids.values()
        }
    assert stored == {
        ids["admin"]: "admin",
        ids["customer"]: "customer",
        ids["reseller"]: "reseller",
    }


def test_clean_legacy_database_renames_rows_in_place(engine_and_sessionmaker):
    """No new-code rows yet: the old built-ins are renamed, ids and grants stay."""
    _, factory = engine_and_sessionmaker
    customer_permissions = _legacy_customer_permissions()
    reseller_permissions = _legacy_reseller_permissions()
    _seed_legacy_role_rows(
        factory,
        customer_permissions=customer_permissions,
        reseller_permissions=reseller_permissions,
    )
    _seed_legacy_accounts(factory)

    with factory() as session:
        plan = run_role_migration(session, apply=True)
        session.commit()

    assert plan.users_updated == {"user": 1, "agent": 1}
    assert {item["old"] for item in plan.roles_renamed} == {"user", "agent"}
    rows = _role_rows(factory)
    assert set(rows) == {"admin", "customer", "reseller"}
    assert rows["customer"].id == "rol_legacy_user"
    assert rows["reseller"].id == "rol_legacy_agent"
    assert rows["customer"].name == "客户"
    assert rows["reseller"].name == "分销商"
    assert json.loads(rows["customer"].permissions_json) == sorted(customer_permissions)
    assert json.loads(rows["reseller"].permissions_json) == sorted(reseller_permissions)


def test_historical_aliases_fold_to_canonical_roles(engine_and_sessionmaker):
    """owner/operator/viewer rows keep their old effective grant sets."""
    _, factory = engine_and_sessionmaker
    _seed_legacy_role_rows(
        factory,
        customer_permissions=_legacy_customer_permissions(),
        reseller_permissions=_legacy_reseller_permissions(),
    )
    ids = {
        "owner": make_admin(factory, username="legacy-owner", role="owner"),
        "operator": make_admin(factory, username="legacy-operator", role="operator"),
        "viewer": make_admin(factory, username="legacy-viewer", role="viewer"),
    }

    with factory() as session:
        plan = run_role_migration(session, apply=True)
        session.commit()
    assert plan.users_updated == {"owner": 1, "operator": 1, "viewer": 1}

    with factory() as session:
        stored = {row.id: row.role for row in session.scalars(select(UserORM)).all()}
    assert stored == {
        ids["owner"]: "admin",
        ids["operator"]: "reseller",
        ids["viewer"]: "customer",
    }

    # The canonical grant sets after migration are exactly the old alias targets.
    client = _app_client(factory)
    expected = {
        "owner": rbac.PERMISSION_KEYS,
        "operator": _legacy_reseller_permissions(),
        "viewer": _legacy_customer_permissions(),
    }
    for name, user_id in ids.items():
        jar = {SESSION_COOKIE: new_session_token(factory, user_id)}
        body = client.get("/admin/auth/me", cookies=jar).json()
        assert body["permissions"] == sorted(expected[name]), name


def test_second_run_is_a_no_op(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_legacy_role_rows(
        factory,
        customer_permissions=_legacy_customer_permissions(),
        reseller_permissions=_legacy_reseller_permissions(),
    )
    _seed_legacy_accounts(factory)
    with factory() as session:
        first = run_role_migration(session, apply=True)
        session.commit()
    assert first.users_updated

    with factory() as session:
        before_roles = session.scalars(
            select(AdminRoleORM).order_by(AdminRoleORM.key)
        ).all()
        before_users = session.scalars(select(UserORM).order_by(UserORM.id)).all()
        before_role_snapshot = [
            (row.id, row.key, row.name, row.permissions_json, row.all_permissions)
            for row in before_roles
        ]
        before_user_snapshot = [(row.id, row.role) for row in before_users]

        second = run_role_migration(session, apply=True)
        session.commit()

        after_roles = session.scalars(
            select(AdminRoleORM).order_by(AdminRoleORM.key)
        ).all()
        after_users = session.scalars(select(UserORM).order_by(UserORM.id)).all()
        assert [
            (row.id, row.key, row.name, row.permissions_json, row.all_permissions)
            for row in after_roles
        ] == before_role_snapshot
        assert [(row.id, row.role) for row in after_users] == before_user_snapshot

    assert not second.users_updated
    assert not second.roles_renamed
    assert not second.roles_merged


def test_dry_run_writes_nothing(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_legacy_role_rows(
        factory,
        customer_permissions=_legacy_customer_permissions(),
        reseller_permissions=_legacy_reseller_permissions(),
    )
    _seed_legacy_accounts(factory)

    with factory() as session:
        plan = run_role_migration(session, apply=False)
        assert plan.users_updated == {"user": 1, "agent": 1}
        assert session.scalars(select(AdminRoleORM).where(AdminRoleORM.key == "user")).first()
        assert (
            session.scalars(select(UserORM).where(UserORM.role == "user")).first()
            is not None
        )
        session.rollback()


def test_conflict_is_diagnosed_before_any_write(engine_and_sessionmaker):
    """A custom role already owning the target key cannot be merged silently."""
    _, factory = engine_and_sessionmaker
    with factory() as session:
        session.add(
            AdminRoleORM(
                id="rol_legacy_user",
                key="user",
                name="普通用户",
                description="",
                builtin=True,
                all_permissions=False,
                permissions_json=json.dumps(sorted(_legacy_customer_permissions())),
                created_at_ms=1,
                updated_at_ms=1,
            )
        )
        session.add(
            AdminRoleORM(
                id="rol_custom_customer",
                key="customer",
                name="自定义客户",
                description="",
                builtin=False,
                all_permissions=False,
                permissions_json=json.dumps(["upstreams:read"]),
                created_at_ms=1,
                updated_at_ms=1,
            )
        )
        session.commit()
    user_id = make_admin(factory, username="conflict-user", role="user")

    with factory() as session:
        with pytest.raises(RoleMigrationConflict) as raised:
            run_role_migration(session, apply=True)
        session.rollback()
    message = str(raised.value)
    assert "user" in message and "customer" in message
    assert "customer" in message  # target key is part of the diagnostic

    with factory() as session:
        assert session.get(UserORM, user_id).role == "user"
        keys = {row.key for row in session.scalars(select(AdminRoleORM)).all()}
        assert {"user", "customer"} <= keys


def _sqlite_factory(db_path: Path):
    engine = create_engine("sqlite:///" + db_path.as_posix(), future=True)
    init_db(engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)


def _run_cli(db_path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }
    return subprocess.run(
        [
            sys.executable,
            "scripts/migrate_roles_w6.py",
            "--database-url",
            "sqlite:///" + db_path.as_posix(),
            *extra,
        ],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def test_cli_dry_run_apply_and_second_run_noop(tmp_path: Path):
    db_path = tmp_path / "roles.db"
    engine, factory = _sqlite_factory(db_path)
    _seed_legacy_role_rows(
        factory,
        customer_permissions=_legacy_customer_permissions(),
        reseller_permissions=_legacy_reseller_permissions(),
    )
    _seed_legacy_accounts(factory)

    dry = _run_cli(db_path, "--json")
    assert dry.returncode == 0, dry.stderr[-2000:]
    assert json.loads(dry.stdout)["applied"] is False
    with factory() as session:
        assert session.scalars(select(UserORM).where(UserORM.role == "user")).first()

    applied = _run_cli(db_path, "--apply", "--json")
    assert applied.returncode == 0, applied.stderr[-2000:]
    payload = json.loads(applied.stdout)
    assert payload["applied"] is True
    assert payload["users_updated"] == {"user": 1, "agent": 1}
    with factory() as session:
        roles = {row.key for row in session.scalars(select(AdminRoleORM)).all()}
        users = {row.role for row in session.scalars(select(UserORM)).all()}
    assert roles == {"admin", "customer", "reseller"}
    assert users <= {"admin", "customer", "reseller"}

    second = _run_cli(db_path, "--apply", "--json")
    assert second.returncode == 0, second.stderr[-2000:]
    second_payload = json.loads(second.stdout)
    assert second_payload["users_updated"] == {}
    assert second_payload["roles_renamed"] == []
    assert second_payload["roles_merged"] == []
    engine.dispose()
