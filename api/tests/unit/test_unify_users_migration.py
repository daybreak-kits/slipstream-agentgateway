"""ADR-019 migration: admin_users folds into users (scripts/migrate_unify_users).

Covers the three mandated behaviours on an old-shape database: linked rows
merge in place, unlinked rows become new users under root D, and username
conflicts favour admin_users while the displaced row is renamed
`<name>-merged<N>`. Also proves idempotency and session remapping.

admin_users is retired from the live ORM, so the fixture creates the legacy
table via the migration script's own Core definition and inserts rows with it.
"""

from __future__ import annotations

import pytest
from scripts.migrate_unify_users import LEGACY_ADMIN_USERS, run_unify_users

from l04_repo.orm import AdminSessionORM, UserORM
from l05_service import auth


def _create_legacy_table(engine) -> None:
    """Give this test engine the retired admin_users table (init_db no longer does)."""
    LEGACY_ADMIN_USERS.metadata.create_all(bind=engine)


def _add_user(
    session,
    uid: str,
    name: str,
    *,
    username: str | None = None,
    parent: str | None = None,
    admin_user_id: str | None = None,
    role: str = "user",
) -> None:
    session.add(
        UserORM(
            id=uid,
            name=name,
            username=username,
            parent_user_id=parent,
            admin_user_id=admin_user_id,
            role=role,
            status="active",
            created_at_ms=0,
        )
    )


def _add_admin(
    session,
    admin_id: str,
    username: str,
    *,
    role: str = "agent",
    display_name: str = "",
    password: str = "Adm1n-pw-2026",
) -> None:
    session.execute(
        LEGACY_ADMIN_USERS.insert().values(
            id=admin_id,
            username=username,
            display_name=display_name or username,
            password_hash=auth.hash_password(password),
            role=role,
            status="active",
            created_at_ms=0,
        )
    )


def test_linked_admin_merges_in_place(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        root = ensure_root_user(session)
        _add_user(session, "usr_1", "李四", parent=root.id, admin_user_id="adm_1")
        _add_admin(session, "adm_1", "lisi", role="agent")
        session.commit()

        plan = run_unify_users(session, apply=True)
        session.commit()

        assert len(plan.linked_merges) == 1 and not plan.new_rows
        merged = session.get(UserORM, "usr_1")
        assert merged.username == "lisi"
        assert auth.verify_password("Adm1n-pw-2026", merged.password_hash)


def test_unlinked_admin_becomes_new_row_under_root(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        root = ensure_root_user(session)
        _add_admin(session, "adm_new", "新管理员", role="admin", display_name="张三")
        session.commit()

        plan = run_unify_users(session, apply=True)
        session.commit()

        assert len(plan.new_rows) == 1
        row = session.get(UserORM, plan.new_rows[0]["user_id"])
        assert row.username == "新管理员"
        assert row.name == "张三"
        assert row.role == "admin"
        assert row.parent_user_id == root.id
        # Merge ledger: a re-run must recognise its own output.
        assert row.admin_user_id == "adm_new"


def test_username_conflict_favours_admin_and_renames_holder(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        root = ensure_root_user(session)
        # A users row already occupies the username (unified-era data).
        _add_user(session, "usr_holder", "同名者", username="dup", parent=root.id)
        _add_admin(session, "adm_dup", "dup", role="user")
        session.commit()

        plan = run_unify_users(session, apply=True)
        session.commit()

        assert len(plan.renames) == 1
        assert plan.renames[0]["new"] == "同名者-merged1"
        holder = session.get(UserORM, "usr_holder")
        assert holder.username == "同名者-merged1"
        created = session.get(UserORM, plan.new_rows[0]["user_id"])
        assert created.username == "dup"


def test_second_run_is_a_no_op(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        root = ensure_root_user(session)
        _add_user(session, "usr_1", "李四", parent=root.id, admin_user_id="adm_1")
        _add_admin(session, "adm_1", "lisi")
        _add_admin(session, "adm_2", "fresh-admin")
        session.commit()

        first = run_unify_users(session, apply=True)
        session.commit()
        assert first.linked_merges and first.new_rows

        second = run_unify_users(session, apply=True)
        session.commit()
        assert not second.linked_merges and not second.new_rows and not second.renames
        assert len(second.skipped) == 2
        assert second.users_total == first.users_total


def test_live_sessions_remap_to_merged_users_row(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        ensure_root_user(session)
        _add_user(session, "usr_1", "李四", parent=None, admin_user_id="adm_1")
        _add_admin(session, "adm_1", "lisi")
        session.add(
            AdminSessionORM(
                id="ses_old",
                admin_id="adm_1",
                token_hash="a" * 64,
                created_at_ms=0,
                expires_at_ms=9_999_999_999_999,
                last_seen_at_ms=0,
            )
        )
        session.commit()

        plan = run_unify_users(session, apply=True)
        session.commit()

        assert plan.session_remaps == [
            {"session_id": "ses_old", "from": "adm_1", "to": "usr_1"}
        ]
        assert session.get(AdminSessionORM, "ses_old").admin_id == "usr_1"


def test_dry_run_writes_nothing(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        from l05_service.user_tree import ensure_root_user

        root = ensure_root_user(session)
        _add_user(session, "usr_1", "李四", parent=root.id, admin_user_id="adm_1")
        _add_admin(session, "adm_1", "lisi")
        session.commit()

        plan = run_unify_users(session, apply=False)
        assert plan.linked_merges and plan.users_total == 2  # root D + usr_1
        unchanged = session.get(UserORM, "usr_1")
        assert unchanged.username is None and unchanged.password_hash == ""


def test_no_root_user_skips_new_rows(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    _create_legacy_table(engine)
    with factory() as session:
        _add_admin(session, "adm_x", "orphan-admin")
        session.commit()
        plan = run_unify_users(session, apply=True)
        session.commit()
        assert not plan.new_rows
        assert plan.skipped[0]["reason"] == "no root user"


@pytest.mark.parametrize("length", [12])
def test_generated_password_has_every_character_class(length):
    from l05_service.auth import generate_password

    passwords = {generate_password(length) for _ in range(20)}
    for password in passwords:
        assert len(password) == length
        assert any(char.isupper() for char in password)
        assert any(char.islower() for char in password)
        assert any(char.isdigit() for char in password)
        assert any(not char.isalnum() for char in password)
    assert len(passwords) > 10  # random, not a fixed literal
