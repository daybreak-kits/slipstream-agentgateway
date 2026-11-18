"""Ticket 10: model management API.

Covers the surface the ticket degrades to verified: old-console upstream metadata
(type source + capability parameters), cost field filtering, public-model member
editing, the 关闭/启用/冷却/解除 loop with lazy recovery, referenced-model delete
protection and batch partial success. Renderer assertions prove a cooling model
really leaves the data plane, not just the console.
"""

from __future__ import annotations

from decimal import Decimal

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
    assert created["availability"] == {"state": "normal", "cooldown_until_ms": 0}
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

    viewer = client.get(
        "/admin/upstream-models?page_size=200", cookies=login_cookies("user")
    )
    assert viewer.status_code == 200, viewer.text
    viewer_row = _find(viewer.json(), created["id"])
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


def test_put_targets_replaces_atomically(client, engine_and_sessionmaker):
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

    replaced = client.put(
        f"/admin/public-models/{created['id']}/targets",
        json={
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 5},
                {"upstream_model_id": second["id"], "priority": 6},
            ]
        },
    )
    assert replaced.status_code == 200, replaced.text
    rows = replaced.json()
    assert len(rows) == 2
    # Kept member keeps its row id (ids stay stable across a re-declaration).
    assert rows[0]["id"] == kept_id
    assert [row["priority"] for row in rows] == [5, 6]

    shrunk = client.put(
        f"/admin/public-models/{created['id']}/targets",
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

    cleared = client.put(
        f"/admin/public-models/{ids['public_id']}/targets", json={"targets": []}
    )
    assert cleared.status_code == 200
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
    assert released.json()["availability"] == {"state": "normal", "cooldown_until_ms": 0}

    past = client.patch(url, json={"cooldown_until_ms": now_ms() - 1000})
    assert past.status_code == 422
    assert past.json()["code"] == "VALIDATION_ERROR"

    # Public models carry the same row-level availability.
    public_url = f"/admin/public-models/{ids['public_id']}"
    public_cooling = client.patch(public_url, json={"cooldown_until_ms": _future_ms()})
    assert public_cooling.status_code == 200
    assert public_cooling.json()["availability"]["state"] == "cooling"
    assert (
        client.patch(public_url, json={"cooldown_until_ms": 0})
        .json()["availability"]["state"]
        == "normal"
    )


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
