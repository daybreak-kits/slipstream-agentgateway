"""Real console auth: login/logout/me, session cookies, forged/expired sessions,
login throttling and disabled accounts.

Seam: the HTTP admin API. No test reaches into session storage except the one
security invariant that the stored credential is a one-way hash, which cannot be
observed over the wire.
"""

from __future__ import annotations

from tests.conftest import DEMO_PASSWORD, make_admin, new_session_token, seed_login_session


def test_login_success_sets_hardened_cookie_and_me(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    admin_id = make_admin(factory, username="alice", password=DEMO_PASSWORD, role="admin")
    response = anon_client.post(
        "/admin/auth/login", json={"username": "alice", "password": DEMO_PASSWORD}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["id"] == admin_id
    assert body["user"]["username"] == "alice"
    assert body["user"]["role"] == "admin"
    assert "billing:cost" in body["user"]["permissions"]
    set_cookie = response.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()
    assert "path=/" in set_cookie.lower()
    assert "max-age=" in set_cookie.lower()

    me = anon_client.get("/admin/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == admin_id
    assert me.json()["name"] == "alice"


def test_login_success_uses_display_name(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    make_admin(factory, username="bob", password=DEMO_PASSWORD, role="viewer", display_name="鲍勃")
    anon_client.post("/admin/auth/login", json={"username": "bob", "password": DEMO_PASSWORD})
    assert anon_client.get("/admin/auth/me").json()["name"] == "鲍勃"


def test_wrong_password_and_unknown_user_share_one_401(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    make_admin(factory, username="carol", password=DEMO_PASSWORD, role="viewer")
    wrong = anon_client.post(
        "/admin/auth/login", json={"username": "carol", "password": "not-the-password"}
    )
    unknown = anon_client.post(
        "/admin/auth/login", json={"username": "nobody", "password": "not-the-password"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["message"] == unknown.json()["message"]
    assert wrong.json()["code"] == "UNAUTHORIZED"
    assert "carol" not in wrong.json()["message"]


def test_unauthenticated_admin_route_is_401(anon_client):
    response = anon_client.get("/admin/vendors")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_forged_role_header_grants_nothing(anon_client):
    response = anon_client.get("/admin/vendors", headers={"X-Admin-Role": "owner"})
    assert response.status_code == 401


def test_forged_cookie_is_rejected(anon_client):
    response = anon_client.get(
        "/admin/auth/me", cookies={"slipstream_admin_session": "definitely-not-a-token"}
    )
    assert response.status_code == 401


def test_expired_session_is_rejected(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    admin_id = make_admin(factory, username="dave", role="viewer")
    token = seed_login_session(factory, admin_id, ttl_seconds=-60)
    response = anon_client.get(
        "/admin/auth/me", cookies={"slipstream_admin_session": token}
    )
    assert response.status_code == 401


def test_logout_revokes_session_and_clears_cookie(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    make_admin(factory, username="erin", password=DEMO_PASSWORD, role="owner")
    assert anon_client.post(
        "/admin/auth/login", json={"username": "erin", "password": DEMO_PASSWORD}
    ).status_code == 200
    before = anon_client.get("/admin/auth/me")
    assert before.status_code == 200
    out = anon_client.post("/admin/auth/logout")
    assert out.status_code == 200
    assert "max-age=0" in out.headers.get("set-cookie", "").lower()
    assert anon_client.get("/admin/auth/me").status_code == 401


def test_login_throttled_after_five_failures(anon_client, engine_and_sessionmaker):
    from l05_service import auth

    _, factory = engine_and_sessionmaker
    make_admin(factory, username="frank", password=DEMO_PASSWORD, role="viewer")
    for _ in range(5):
        response = anon_client.post(
            "/admin/auth/login", json={"username": "frank", "password": "wrong-password"}
        )
        assert response.status_code == 401
    throttled = anon_client.post(
        "/admin/auth/login", json={"username": "frank", "password": DEMO_PASSWORD}
    )
    assert throttled.status_code == 429
    assert throttled.json()["code"] == "RATE_LIMITED"
    auth.reset_login_limits()
    recovered = anon_client.post(
        "/admin/auth/login", json={"username": "frank", "password": DEMO_PASSWORD}
    )
    assert recovered.status_code == 200


def test_disabled_admin_cannot_login(anon_client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    make_admin(factory, username="grace", password=DEMO_PASSWORD, role="owner", status="disabled")
    response = anon_client.post(
        "/admin/auth/login", json={"username": "grace", "password": DEMO_PASSWORD}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_password_change_revokes_existing_sessions(client, engine_and_sessionmaker):
    """管理员重置他人密码（ADR-019）：目标账号的全部会话立即失效。"""
    from l05_service import auth

    _, factory = engine_and_sessionmaker
    admin_id = make_admin(factory, username="heidi", password=DEMO_PASSWORD, role="owner")
    token = new_session_token(factory, admin_id)
    cookies = {"slipstream_admin_session": token}
    assert client.get("/admin/auth/me", cookies=cookies).status_code == 200
    reset = client.put(f"/admin/users/{admin_id}/password", json={"password": "brand-new-pw-1"})
    assert reset.status_code == 200, reset.text
    assert client.get("/admin/auth/me", cookies=cookies).status_code == 401
    assert auth.verify_password("brand-new-pw-1", _hash_of(factory, admin_id))


def test_self_password_change_verifies_old_and_keeps_session(
    anon_client, engine_and_sessionmaker
):
    """自助改密（ADR-019）：旧密码错误 401；成功后旧会话吊销、新会话保留。"""
    _, factory = engine_and_sessionmaker
    make_admin(factory, username="judy", password=DEMO_PASSWORD, role="viewer")
    assert anon_client.post(
        "/admin/auth/login", json={"username": "judy", "password": DEMO_PASSWORD}
    ).status_code == 200
    wrong = anon_client.post(
        "/admin/auth/change-password",
        json={"old_password": "not-the-old", "new_password": "brand-new-pw-1"},
    )
    assert wrong.status_code == 401
    ok = anon_client.post(
        "/admin/auth/change-password",
        json={"old_password": DEMO_PASSWORD, "new_password": "brand-new-pw-1"},
    )
    assert ok.status_code == 200, ok.text
    # The current session survives the self change; the old password is dead.
    assert anon_client.get("/admin/auth/me").status_code == 200
    relogin = anon_client.post(
        "/admin/auth/login", json={"username": "judy", "password": "brand-new-pw-1"}
    )
    assert relogin.status_code == 200


def test_password_is_stored_as_a_one_way_hash(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    admin_id = make_admin(factory, username="ivan", password=DEMO_PASSWORD, role="viewer")
    stored = _hash_of(factory, admin_id)
    assert "ivan" not in stored
    assert DEMO_PASSWORD not in stored
    assert stored.startswith("scrypt$")


def _hash_of(factory, user_id: str) -> str:
    from l04_repo.orm import UserORM

    with factory() as session:
        return session.get(UserORM, user_id).password_hash


def test_cors_preflight_reaches_cors_layer_without_session(anon_client):
    response = anon_client.options(
        "/admin/vendors",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unauthenticated_401_still_carries_cors_headers(anon_client):
    response = anon_client.get(
        "/admin/vendors", headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
