"""Unit tests for l05_service.user_tree (ticket 04): tree math and scope."""

from __future__ import annotations

import pytest

from l01_core.errors import AppError
from l04_repo.orm import UserORM
from l05_service import rbac, user_tree
from l05_service.auth import Principal


def _add(
    session,
    uid: str,
    name: str,
    *,
    parent: str | None = None,
    username: str | None = None,
    role: str = "user",
) -> None:
    session.add(
        UserORM(
            id=uid,
            name=name,
            username=username,
            parent_user_id=parent,
            role=role,
            status="active",
            created_at_ms=0,
        )
    )


def _principal(admin_id: str, permissions: frozenset[str]) -> Principal:
    return Principal(
        admin_id=admin_id,
        username=admin_id,
        name=admin_id,
        role="agent",
        session_id="ses_test",
        expires_at_ms=9_999_999_999_999,
        permissions=permissions,
    )


def test_ensure_root_is_idempotent_and_backfills(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        _add(session, "usr_a", "a")
        session.commit()
        root = user_tree.ensure_root_user(session)
        session.commit()
        again = user_tree.ensure_root_user(session)
        session.commit()
        assert root.id == again.id
        assert session.get(UserORM, "usr_a").parent_user_id == root.id
        assert user_tree.root_user(session).parent_user_id is None


def test_descendants_and_snapshot_metrics(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        root = user_tree.ensure_root_user(session)
        _add(session, "usr_a", "a", parent=root.id)
        _add(session, "usr_b", "b", parent="usr_a")
        _add(session, "usr_c", "c", parent=root.id)
        session.commit()

        ids = user_tree.descendant_ids(session, root.id)
        assert set(ids) == {root.id, "usr_a", "usr_b", "usr_c"}
        assert ids[0] == root.id

        snapshot = user_tree.snapshot(session)
        assert snapshot["root_id"] == root.id
        nodes = snapshot["nodes"]
        assert nodes[root.id]["depth"] == 0
        assert nodes[root.id]["direct_children"] == 2
        assert nodes[root.id]["subtree_size"] == 4
        assert nodes["usr_a"]["depth"] == 1
        assert nodes["usr_b"]["depth"] == 2
        assert nodes["usr_b"]["subtree_size"] == 1


def test_visible_ids_scoping(engine_and_sessionmaker):
    """ADR-019：登录即用户行，子树以 users.id 为锚（不再有 admin_user_id 关联）。"""
    _, factory = engine_and_sessionmaker
    with factory() as session:
        root = user_tree.ensure_root_user(session)
        _add(session, "usr_agent", "代理", parent=root.id, username="agent-login", role="agent")
        _add(session, "usr_dep1", "下级", parent="usr_agent")
        _add(session, "usr_dep2", "孙级", parent="usr_dep1")
        _add(session, "usr_other", "别家", parent=root.id)
        session.commit()

        agent = _principal(
            "usr_agent", frozenset({"users:read", "users:create", "billing:subtree"})
        )
        assert user_tree.visible_ids(session, agent) == frozenset(
            {"usr_agent", "usr_dep1", "usr_dep2"}
        )
        assert user_tree.can_see(session, agent, "usr_dep2") is True
        assert user_tree.can_see(session, agent, "usr_other") is False

        plain = _principal("adm_plain", frozenset({"billing:spend"}))
        assert user_tree.visible_ids(session, plain) == frozenset()

        admin = _principal("adm_root", rbac.PERMISSION_KEYS)
        assert user_tree.visible_ids(session, admin) is None

        with pytest.raises(AppError) as blocked:
            user_tree.get_visible(session, agent, "usr_other")
        assert blocked.value.status_code == 403


def test_cycle_guard(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        root = user_tree.ensure_root_user(session)
        _add(session, "usr_a", "a", parent=root.id)
        _add(session, "usr_b", "b", parent="usr_a")
        session.commit()

        with pytest.raises(AppError):
            user_tree.assert_no_cycle(session, "usr_a", "usr_b")
        with pytest.raises(AppError):
            user_tree.assert_no_cycle(session, "usr_a", "usr_a")
        user_tree.assert_no_cycle(session, "usr_b", root.id)  # moving up is fine
