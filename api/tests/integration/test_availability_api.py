"""Availability-rule creation: POST /admin/availability-rules (ADR-004).

Regression: the route passed scope/scope_id into validate_rule_payload, which
only accepted recurrence/expires/schedule, so every POST raised TypeError -> 500.
Ticket 10 widened the evaluator to upstream_model/public_model scopes and added
PATCH/DELETE, so those rules are now created (and enforced) instead of rejected.
"""

from __future__ import annotations

from tests.conftest import seed_channel

DAILY_WINDOWS = '{"windows": [{"start": "02:00", "end": "04:00", "days": [1, 2, 3, 4, 5]}]}'


def _future_ms() -> int:
    from l01_core.timeutil import now_ms

    return now_ms() + 3_600_000


def _post(client, body: dict):
    return client.post("/admin/availability-rules", json=body)


def _list(client) -> list[dict]:
    response = client.get("/admin/availability-rules")
    assert response.status_code == 200
    return response.json()


def test_post_ban_on_upstream(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    before = len(_list(client))

    response = _post(
        client,
        {"kind": "ban", "scope": "upstream", "scope_id": ids["upstream_id"], "note": "上游故障"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["kind"], body["scope"], body["scope_id"]) == (
        "ban",
        "upstream",
        ids["upstream_id"],
    )
    assert body["recurrence"] is None
    assert body["expires_at_ms"] is None
    assert body["note"] == "上游故障"

    listed = _list(client)
    assert len(listed) == before + 1
    assert any(rule["id"] == body["id"] for rule in listed)


def test_post_cooldown_once(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    expires = _future_ms()

    response = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "model_target",
            "scope_id": "mt_test",
            "recurrence": "once",
            "expires_at_ms": expires,
            "note": "冷却中",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["recurrence"] == "once"
    assert body["expires_at_ms"] == expires
    assert body["scope"] == "model_target"
    assert body["scope_id"] == "mt_test"


def test_post_cooldown_daily_windows(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    response = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream",
            "scope_id": ids["upstream_id"],
            "recurrence": "daily",
            "schedule_json": DAILY_WINDOWS,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["recurrence"] == "daily"
    assert body["schedule_json"] == DAILY_WINDOWS  # stored and read back verbatim
    listed_ids = [rule["id"] for rule in _list(client)]
    assert body["id"] in listed_ids


def test_upstream_model_scope_blocks_its_targets(client, engine_and_sessionmaker):
    from l01_core.timeutil import now_ms
    from l05_service.availability import blocked_target_ids

    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    before = len(_list(client))

    response = _post(
        client,
        {
            "kind": "ban",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert (payload["kind"], payload["scope"]) == ("ban", "upstream_model")
    assert len(_list(client)) == before + 1
    with factory() as session:
        assert "mt_test" in blocked_target_ids(session, now_ms())


def test_public_model_scope_creation(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    response = _post(
        client,
        {"kind": "ban", "scope": "public_model", "scope_id": ids["public_id"]},
    )
    assert response.status_code == 201, response.text
    assert response.json()["scope"] == "public_model"


def test_rule_patch_and_delete(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    created = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "model_target",
            "scope_id": "mt_test",
            "recurrence": "once",
            "expires_at_ms": _future_ms(),
        },
    ).json()

    extended = client.patch(
        f"/admin/availability-rules/{created['id']}",
        json={"note": "延期", "expires_at_ms": _future_ms() + 1000},
    )
    assert extended.status_code == 200, extended.text
    assert extended.json()["note"] == "延期"

    invalid = client.patch(
        f"/admin/availability-rules/{created['id']}",
        json={"expires_at_ms": None},
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "VALIDATION_ERROR"

    assert client.delete(f"/admin/availability-rules/{created['id']}").status_code == 204
    assert all(rule["id"] != created["id"] for rule in _list(client))
    assert (
        client.delete("/admin/availability-rules/does_not_exist").status_code == 404
    )


def test_unknown_scope_id_rejected(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    for scope in ("upstream", "model_target"):
        response = _post(client, {"kind": "ban", "scope": scope, "scope_id": "does_not_exist"})
        assert response.status_code == 422, scope
        assert response.json()["code"] == "VALIDATION_ERROR"


def test_cooldown_once_requires_deadline(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    response = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream",
            "scope_id": ids["upstream_id"],
            "recurrence": "once",
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_cooldown_daily_requires_windows(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    response = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream",
            "scope_id": ids["upstream_id"],
            "recurrence": "daily",
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_viewer_cannot_create_rule(client, login_cookies, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    response = client.post(
        "/admin/availability-rules",
        json={"kind": "ban", "scope": "upstream", "scope_id": ids["upstream_id"]},
        cookies=login_cookies("viewer"),
    )
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"
