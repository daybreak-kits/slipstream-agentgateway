"""Role/permission behavior over the HTTP admin API (ticket 03).

Covers the 403 gate, built-in role protection, /admin/auth/me permission lists,
custom roles granting exactly their own keys, and role assignment persistence.
"""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l06_api.deps import SESSION_COOKIE


def _client_for(factory, role: str, username: str = "") -> tuple[object, str]:
    admin_id = make_admin(
        factory,
        username=username or ("rbac-" + role + "-x"),
        role=role,
    )
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client, admin_id


def test_me_returns_permission_list_for_admin(client):
    body = client.get("/admin/auth/me").json()
    assert body["role"] == "owner"
    permissions = body["permissions"]
    assert isinstance(permissions, list) and permissions == sorted(permissions)
    assert {"users:read", "billing:cost", "roles:write", "playground:use"} <= set(permissions)


def test_ordinary_user_me_has_spend_but_no_cost(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    client, _ = _client_for(factory, "user")
    me = client.get("/admin/auth/me").json()
    assert me["role"] == "user"
    assert "billing:spend" in me["permissions"]
    assert "billing:cost" not in me["permissions"]
    assert "users:create" not in me["permissions"]


def test_viewer_write_is_forbidden_with_403(client, login_cookies):
    response = client.post(
        "/admin/vendors",
        json={"name": "V", "slug": "v"},
        cookies=login_cookies("viewer"),
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_agent_creates_client_users_but_not_admins(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    client, _ = _client_for(factory, "agent")
    assert client.get("/admin/users").status_code == 200
    created = client.post("/admin/users", json={"name": "sub-user", "balance_micro": 0})
    assert created.status_code == 201
    # ADR-019: there is no separate admin table any more; the old /admin/admins
    # surface is gone and the guard moved to role grants (only 管理用户 may
    # anoint another admin).
    anointed = client.post("/admin/users", json={"name": "rogue-admin", "role": "admin"})
    assert anointed.status_code == 403


def test_builtin_roles_are_listed_and_protected(client):
    listed = client.get("/admin/roles")
    assert listed.status_code == 200
    rows = listed.json()["items"]
    by_key = {row["key"]: row for row in rows}
    assert {"admin", "user", "agent"} <= set(by_key)
    assert by_key["admin"]["name"] == "管理用户"
    assert by_key["admin"]["builtin"] is True
    assert by_key["admin"]["permissions"] == sorted(by_key["admin"]["permissions"])
    assert "billing:cost" in by_key["admin"]["permissions"]
    assert "billing:cost" not in by_key["user"]["permissions"]

    deleted = client.delete("/admin/roles/" + by_key["admin"]["id"])
    assert deleted.status_code == 409
    assert deleted.json()["code"] == "CONFLICT"
    assert client.get("/admin/roles").json()["items"] == rows


def test_permission_matrix_is_readable(client):
    body = client.get("/admin/permissions").json()
    groups = {group["group"] for group in body["groups"]}
    assert "计费" in groups and "账号" in groups
    keys = {entry["key"] for group in body["groups"] for entry in group["permissions"]}
    assert {"billing:cost", "billing:spend", "users:read", "config:write"} <= keys
    assert set(body["keys"]) == keys


def test_custom_role_grants_exactly_its_permissions(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    created = client.post(
        "/admin/roles",
        json={
            "name": "财务",
            "description": "只看报表",
            "permissions": ["reports:read", "billing:cost", "billing:spend"],
        },
    )
    assert created.status_code == 201, created.text
    role = created.json()
    assert role["builtin"] is False
    assert role["key"].startswith("custom_")
    assert role["permissions"] == sorted(["reports:read", "billing:cost", "billing:spend"])

    accountant, _ = _client_for(factory, role["key"], username="accountant")
    assert accountant.get("/admin/reports/overview").status_code == 200
    assert accountant.get("/admin/vendors").status_code == 403
    assert set(accountant.get("/admin/auth/me").json()["permissions"]) == {
        "reports:read",
        "billing:cost",
        "billing:spend",
    }

    # The built-in admin role can never be narrowed.
    admin_role = next(r for r in client.get("/admin/roles").json()["items"] if r["key"] == "admin")
    narrowed = client.patch("/admin/roles/" + admin_role["id"], json={"permissions": []})
    assert narrowed.status_code == 409


def test_unknown_permission_key_is_rejected(client):
    bad = client.post(
        "/admin/roles", json={"name": "坏角色", "permissions": ["billing:teleport"]}
    )
    assert bad.status_code == 422
    assert "billing:teleport" in bad.text


def test_role_assignment_persists_on_users(client, engine_and_sessionmaker):
    """ADR-019：角色分配走统一 users API，username 唯一且不可改。"""
    _, factory = engine_and_sessionmaker
    created = client.post(
        "/admin/users",
        json={
            "name": "代理一号",
            "username": "agent-one",
            "password": "Adm1n-pw-2026",
            "role": "agent",
        },
    )
    assert created.status_code == 201, created.text
    user = created.json()
    assert user["username"] == "agent-one"
    assert user["role"] == "agent"
    assert user["initial_password"] == "Adm1n-pw-2026"

    rows = [row for row in client.get("/admin/users").json() if row["id"] == user["id"]]
    assert rows and rows[0]["role"] == "agent"

    patched = client.patch("/admin/users/" + user["id"], json={"role": "user"})
    assert patched.status_code == 200
    assert patched.json()["role"] == "user"
    assert next(
        row for row in client.get("/admin/users").json() if row["id"] == user["id"]
    )["role"] == "user"

    rejected = client.patch("/admin/users/" + user["id"], json={"role": "wizard"})
    assert rejected.status_code == 422
    # username 是登录名，一经设定不可修改（ADR-019）。
    renamed = client.patch(
        "/admin/users/" + user["id"], json={"username": "agent-two"}
    )
    assert renamed.status_code == 422
    assert "username" in renamed.json()["message"]


def test_duplicate_username_is_conflict_and_derived_one_is_suffixed(client):
    first = client.post("/admin/users", json={"name": "同名", "username": "dup"})
    assert first.status_code == 201, first.text
    second = client.post("/admin/users", json={"name": "同名", "username": "dup"})
    assert second.status_code == 409
    # 未提供 username 时由服务端从显示名派生；有冲突才追加后缀。
    derived = client.post("/admin/users", json={"name": "同名"})
    assert derived.status_code == 201, derived.text
    assert derived.json()["username"] == "同名"
    clash = client.post("/admin/users", json={"name": "同名"})
    assert clash.status_code == 201, clash.text
    assert clash.json()["username"] == "同名-2"
