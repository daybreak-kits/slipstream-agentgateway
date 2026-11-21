"""User hierarchy, proxy-user scope and the /admin/users tree (ticket 04).

Regression focus: root user D owns every account, 代理用户 only ever sees and
edits its own subtree (403 across branches), and 普通用户 sees just its own node.
"""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token

from l04_repo.orm import UserORM
from l06_api.deps import SESSION_COOKIE


def _client_for(factory, role: str, username: str) -> tuple[object, str]:
    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client, admin_id


def _node_by_name(client, name: str) -> dict:
    nodes = client.get("/admin/users/tree").json()["nodes"]
    return next(node for node in nodes if node["name"] == name)


def test_root_user_d_bootstraps_and_adopts_orphans(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        session.add(UserORM(id="usr_old", name="v1 旧账号", created_at_ms=1))
        session.commit()
    owner_id = make_admin(factory, username="root-check", role="admin")
    app = _app_client(factory)  # app start runs ensure_root_user
    app.cookies.set(SESSION_COOKIE, new_session_token(factory, owner_id))

    tree = app.get("/admin/users/tree").json()
    root = next(node for node in tree["nodes"] if node["name"] == "D")
    assert root["parent_user_id"] is None
    assert root["role"] == "admin"
    assert tree["root_id"] == root["id"]
    assert _node_by_name(app, "v1 旧账号")["parent_user_id"] == root["id"]


def test_admin_creates_edits_and_disables_user(client):
    tree = client.get("/admin/users/tree").json()
    root_id = tree["root_id"]

    created = client.post(
        "/admin/users",
        json={"name": "渠道甲", "role": "reseller", "parent_user_id": root_id},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["parent_user_id"] == root_id
    assert body["role"] == "reseller"
    assert body["status"] == "active"
    assert body["depth"] == 1

    patched = client.patch(
        "/admin/users/" + body["id"], json={"name": "渠道甲-停用", "status": "disabled"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "渠道甲-停用"
    assert patched.json()["status"] == "disabled"

    assert client.patch("/admin/users/" + body["id"], json={"status": "banned"}).status_code == 422
    assert client.patch("/admin/users/" + body["id"], json={"role": "wizard"}).status_code == 422


def test_reseller_sees_only_its_subtree_and_cannot_cross_branches(engine_and_sessionmaker, client):
    _, factory = engine_and_sessionmaker
    agent, agent_admin_id = _client_for(factory, "reseller", "agent-owner")
    child = agent.post("/admin/users", json={"name": "代理下级"})
    assert child.status_code == 201, child.text
    child_id = child.json()["id"]

    tree = agent.get("/admin/users/tree").json()
    agent_node = next(node for node in tree["nodes"] if node["id"] == agent_admin_id)
    assert child.json()["parent_user_id"] == agent_node["id"]
    assert tree["root_ids"] == [agent_node["id"]]  # forest root, no dangling D edge
    assert {node["id"] for node in tree["nodes"]} == {agent_node["id"], child_id}

    sibling = client.post("/admin/users", json={"name": "别家分公司"})
    assert sibling.status_code == 201
    sibling_id = sibling.json()["id"]
    assert sibling_id not in {row["id"] for row in agent.get("/admin/users").json()}

    assert agent.get("/admin/users/" + sibling_id).status_code == 403
    assert agent.patch("/admin/users/" + sibling_id, json={"name": "改名"}).status_code == 403
    assert (
        agent.post(
            "/admin/users", json={"name": "x", "parent_user_id": sibling_id}
        ).status_code
        == 403
    )
    assert (
        agent.patch(
            "/admin/users/" + child_id, json={"parent_user_id": sibling_id}
        ).status_code
        == 403
    )
    assert (
        agent.post(f"/admin/users/{sibling_id}/balance", json={"amount_micro": 1000}).status_code
        == 403
    )
    assert agent.get(f"/admin/users/{sibling_id}/ledger").status_code == 403


def test_reseller_cannot_grant_admin_role(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    agent, _ = _client_for(factory, "reseller", "agent-role-gate")
    denied = agent.post("/admin/users", json={"name": "越权", "role": "admin"})
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"


def test_ordinary_user_has_no_user_admin_access(engine_and_sessionmaker):
    """客户没有 users:read：面板入口隐藏，接口也直接 403。"""
    _, factory = engine_and_sessionmaker
    plain, _ = _client_for(factory, "customer", "plain-reader")
    with factory() as session:
        session.add(
            UserORM(id="usr_plain", name="普通用户本人", parent_user_id=None, created_at_ms=2)
        )
        session.commit()

    for path in ("/admin/users", "/admin/users/tree", "/admin/users/usr_plain"):
        assert plain.get(path).status_code == 403, path
    assert plain.post("/admin/users", json={"name": "不该成功"}).status_code == 403
    assert plain.get("/admin/auth/me").status_code == 200


def test_reparenting_into_own_subtree_is_rejected(client):
    root_id = client.get("/admin/users/tree").json()["root_id"]
    parent = client.post("/admin/users", json={"name": "组织 A", "parent_user_id": root_id}).json()
    child = client.post(
        "/admin/users", json={"name": "组织 B", "parent_user_id": parent["id"]}
    ).json()

    cycle = client.patch(
        "/admin/users/" + parent["id"], json={"parent_user_id": child["id"]}
    )
    assert cycle.status_code == 422
    assert "子树" in cycle.json()["message"]

    moved = client.patch("/admin/users/" + child["id"], json={"parent_user_id": None})
    assert moved.status_code == 200
    assert moved.json()["parent_user_id"] == root_id


def test_root_user_cannot_be_disabled_reparented_or_deleted(client):
    root_id = client.get("/admin/users/tree").json()["root_id"]
    assert client.patch("/admin/users/" + root_id, json={"status": "disabled"}).status_code == 422
    assert client.patch("/admin/users/" + root_id, json={"parent_user_id": None}).status_code == 200
    assert (
        client.patch("/admin/users/" + root_id, json={"parent_user_id": root_id}).status_code
        == 422
    )
    assert client.delete("/admin/users/" + root_id).status_code == 409
