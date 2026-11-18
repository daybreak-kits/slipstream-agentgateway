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
