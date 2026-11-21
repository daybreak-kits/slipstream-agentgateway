"""ADR-023 multi-key behaviour over HTTP: several keys per user, name + last_used_at_ms
in list payloads, rename, delete without any one-active-key requirement.

The 50-key ceiling is exercised at the service level (issuing 50 keys through
the API would trigger 50 config rollouts for no extra coverage).
"""

from __future__ import annotations

from tests.conftest import seed_channel

from l05_service.client_keys import MAX_KEYS_PER_USER, issue_client_key


def _issue(client, user_id: str, name: str | None = None) -> dict:
    payload = {"user_id": user_id}
    if name:
        payload["name"] = name
    response = client.post(f"/admin/users/{user_id}/api-keys", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_user_can_hold_several_keys_with_names(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    user_id = seeded["user_id"]

    second = _issue(client, user_id)  # the seed already created 密钥 1
    assert second["name"] == "密钥 2"
    third = _issue(client, user_id, name="生产-主力")
    assert third["name"] == "生产-主力"

    rows = client.get("/admin/api-keys").json()
    mine = [row for row in rows if row["user_id"] == user_id]
    assert len(mine) == 3
    assert {row["name"] for row in mine} == {"密钥 1", "密钥 2", "生产-主力"}
    for row in mine:
        assert row["last_used_at_ms"] >= row["created_at_ms"] > 0


def test_fifty_first_key_is_a_conflict(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    user_id = seeded["user_id"]

    with factory() as session:
        from l01_core.crypto import AesGcmBox

        box = AesGcmBox("test-secret")
        for _ in range(MAX_KEYS_PER_USER - 1):
            issue_client_key(session, user_id=user_id, box=box)
        session.commit()

    response = client.post(f"/admin/users/{user_id}/api-keys", json={"user_id": user_id})
    assert response.status_code == 409
    assert "50" in response.json()["message"]


def test_rename_and_delete_keys(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    user_id = seeded["user_id"]
    key_id = seeded["key_id"]

    renamed = client.patch(f"/admin/api-keys/{key_id}", json={"name": "灰度通道"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "灰度通道"

    blank = client.patch(f"/admin/api-keys/{key_id}", json={"name": "   "})
    assert blank.status_code == 422

    deleted = client.delete(f"/admin/api-keys/{key_id}")
    assert deleted.status_code == 204
    remaining = [row for row in client.get("/admin/api-keys").json() if row["user_id"] == user_id]
    assert remaining == []
    assert client.delete(f"/admin/api-keys/{key_id}").status_code == 404


def test_rotate_refreshes_last_used_at(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    key_id = seeded["key_id"]

    before = {
        row["id"]: row["last_used_at_ms"]
        for row in client.get("/admin/api-keys").json()
    }[key_id]
    rotated = client.post(f"/admin/api-keys/{key_id}/rotate")
    assert rotated.status_code == 200, rotated.text
    after = {
        row["id"]: row["last_used_at_ms"]
        for row in client.get("/admin/api-keys").json()
    }[key_id]
    assert after >= before > 0

# ---------------------------------------------------------------- P1-4 scope

def _browser(factory, role: str, username: str):
    from tests.conftest import _app_client, make_admin, new_session_token

    from l06_api.deps import SESSION_COOKIE

    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client, admin_id


def _subtree_key_operator(client, factory):
    """A role with apikeys:write + billing:subtree, so only the tree limits it."""
    created = client.post(
        "/admin/roles",
        json={
            "name": "密钥代理",
            "description": "可签发密钥，但只能看自己子树",
            "permissions": ["apikeys:read", "apikeys:write", "billing:subtree"],
        },
    )
    assert created.status_code == 201, created.text
    return _browser(factory, created.json()["key"], "key-scope-agent")


def test_agent_cannot_reveal_a_key_outside_its_subtree(engine_and_sessionmaker, client):
    """ADR-008/019: reveal follows the user tree, not just the apikeys:write gate."""
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)

    # A sibling branch's key: same permission set, different subtree.
    other = client.post("/admin/users", json={"name": "别家分公司"})
    assert other.status_code == 201, other.text
    other_id = other.json()["id"]
    other_key = client.post(f"/admin/users/{other_id}/api-keys", json={"user_id": other_id})
    assert other_key.status_code == 201, other_key.text
    foreign_key_id = other_key.json()["id"]

    agent, agent_id = _subtree_key_operator(client, factory)
    denied = agent.post(f"/admin/api-keys/{foreign_key_id}/reveal")
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"
    # A key on a user inside the agent's own subtree stays revealable: the gate
    # is scope, not a blanket ban on the agent role.
    own_key = agent.post(
        f"/admin/users/{agent_id}/api-keys", json={"user_id": agent_id}
    )
    assert own_key.status_code == 201, own_key.text
    assert agent.post(f"/admin/api-keys/{own_key.json()['id']}/reveal").status_code == 200
    # Unknown key ids stay 404, not 403.
    assert agent.post("/admin/api-keys/nope/reveal").status_code == 404


def test_key_list_is_scoped_to_the_callers_users(engine_and_sessionmaker, client):
    """The global key list filters by the visible user set (admin sees everything)."""
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)
    other = client.post("/admin/users", json={"name": "另一分支"})
    other_id = other.json()["id"]
    client.post(f"/admin/users/{other_id}/api-keys", json={"user_id": other_id})

    agent, agent_id = _subtree_key_operator(client, factory)
    own = agent.post(f"/admin/users/{agent_id}/api-keys", json={"user_id": agent_id})
    assert own.status_code == 201, own.text
    visible = agent.get("/admin/api-keys").json()
    visible_users = {row["user_id"] for row in visible}
    assert other_id not in visible_users, "a sibling branch's keys must not be listed"
    assert visible_users, "the agent still sees its own keys"

    # The built-in admin role has global scope and sees every key.
    admin_rows = client.get("/admin/api-keys").json()
    assert other_id in {row["user_id"] for row in admin_rows}


def test_agent_cannot_issue_a_key_for_another_branch(engine_and_sessionmaker, client):
    """Issue is scoped too: no minting a key for a user outside the subtree."""
    _, factory = engine_and_sessionmaker
    client.post("/admin/users", json={"name": "外部分支"})
    other = next(
        row for row in client.get("/admin/users").json() if row["name"] == "外部分支"
    )
    agent, _agent_id = _subtree_key_operator(client, factory)
    denied = agent.post(
        f"/admin/users/{other['id']}/api-keys", json={"user_id": other["id"]}
    )
    assert denied.status_code == 403


# ---------------------------------------------------------------- W7 t07: 自助密钥（B 方案）

def _role_browser(factory, role: str, username: str):
    """W7 内置角色浏览器：customer/reseller 直接登录，不再自建自定义角色。"""
    from tests.conftest import _app_client, make_admin, new_session_token

    from l06_api.deps import SESSION_COOKIE

    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client, admin_id


def test_customer_sees_and_issues_only_own_keys(engine_and_sessionmaker, client):
    """B 方案：customer 拿到 apikeys:read/write 后读/签都严格 self-only。"""
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    alice_id = seeded["user_id"]  # 另一个客户 alice（seed 自带一把密钥）

    customer, customer_id = _role_browser(factory, "customer", "w7-customer-1")

    # 1) 读：customer 的密钥列表只含自己的（初始 0 把，alice 的密钥不可见）。
    rows = customer.get("/admin/api-keys").json()
    assert rows == [], rows

    # 2) 签自己的：200。
    issued = customer.post(
        f"/admin/users/{customer_id}/api-keys", json={"user_id": customer_id}
    )
    assert issued.status_code == 201, issued.text

    # 3) 签他人的：403。
    denied = customer.post(f"/admin/users/{alice_id}/api-keys", json={"user_id": alice_id})
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"

    # 4) 读：列表只含自己刚签的那把。
    rows = customer.get("/admin/api-keys").json()
    assert {row["user_id"] for row in rows} == {customer_id}
    assert alice_id not in {row["user_id"] for row in rows}


def test_customer_cannot_rename_status_rotate_or_delete_foreign_keys(
    engine_and_sessionmaker, client
):
    """apikeys:write 的维护动作同样走 user scope：他人的密钥一律 403。

    rename/status/rotate/delete 在 t07 之前只拦 apikeys:write、不查 key 归属，
    customer 一旦拿到 apikeys:write 就能按 id 改别人的密钥——这是本票要堵的口子。
    """
    _, factory = engine_and_sessionmaker
    seeded = seed_channel(engine_and_sessionmaker[0], factory)
    foreign_key_id = seeded["key_id"]  # alice 的密钥

    customer, _customer_id = _role_browser(factory, "customer", "w7-customer-2")
    assert (
        customer.patch(f"/admin/api-keys/{foreign_key_id}", json={"name": "改名"}).status_code
        == 403
    )
    assert (
        customer.patch(
            f"/admin/api-keys/{foreign_key_id}/status", json={"status": "disabled"}
        ).status_code
        == 403
    )
    assert customer.post(f"/admin/api-keys/{foreign_key_id}/rotate").status_code == 403
    assert customer.delete(f"/admin/api-keys/{foreign_key_id}").status_code == 403
    # 未知密钥保持 404，不因角色不同泄露存在性。
    assert customer.delete("/admin/api-keys/nope").status_code == 404


def test_reseller_proxy_issues_inside_subtree_only(engine_and_sessionmaker, client):
    """B 方案：reseller 在可见子树内可代签，子树外 403；admin 全树可签。"""
    _, factory = engine_and_sessionmaker
    seed_channel(engine_and_sessionmaker[0], factory)
    reseller, reseller_id = _role_browser(factory, "reseller", "w7-reseller-1")

    # reseller 建一个挂在自身节点下的下级客户（子树内）。
    child = client.post(
        "/admin/users",
        json={"name": "下级客户", "role": "customer", "parent_user_id": reseller_id},
    )
    assert child.status_code == 201, child.text
    child_id = child.json()["id"]

    # 子树内代签：200。
    ok = reseller.post(f"/admin/users/{child_id}/api-keys", json={"user_id": child_id})
    assert ok.status_code == 201, ok.text

    # 子树外（admin 直挂根的分支）：403。
    other = client.post("/admin/users", json={"name": "外部分支"})
    assert other.status_code == 201, other.text
    other_id = other.json()["id"]
    denied = reseller.post(f"/admin/users/{other_id}/api-keys", json={"user_id": other_id})
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"

    # admin 全树可签：同一目标 200。
    admin_ok = client.post(f"/admin/users/{other_id}/api-keys", json={"user_id": other_id})
    assert admin_ok.status_code == 201, admin_ok.text
