"""Availability-rule creation: POST /admin/availability-rules (ADR-004).

Regression: the route passed scope/scope_id into validate_rule_payload, which
only accepted recurrence/expires/schedule, so every POST raised TypeError -> 500.
Ticket 10 widened the evaluator to upstream_model/public_model scopes and added
PATCH/DELETE, so those rules are now created (and enforced) instead of rejected.
"""

from __future__ import annotations

import pytest
from tests.conftest import seed_channel


@pytest.fixture(autouse=True)
def _pin_operations_timezone_to_utc(engine_and_sessionmaker):
    """_window_around_now builds HH:MM from the UTC wall clock; keep the
    evaluator's operations timezone (app_settings) at UTC for these ticket-02
    mutual-exclusion cases. Timezone handling itself is covered in test_availability."""
    _, factory = engine_and_sessionmaker
    from l01_core.timeutil import now_ms
    from l04_repo.repository import put_setting

    with factory() as session:
        put_setting(session, "timezone", '"UTC"', now_ms())
        session.commit()


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


# ------------------------------------------- ticket 02: 互斥、解除、公开模型禁区


def _window_around_now(minutes_before: int = 2, minutes_after: int = 30) -> str:
    """Daily window that certainly contains the real wall clock (UTC-pinned suite)."""
    import json
    from datetime import UTC, datetime, timedelta

    from l01_core.timeutil import now_ms

    moment = datetime.fromtimestamp(now_ms() / 1000, tz=UTC)
    start = moment - timedelta(minutes=minutes_before)
    end = moment + timedelta(minutes=minutes_after)
    return json.dumps(
        {
            "windows": [
                {
                    "start": f"{start.hour:02d}:{start.minute:02d}",
                    "end": f"{end.hour:02d}:{end.minute:02d}",
                }
            ]
        }
    )


def test_periodic_rule_conflicts_with_an_active_single_cooldown(
    client, engine_and_sessionmaker
):
    from l05_service.availability import row_cooldown_rule_id

    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    deadline = _future_ms()
    assert client.patch(url, json={"cooldown_until_ms": deadline}).status_code == 200

    blocked = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": DAILY_WINDOWS,
        },
    )
    assert blocked.status_code == 409, blocked.text
    body = blocked.json()
    assert body["code"] == "CONFLICT"
    assert body["details"]["blocking_rule_ids"] == [
        row_cooldown_rule_id("upstream_model", ids["upstream_model_id"])
    ]
    assert body["details"]["cooldown_until_ms"] == deadline
    assert body["details"]["window_end_ms"] == 0


def test_once_cooldown_conflicts_with_an_open_periodic_window(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    created = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text
    window_end_ms = created.json()["id"]

    blocked = client.patch(url, json={"cooldown_until_ms": _future_ms()})
    assert blocked.status_code == 409, blocked.text
    details = blocked.json()["details"]
    assert details["blocking_rule_ids"] == [window_end_ms]
    assert details["window_end_ms"] > 0
    assert details["cooldown_until_ms"] == 0

    once = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "once",
            "expires_at_ms": _future_ms(),
        },
    )
    assert once.status_code == 409, once.text
    assert once.json()["details"]["window_end_ms"] == details["window_end_ms"]


def test_single_cooldown_is_allowed_outside_and_after_skipping_the_window(
    client, engine_and_sessionmaker
):
    import json
    from datetime import UTC, datetime

    from l01_core.timeutil import now_ms

    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    today = datetime.fromtimestamp(now_ms() / 1000, tz=UTC).isoweekday()
    other_day = today % 7 + 1
    created = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "weekly",
            "schedule_json": json.dumps(
                {"windows": [{"start": "02:00", "end": "04:00", "days": [other_day]}]}
            ),
        },
    )
    assert created.status_code == 201, created.text
    # Window outside: a single cooldown is allowed.
    allowed = client.patch(url, json={"cooldown_until_ms": _future_ms()})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["availability"]["state"] == "cooling"
    # And once that single is active, another periodic rule is rejected.
    assert (
        _post(
            client,
            {
                "kind": "cooldown",
                "scope": "upstream_model",
                "scope_id": ids["upstream_model_id"],
                "recurrence": "daily",
                "schedule_json": DAILY_WINDOWS,
            },
        ).status_code
        == 409
    )


def test_single_cooldown_is_allowed_after_enable_skips_the_window(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    assert client.patch(url, json={"enabled": False}).status_code == 200
    created = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text

    # 启用 inside the window writes a one-shot skip; the window no longer blocks.
    skipped = client.patch(url, json={"enabled": True})
    assert skipped.status_code == 200, skipped.text
    assert skipped.json()["window_skip"]["rule_ids"] == [created.json()["id"]]
    assert skipped.json()["availability"]["state"] == "normal"

    single = client.patch(url, json={"cooldown_until_ms": _future_ms()})
    assert single.status_code == 200, single.text
    assert single.json()["availability"]["state"] == "cooling"


def test_rule_update_skips_conflict_validation_for_note_only(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    created = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    rule_id = created.json()["id"]
    assert client.patch(url, json={"enabled": True}).status_code == 200
    deadline = _future_ms()
    assert (
        client.patch(url, json={"cooldown_until_ms": deadline}).status_code == 200
    )

    noted = client.patch(f"/admin/availability-rules/{rule_id}", json={"note": "例行维护"})
    assert noted.status_code == 200, noted.text
    assert noted.json()["note"] == "例行维护"

    blocked = client.patch(
        f"/admin/availability-rules/{rule_id}",
        json={"schedule_json": DAILY_WINDOWS},
    )
    assert blocked.status_code == 409, blocked.text
    details = blocked.json()["details"]
    assert details["cooldown_until_ms"] == deadline
    assert len(details["blocking_rule_ids"]) == 1


def test_public_model_cooldown_writes_are_rejected(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    rule = _post(
        client,
        {
            "kind": "cooldown",
            "scope": "public_model",
            "scope_id": ids["public_id"],
            "recurrence": "once",
            "expires_at_ms": _future_ms(),
        },
    )
    assert rule.status_code == 422, rule.text
    assert rule.json()["code"] == "VALIDATION_ERROR"
    assert "上游模型" in rule.json()["message"]

    patched = client.patch(
        f"/admin/public-models/{ids['public_id']}",
        json={"cooldown_until_ms": _future_ms()},
    )
    assert patched.status_code == 422, patched.text
    assert "上游模型" in patched.json()["message"]

    batch = client.patch(
        "/admin/public-models/batch",
        json={
            "ids": [ids["public_id"]],
            "action": "cooldown",
            "cooldown_until_ms": _future_ms(),
        },
    )
    assert batch.status_code == 422, batch.text

    # A ban on a public model stays first-class.
    banned = _post(
        client, {"kind": "ban", "scope": "public_model", "scope_id": ids["public_id"]}
    )
    assert banned.status_code == 201, banned.text

