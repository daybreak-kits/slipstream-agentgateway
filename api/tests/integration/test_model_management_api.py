"""Ticket 10: model management API.

Covers the surface the ticket degrades to verified: old-console upstream metadata
(type source + capability parameters), cost field filtering, public-model member
editing, the 关闭/启用/冷却/解除 loop with lazy recovery, referenced-model delete
protection and batch partial success. Renderer assertions prove a cooling model
really leaves the data plane, not just the console.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from tests.conftest import seed_channel

from l01_core.timeutil import now_ms

PARAMETERS = {
    "max_input_tokens": 131072,
    "max_output_tokens": 8192,
    "reasoning_level": "medium",
    "input_types": ["text", "image"],
    "output_types": ["text"],
    "tool_call": True,
    "reasoning": True,
    "attachment": False,
    "structured_output": True,
}


@pytest.fixture(autouse=True)
def _pin_operations_timezone_to_utc(engine_and_sessionmaker):
    """_window_around_now builds HH:MM from the UTC wall clock; keep the
    evaluator's operations timezone (app_settings) at UTC for these skip
    semantics. The timezone itself is exercised in test_availability."""
    _, factory = engine_and_sessionmaker
    from l04_repo.repository import put_setting

    with factory() as session:
        put_setting(session, "timezone", '"UTC"', now_ms())
        session.commit()


def _future_ms(offset: int = 3_600_000) -> int:
    return now_ms() + offset


def _create_upstream_model(client, upstream_id: str, name: str = "glm-6", **extra) -> dict:
    body: dict = {
        "upstream_id": upstream_id,
        "name": name,
        "model_type": "chat",
        "model_type_source": "manual",
        "parameters": PARAMETERS,
    }
    body.update(extra)
    response = client.post("/admin/upstream-models", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _find(items: list[dict], row_id: str) -> dict:
    return next(item for item in items if item["id"] == row_id)


def _window_around_now(minutes_before: int = 2, minutes_after: int = 30) -> str:
    """Daily window that certainly contains the real wall clock, any time of day.

    Cross-midnight edges (start after end) are interpreted by the evaluator as
    belonging to the day the window started, so this stays correct at 23:59 and
    00:00 alike.
    """
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


def test_upstream_model_metadata_roundtrip(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    created = _create_upstream_model(
        client, ids["upstream_id"], cost_input_per_1m="12.5", markup="1.3"
    )
    assert created["model_type"] == "chat"
    assert created["model_type_source"] == "manual"
    assert created["parameters"]["max_input_tokens"] == 131072
    assert created["parameters"]["input_types"] == ["text", "image"]
    assert created["parameters"]["structured_output"] is True
    assert created["availability"] == {
        "state": "normal",
        "cooldown_until_ms": 0,
        "window_skip_until_ms": 0,
    }
    assert created["target_count"] == 0
    assert Decimal(created["cost_input_per_1m"]) == Decimal("12.5")
    assert Decimal(created["markup"]) == Decimal("1.3")

    # GET is the table source: joined upstream/vendor names + reference count.
    listed = client.get("/admin/upstream-models?page_size=200").json()
    seeded = _find(listed, ids["upstream_model_id"])
    assert seeded["upstream_name"] == "testv-01"
    assert seeded["vendor_name"] == "Test Vendor"
    assert seeded["target_count"] == 1
    assert seeded["model_type_source"] == "default"
    assert seeded["parameters"]["input_types"] == ["text"]

    patched = client.patch(
        f"/admin/upstream-models/{created['id']}",
        json={
            "name": "glm-6-air",
            "model_type": "rerank",
            "model_type_source": "upstream",
            "parameters": {**PARAMETERS, "max_output_tokens": 1024},
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["name"], body["model_type"], body["model_type_source"]) == (
        "glm-6-air",
        "rerank",
        "upstream",
    )
    assert body["parameters"]["max_output_tokens"] == 1024


def test_parameters_validation(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = "/admin/upstream-models"

    negative = client.post(
        url,
        json={
            "upstream_id": ids["upstream_id"],
            "name": "bad",
            "parameters": {"max_input_tokens": -1},
        },
    )
    assert negative.status_code == 422
    assert negative.json()["code"] == "VALIDATION_ERROR"

    unknown = client.post(
        url,
        json={"upstream_id": ids["upstream_id"], "name": "bad", "parameters": {"nope": 1}},
    )
    assert unknown.status_code == 422
    assert "nope" in unknown.json()["message"]

    empty_modalities = client.post(
        url,
        json={"upstream_id": ids["upstream_id"], "name": "bad", "parameters": {"input_types": []}},
    )
    assert empty_modalities.status_code == 422

    bad_source = client.post(
        url,
        json={"upstream_id": ids["upstream_id"], "name": "bad", "model_type_source": "auto"},
    )
    assert bad_source.status_code == 422


# ---------------------------------------------------- reasoning level declaration (t18)


def test_reasoning_level_declaration_roundtrip(client, engine_and_sessionmaker):
    """Ticket 18: a model declares its supported levels plus the default level."""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    created = _create_upstream_model(
        client,
        ids["upstream_id"],
        parameters={
            **PARAMETERS,
            "reasoning_levels": ["default", "low", "medium", "high", "xhigh", "max"],
            "default_reasoning_level": "medium",
        },
    )
    assert created["parameters"]["reasoning_levels"] == [
        "default",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    ]
    assert created["parameters"]["default_reasoning_level"] == "medium"

    # 未声明 = 空集合与空串；读取端始终拿到完整形状。
    listed = client.get("/admin/upstream-models?page_size=200").json()
    seeded = _find(listed, ids["upstream_model_id"])
    assert seeded["parameters"]["reasoning_levels"] == []
    assert seeded["parameters"]["default_reasoning_level"] == ""


def test_reasoning_level_declaration_validation(client, engine_and_sessionmaker):
    """未知档位、非列表、默认档不在声明集合内都拒绝。"""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = "/admin/upstream-models"

    unknown_level = client.post(
        url,
        json={
            "upstream_id": ids["upstream_id"],
            "name": "bad",
            "parameters": {"reasoning_levels": ["low", "ultra"]},
        },
    )
    assert unknown_level.status_code == 422
    assert "ultra" in unknown_level.json()["message"]

    not_a_list = client.post(
        url,
        json={
            "upstream_id": ids["upstream_id"],
            "name": "bad",
            "parameters": {"reasoning_levels": "low"},
        },
    )
    assert not_a_list.status_code == 422

    default_outside_set = client.post(
        url,
        json={
            "upstream_id": ids["upstream_id"],
            "name": "bad",
            "parameters": {"reasoning_levels": ["low", "high"], "default_reasoning_level": "max"},
        },
    )
    assert default_outside_set.status_code == 422

    default_unknown = client.post(
        url,
        json={
            "upstream_id": ids["upstream_id"],
            "name": "bad",
            "parameters": {"default_reasoning_level": "ultra"},
        },
    )
    assert default_unknown.status_code == 422


def test_reasoning_level_declaration_dedupes_preserving_order(client, engine_and_sessionmaker):
    """与 modalities 同一语义：保序去重。"""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    created = _create_upstream_model(
        client,
        ids["upstream_id"],
        parameters={"reasoning_levels": ["high", "low", "high", "none"]},
    )
    assert created["parameters"]["reasoning_levels"] == ["high", "low", "none"]


def test_cost_fields_hidden_without_billing_cost(
    client, login_cookies, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    created = _create_upstream_model(
        client, ids["upstream_id"], name="priced", cost_input_per_1m="3", markup="2"
    )

    owner_row = _find(client.get("/admin/upstream-models?page_size=200").json(), created["id"])
    assert "cost_input_per_1m" in owner_row
    assert "markup" in owner_row

    customer = client.get(
        "/admin/upstream-models?page_size=200", cookies=login_cookies("customer")
    )
    assert customer.status_code == 200, customer.text
    viewer_row = _find(customer.json(), created["id"])
    # Field-level filtering: the keys are absent, never null.
    assert "cost_input_per_1m" not in viewer_row
    assert "cost_output_per_1m" not in viewer_row
    assert "markup" not in viewer_row


def test_public_model_create_members_and_strategy(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    second = _create_upstream_model(client, ids["upstream_id"], name="glm-6-air")

    created = client.post(
        "/admin/public-models",
        json={
            "name": "fast",
            "routing_mode": "failover",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 2},
                {"upstream_model_id": second["id"], "priority": 1},
            ],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["target_count"] == 2
    # AG semantics: numeric SMALL first, members returned in routing order.
    assert [target["priority"] for target in body["targets"]] == [1, 2]
    assert body["targets"][0]["upstream_model_name"] == "glm-6-air"
    assert body["targets"][0]["upstream_name"] == "testv-01"

    # weighted requires weight >= 1 (renderer rule), conditional only the last may
    # omit "when"; duplicate members are rejected.
    weighted = client.post(
        "/admin/public-models",
        json={
            "name": "w",
            "routing_mode": "weighted",
            "targets": [{"upstream_model_id": second["id"]}],
        },
    )
    assert weighted.status_code == 422
    conditional = client.post(
        "/admin/public-models",
        json={
            "name": "c",
            "routing_mode": "conditional",
            "targets": [
                {
                    "upstream_model_id": ids["upstream_model_id"],
                    "priority": 1,
                    "when": "usage.total_tokens > 1000",
                },
                {"upstream_model_id": second["id"], "priority": 2},
            ],
        },
    )
    assert conditional.status_code == 201, conditional.text
    bad_conditional = client.post(
        "/admin/public-models",
        json={
            "name": "c2",
            "routing_mode": "conditional",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 1},
                {"upstream_model_id": second["id"], "priority": 2},
            ],
        },
    )
    assert bad_conditional.status_code == 422
    duplicate = client.post(
        "/admin/public-models",
        json={
            "name": "dup",
            "targets": [
                {"upstream_model_id": second["id"], "priority": 1},
                {"upstream_model_id": second["id"], "priority": 2},
            ],
        },
    )
    assert duplicate.status_code == 422
    # Nothing half-created: the rejected names never landed.
    names = {item["name"] for item in client.get("/admin/public-models").json()}
    assert "dup" not in names


def test_patch_targets_replaces_atomically(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    second = _create_upstream_model(client, ids["upstream_id"], name="glm-6-air")
    created = client.post(
        "/admin/public-models",
        json={
            "name": "members",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 1},
                {"upstream_model_id": second["id"], "priority": 2},
            ],
        },
    ).json()
    kept_id = created["targets"][0]["id"]

    replaced = client.patch(
        f"/admin/public-models/{created['id']}",
        json={
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 5},
                {"upstream_model_id": second["id"], "priority": 6},
            ]
        },
    )
    assert replaced.status_code == 200, replaced.text
    rows = replaced.json()["targets"]
    assert len(rows) == 2
    # Kept member keeps its row id (ids stay stable across a re-declaration).
    assert rows[0]["id"] == kept_id
    assert [row["priority"] for row in rows] == [5, 6]

    shrunk = client.patch(
        f"/admin/public-models/{created['id']}",
        json={"targets": [{"upstream_model_id": second["id"], "priority": 1}]},
    )
    assert shrunk.status_code == 200
    remaining = client.get(
        f"/admin/model-targets?public_model_id={created['id']}"
    ).json()
    assert [row["upstream_model_id"] for row in remaining] == [second["id"]]


def test_referenced_upstream_model_cannot_be_deleted(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    blocked = client.delete(f"/admin/upstream-models/{ids['upstream_model_id']}")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["code"] == "CONFLICT"
    assert blocked.json()["details"]["public_model_id"] == ids["public_id"]

    # A member list can never be emptied (at least one member), so freeing the
    # reference means deleting the alias row itself.
    emptied = client.patch(
        f"/admin/public-models/{ids['public_id']}", json={"targets": []}
    )
    assert emptied.status_code == 422
    assert (
        client.delete(f"/admin/upstream-models/{ids['upstream_model_id']}").status_code
        == 409
    )

    assert client.delete(f"/admin/public-models/{ids['public_id']}").status_code == 204
    assert (
        client.delete(f"/admin/upstream-models/{ids['upstream_model_id']}").status_code
        == 204
    )
    assert client.delete("/admin/upstream-models/does_not_exist").status_code == 404


def test_public_model_delete_cascades_members(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    created = client.post(
        "/admin/public-models",
        json={
            "name": "short-lived",
            "targets": [{"upstream_model_id": ids["upstream_model_id"], "priority": 1}],
        },
    ).json()

    assert client.delete(f"/admin/public-models/{created['id']}").status_code == 204
    remaining = client.get("/admin/model-targets?page_size=200").json()
    assert all(row["public_model_id"] != created["id"] for row in remaining)


def test_close_enable_cooldown_release(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"

    closed = client.patch(url, json={"enabled": False})
    assert closed.status_code == 200, closed.text
    assert closed.json()["availability"]["state"] == "closed"

    cooling = client.patch(url, json={"enabled": True, "cooldown_until_ms": _future_ms()})
    assert cooling.status_code == 200
    state = cooling.json()["availability"]
    assert state["state"] == "cooling"
    assert state["cooldown_until_ms"] > now_ms()

    released = client.patch(url, json={"cooldown_until_ms": 0})
    assert released.json()["availability"] == {
        "state": "normal",
        "cooldown_until_ms": 0,
        "window_skip_until_ms": 0,
    }

    past = client.patch(url, json={"cooldown_until_ms": now_ms() - 1000})
    assert past.status_code == 422
    assert past.json()["code"] == "VALIDATION_ERROR"

    # Public models have no cooldown concept (ADR-025): the write is refused with
    # an explicit explanation instead of silently cooling the public alias.
    public_url = f"/admin/public-models/{ids['public_id']}"
    public_cooling = client.patch(public_url, json={"cooldown_until_ms": _future_ms()})
    assert public_cooling.status_code == 422, public_cooling.text
    assert public_cooling.json()["code"] == "VALIDATION_ERROR"
    assert "上游模型" in public_cooling.json()["message"]
    assert (
        client.patch(public_url, json={"cooldown_until_ms": 0}).status_code == 422
    )


def test_enable_inside_schedule_window_skips_only_current_window(
    client, engine_and_sessionmaker
):
    """GLOSSARY §3 (2026-11-19 ruling): 启用 inside a periodic window skips
    THAT window only — the rule stays listed and keeps cooling later windows;
    解除 does not undo the anchored exception (ticket 02)."""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"

    closed = client.patch(url, json={"enabled": False})
    assert closed.json()["availability"]["state"] == "closed"

    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]

    enabled = client.patch(url, json={"enabled": True})
    assert enabled.status_code == 200, enabled.text
    body = enabled.json()
    skip = body["window_skip"]
    assert skip["rule_ids"] == [rule_id]
    assert skip["skip_until_ms"] > now_ms()
    assert skip["message"] == "本次启用仅跳过当前窗口，后续窗口照常"
    assert body["availability"]["state"] == "normal"
    assert body["availability"]["window_skip_until_ms"] == skip["skip_until_ms"]

    # The rule survives untouched apart from the anchored exception.
    listed = [r for r in client.get("/admin/availability-rules").json() if r["id"] == rule_id]
    assert listed and listed[0]["recurrence"] == "daily"
    with factory() as session:
        from l04_repo.orm import AvailabilityRuleORM

        row = session.get(AvailabilityRuleORM, rule_id)
        assert row is not None
        assert row.skip_until_ms == skip["skip_until_ms"]
        assert row.schedule_json == created.json()["schedule_json"]

    # 解除 keeps the anchored exception: the row stays usable for this window
    # and the periodic rule is not deleted.
    released = client.patch(url, json={"cooldown_until_ms": 0})
    assert released.status_code == 200, released.text
    assert released.json()["window_skip"] is None
    state = released.json()["availability"]
    assert state["state"] == "normal"
    assert state["window_skip_until_ms"] == skip["skip_until_ms"]


def test_enable_outside_schedule_window_does_not_skip(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"

    # A weekday that is neither today nor yesterday can never contain now,
    # whatever wall-clock time the suite runs at.
    today = datetime.fromtimestamp(now_ms() / 1000, tz=UTC).isoweekday()
    other_day = today % 7 + 1
    created = client.post(
        "/admin/availability-rules",
        json={
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

    closed = client.patch(url, json={"enabled": False})
    assert closed.json()["availability"]["state"] == "closed"
    enabled = client.patch(url, json={"enabled": True})
    assert enabled.status_code == 200, enabled.text
    body = enabled.json()
    assert body["window_skip"] is None
    assert body["availability"]["state"] == "normal"


def test_public_model_enable_never_skips_because_public_cooldowns_are_illegal(
    client, engine_and_sessionmaker
):
    """ADR-025: cooldown belongs to upstream models, so a public model can only
    be closed/opened — an enable has no window exception to write."""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/public-models/{ids['public_id']}"
    rejected = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "public_model",
            "scope_id": ids["public_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert rejected.status_code == 422, rejected.text
    assert "上游模型" in rejected.json()["message"]

    assert client.patch(url, json={"enabled": False}).status_code == 200
    enabled = client.patch(url, json={"enabled": True})
    assert enabled.status_code == 200, enabled.text
    body = enabled.json()
    assert body["window_skip"] is None
    assert body["availability"]["state"] == "normal"


def test_release_inside_a_window_skips_only_that_window_and_keeps_the_rule(
    client, engine_and_sessionmaker
):
    """ticket 02「解除」: delete the once rule; hit a periodic window -> skip."""
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"
    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]

    cooling = _find(
        client.get("/admin/upstream-models?page_size=200").json(),
        ids["upstream_model_id"],
    )
    assert cooling["availability"]["state"] == "cooling"

    released = client.patch(url, json={"cooldown_until_ms": 0})
    assert released.status_code == 200, released.text
    body = released.json()
    assert body["window_skip"]["rule_ids"] == [rule_id]
    assert body["window_skip"]["skip_until_ms"] > now_ms()
    assert body["availability"]["state"] == "normal"
    assert (
        body["availability"]["window_skip_until_ms"]
        == body["window_skip"]["skip_until_ms"]
    )

    # The periodic rule survives, only this window is skipped.
    listed = [
        rule
        for rule in client.get("/admin/availability-rules").json()
        if rule["id"] == rule_id
    ]
    assert listed and listed[0]["recurrence"] == "daily"

    # The target returns to the rendered data plane while the window is skipped.
    from l05_service.rendering import build_render_plan

    with factory() as session:
        ir, _keys = build_render_plan(session, revision="rev_release_skip")
    # ADR-026: one expanded target per key ({target}#k{seq}) shares the layer.
    assert "mt_test#k1" in {t.id for spec in ir.public_models for t in spec.targets}


def test_batch_enable_reports_skipped_windows(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    free = _create_upstream_model(client, ids["upstream_id"], name="batch-cool")
    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": free["id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]

    batch = client.patch(
        "/admin/upstream-models/batch",
        json={"ids": [free["id"], ids["upstream_model_id"]], "action": "enable"},
    )
    assert batch.status_code == 200, batch.text
    result = batch.json()
    assert result["changed"] == [free["id"], ids["upstream_model_id"]]
    assert [item["id"] for item in result["window_skipped"]] == [free["id"]]
    assert result["window_skipped"][0]["rule_ids"] == [rule_id]


def test_upstream_cooldown_leaves_data_plane_until_expiry(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    healthy = _create_upstream_model(client, ids["upstream_id"], name="healthy-model")
    created_pm = client.post(
        "/admin/public-models",
        json={
            "name": "healthy-pm",
            "targets": [{"upstream_model_id": healthy["id"], "priority": 1}],
        },
    )
    assert created_pm.status_code == 201, created_pm.text

    from l05_service.rendering import build_render_plan

    patched = client.patch(
        f"/admin/upstream-models/{ids['upstream_model_id']}",
        json={"cooldown_until_ms": _future_ms()},
    )
    assert patched.status_code == 200
    with factory() as session:
        ir, _keys = build_render_plan(session, revision="rev_t10_cool")
    assert {model.name for model in ir.public_models} == {"healthy-pm"}

    # The deadline passes: the managed rule is the authority, so every read
    # path self-heals from the rule table without a scheduler.
    from l04_repo.orm import AvailabilityRuleORM
    from l05_service.availability import row_cooldown_rule_id

    with factory() as session:
        rule = session.get(
            AvailabilityRuleORM,
            row_cooldown_rule_id("upstream_model", ids["upstream_model_id"]),
        )
        assert rule is not None
        rule.expires_at_ms = now_ms() - 1
        session.commit()
    listed = _find(
        client.get("/admin/upstream-models?page_size=200").json(),
        ids["upstream_model_id"],
    )
    assert listed["availability"]["state"] == "normal"
    with factory() as session:
        ir, _keys = build_render_plan(session, revision="rev_t10_ok")
    assert {model.name for model in ir.public_models} == {"flagship", "healthy-pm"}


def test_batch_availability_and_delete_partial_success(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    free = _create_upstream_model(client, ids["upstream_id"], name="free-model")

    deadline = _future_ms(60_000)
    cooled = client.patch(
        "/admin/upstream-models/batch",
        json={"ids": [free["id"]], "action": "cooldown", "cooldown_until_ms": deadline},
    )
    assert cooled.status_code == 200, cooled.text
    assert cooled.json()["changed"] == [free["id"]]
    assert cooled.json()["failed"] == []
    assert (
        _find(client.get("/admin/upstream-models?page_size=200").json(), free["id"])[
            "availability"
        ]["state"]
        == "cooling"
    )

    released = client.patch(
        "/admin/upstream-models/batch", json={"ids": [free["id"]], "action": "release"}
    )
    assert released.json()["changed"] == [free["id"]]
    assert (
        _find(client.get("/admin/upstream-models?page_size=200").json(), free["id"])[
            "availability"
        ]["state"]
        == "normal"
    )

    missing_deadline = client.patch(
        "/admin/upstream-models/batch", json={"ids": [free["id"]], "action": "cooldown"}
    )
    assert missing_deadline.status_code == 422
    # 排期 is out of scope: the action is rejected by the schema, never degraded.
    scheduled = client.patch(
        "/admin/upstream-models/batch", json={"ids": [free["id"]], "action": "schedule"}
    )
    assert scheduled.status_code == 422

    deleted = client.patch(
        "/admin/upstream-models/batch",
        json={"ids": [ids["upstream_model_id"], free["id"], "does_not_exist"], "action": "delete"},
    )
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["changed"] == [free["id"]]
    assert body["missing"] == ["does_not_exist"]
    assert [item["id"] for item in body["failed"]] == [ids["upstream_model_id"]]
    assert body["failed"][0]["code"] == "CONFLICT"


# ------------------------------------- ticket 02: 批量冲突 failed 与写后下发


def _revision_count(factory) -> int:
    from sqlalchemy import select

    from l04_repo.orm import ConfigRevisionORM

    with factory() as session:
        return len(list(session.scalars(select(ConfigRevisionORM)).all()))


def _last_reason(factory) -> str:
    from sqlalchemy import select

    from l04_repo.orm import ConfigRevisionORM

    with factory() as session:
        rows = list(
            session.scalars(
                select(ConfigRevisionORM).order_by(
                    ConfigRevisionORM.created_at_ms.desc()
                )
            ).all()
        )
    return rows[0].reason if rows else ""


def _window_on_another_day() -> str:
    """A weekly window on a weekday that is not today: inactive at test time.

    The evaluator applies the ``days`` filter only to weekly/monthly windows
    (daily windows fire every day within their HH:MM range), so a daily
    "other day" window goes active every day at 02:00-04:00 UTC and flakes the
    "writes apply a revision" assertions. Weekly keeps the window genuinely
    on another weekday at any wall clock.
    """
    from datetime import UTC, datetime

    today = datetime.now(tz=UTC).isoweekday()
    other = today % 7 + 1  # any day that is not today (weekly honors `days`)
    return json.dumps({"windows": [{"start": "02:00", "end": "04:00", "days": [other]}]})


def _keep_renderable(factory) -> None:
    """Add a spare public model/target.

    Ticket 02 applies after every availability write; a config with no renderable
    public model is refused by the renderer ("nothing to render"), so the apply is
    skipped.  Cooldown/disable tests therefore keep one spare route alive and can
    still assert that the write pushed a new revision.
    """
    from l04_repo.orm import ModelTargetORM, PublicModelORM, UpstreamModelORM

    with factory() as session:
        session.add(
            UpstreamModelORM(
                id="umdl_spare_apply",
                upstream_id="ups_test",
                name="spare-apply",
                model_type="chat",
                created_at_ms=0,
            )
        )
        session.add(
            PublicModelORM(id="pmdl_spare_apply", name="spare-apply-pm", created_at_ms=0)
        )
        session.add(
            ModelTargetORM(
                id="mt_spare_apply",
                public_model_id="pmdl_spare_apply",
                upstream_model_id="umdl_spare_apply",
                priority=1,
                created_at_ms=0,
            )
        )
        session.commit()


def test_batch_cooldown_reports_conflicts_as_failed_items(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    free = _create_upstream_model(client, ids["upstream_id"], name="free-batch")
    windowed = _create_upstream_model(client, ids["upstream_id"], name="windowed-batch")
    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": windowed["id"],
            "recurrence": "daily",
            "schedule_json": _window_around_now(),
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]

    result = client.patch(
        "/admin/upstream-models/batch",
        json={
            "ids": [free["id"], windowed["id"], ids["upstream_model_id"]],
            "action": "cooldown",
            "cooldown_until_ms": _future_ms(),
        },
    )
    assert result.status_code == 200, result.text
    body = result.json()
    # Partial success: the conflict is reported per id, the batch is not failed.
    assert body["changed"] == [free["id"], ids["upstream_model_id"]]
    assert [item["id"] for item in body["failed"]] == [windowed["id"]]
    failure = body["failed"][0]
    assert failure["code"] == "CONFLICT"
    assert failure["details"]["blocking_rule_ids"] == [rule_id]
    assert failure["details"]["window_end_ms"] > 0

    from l04_repo.orm import AvailabilityRuleORM
    from l05_service.availability import row_cooldown_rule_id

    with factory() as session:
        assert (
            session.get(
                AvailabilityRuleORM, row_cooldown_rule_id("upstream_model", windowed["id"])
            )
            is None
        )
    windowed_row = _find(
        client.get("/admin/upstream-models?page_size=200").json(), windowed["id"]
    )
    assert windowed_row["availability"]["state"] == "cooling"
    assert (
        windowed_row["availability"]["cooldown_until_ms"]
        == failure["details"]["window_end_ms"]
    )


def test_availability_rule_writes_apply_a_revision(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    # Inactive window: the rule exists (and its writes apply) without taking the
    # only route out of the rendered config.
    before = _revision_count(factory)
    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": ids["upstream_model_id"],
            "recurrence": "weekly",
            "schedule_json": _window_on_another_day(),
        },
    )
    assert created.status_code == 201, created.text
    assert _revision_count(factory) == before + 1
    assert _last_reason(factory) == "availability-rule-create"

    rule_id = created.json()["id"]
    assert (
        client.patch(
            f"/admin/availability-rules/{rule_id}", json={"note": "维护窗口"}
        ).status_code
        == 200
    )
    assert _revision_count(factory) == before + 2
    assert _last_reason(factory) == "availability-rule-update"

    assert client.delete(f"/admin/availability-rules/{rule_id}").status_code == 204
    assert _revision_count(factory) == before + 3
    assert _last_reason(factory) == "availability-rule-delete"


def test_model_availability_writes_apply_a_revision(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    _keep_renderable(factory)
    url = f"/admin/upstream-models/{ids['upstream_model_id']}"

    before = _revision_count(factory)
    assert client.patch(url, json={"cooldown_until_ms": _future_ms()}).status_code == 200
    assert _revision_count(factory) == before + 1
    assert _last_reason(factory) == "model-cooldown"

    assert client.patch(url, json={"enabled": False}).status_code == 200
    assert _revision_count(factory) == before + 2
    assert _last_reason(factory) == "model-disable"

    assert client.patch(url, json={"enabled": True}).status_code == 200
    assert _revision_count(factory) == before + 3
    assert _last_reason(factory) == "model-enable"


def test_public_model_enable_applies_a_revision(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    _keep_renderable(factory)
    url = f"/admin/public-models/{ids['public_id']}"
    before = _revision_count(factory)
    assert client.patch(url, json={"enabled": False}).status_code == 200
    assert _revision_count(factory) == before + 1
    assert _last_reason(factory) == "model-disable"
    assert client.patch(url, json={"enabled": True}).status_code == 200
    assert _revision_count(factory) == before + 2
    assert _last_reason(factory) == "model-enable"


def test_batch_availability_writes_apply_one_revision(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    free = _create_upstream_model(client, ids["upstream_id"], name="free-apply")
    before = _revision_count(factory)
    assert (
        client.patch(
            "/admin/upstream-models/batch",
            json={"ids": [free["id"]], "action": "cooldown", "cooldown_until_ms": _future_ms()},
        ).status_code
        == 200
    )
    assert _revision_count(factory) == before + 1
    assert _last_reason(factory) == "models-batch-cooldown"

