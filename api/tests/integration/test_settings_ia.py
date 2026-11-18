"""Ticket 16: 设置信息架构拆分 — 连接地址与用户设置偏好。

Seam: HTTP admin API. 运营设置连接地址所有登录用户可读（不要求 settings:read），
只有 settings:write 能改；URL 校验拒绝非 http(s)、账号密码、query / fragment。
用户设置（显示名、主题、通知偏好）按账号隔离，默认值可读。
"""

from __future__ import annotations


def test_connection_defaults_to_browser_host_contract(client):
    """未配置时控制面返回空 base_url + 端口约定，前端回退浏览器 host。"""
    response = client.get("/admin/connection")
    assert response.status_code == 200
    body = response.json()
    assert body["base_url"] == ""
    assert body["configured"] is False
    assert body["default_port"] == 3600
    assert body["editable"] is True
    # E14 实测有依据的端点清单，服务端下发（F2a 前端消费）
    assert body["endpoints"] == ["/v1/chat/completions", "/v1/models", "/v1/embeddings"]


def test_connection_is_shared_and_readable_without_settings_permission(anon_client, login_cookies):
    """普通用户（viewer）能读统一连接地址，但不能改设置。"""
    cookies = login_cookies("viewer")
    got = anon_client.get("/admin/connection", cookies=cookies)
    assert got.status_code == 200
    assert got.json()["default_port"] == 3600
    assert got.json()["editable"] is False

    denied = anon_client.put(
        "/admin/settings", cookies=cookies, json={"values": {"gateway_base_url": "https://x.example"}}
    )
    assert denied.status_code == 403


def test_connection_update_validates_and_persists(client):
    saved = client.put(
        "/admin/settings", json={"values": {"gateway_base_url": "https://api.example.com/"}}
    )
    assert saved.status_code == 200, saved.text
    info = client.get("/admin/connection").json()
    assert info["base_url"] == "https://api.example.com"
    assert info["configured"] is True

    for bad in ("ftp://api.example.com", "api.example.com", "https://user:pw@api.example.com",
                "https://api.example.com?x=1", "https://api.example.com#top"):
        rejected = client.put("/admin/settings", json={"values": {"gateway_base_url": bad}})
        assert rejected.status_code == 422, (bad, rejected.text)
    # 校验失败不覆盖旧值
    assert client.get("/admin/connection").json()["base_url"] == "https://api.example.com"

    cleared = client.put("/admin/settings", json={"values": {"gateway_base_url": ""}})
    assert cleared.status_code == 200
    assert client.get("/admin/connection").json()["configured"] is False


def test_preferences_roundtrip_and_defaults(client):
    defaults = client.get("/admin/auth/preferences").json()
    assert defaults["theme"] == "system"
    assert defaults["notify_email"] is True
    assert defaults["notify_browser"] is False

    saved = client.put(
        "/admin/auth/preferences",
        json={"theme": "dark", "notify_email": False, "notify_browser": True,
              "notify_weekly": False, "bio": "夜间运营"},
    )
    assert saved.status_code == 200, saved.text
    body = client.get("/admin/auth/preferences").json()
    assert body == {"theme": "dark", "notify_email": False, "notify_browser": True,
                    "notify_weekly": False, "bio": "夜间运营"}

    rejected = client.put("/admin/auth/preferences", json={"theme": "neon"})
    assert rejected.status_code == 422


def test_profile_display_name_update(client):
    updated = client.patch("/admin/auth/me", json={"name": "运营甲"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "运营甲"
    assert client.get("/admin/auth/me").json()["name"] == "运营甲"

    blank = client.patch("/admin/auth/me", json={"name": "   "})
    assert blank.status_code == 422


def test_connection_requires_authentication(anon_client):
    assert anon_client.get("/admin/connection").status_code == 401
    assert anon_client.get("/admin/auth/preferences").status_code == 401
