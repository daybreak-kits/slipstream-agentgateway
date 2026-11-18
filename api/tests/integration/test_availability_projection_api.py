"""ADR-004 end to end: rule writes update the projection, reads use the evaluator."""

from __future__ import annotations

import pytest
from tests.conftest import seed_channel

from l01_core.errors import AppError
from l01_core.timeutil import now_ms
from l05_service.availability import row_cooldown_rule_id

FULL_DAY = '{"windows": [{"start": "00:00", "end": "00:00"}]}'


def _find(rows: list[dict], entity_id: str) -> dict:
    return next(row for row in rows if row["id"] == entity_id)


def _rules(client) -> list[dict]:
    response = client.get("/admin/availability-rules")
    assert response.status_code == 200
    return response.json()


def test_model_patch_cooldown_creates_one_managed_rule_and_release_removes_it(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    model_id = ids["upstream_model_id"]
    deadline = now_ms() + 3_600_000

    patched = client.patch(
        f"/admin/upstream-models/{model_id}", json={"cooldown_until_ms": deadline}
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["availability"] == {
        "state": "cooling",
        "cooldown_until_ms": deadline,
        "window_skip_until_ms": 0,
    }
    assert body["cooldown_until_ms"] == deadline

    managed_id = row_cooldown_rule_id("upstream_model", model_id)
    managed = [rule for rule in _rules(client) if rule["id"] == managed_id]
    assert len(managed) == 1
    assert (managed[0]["kind"], managed[0]["recurrence"], managed[0]["expires_at_ms"]) == (
        "cooldown",
        "once",
        deadline,
    )
    with factory() as session:
        from l04_repo.orm import UpstreamModelORM

        assert session.get(UpstreamModelORM, model_id).cooldown_until_ms == deadline

    released = client.patch(
        f"/admin/upstream-models/{model_id}", json={"cooldown_until_ms": 0}
    )
    assert released.status_code == 200, released.text
    assert released.json()["availability"] == {
        "state": "normal",
        "cooldown_until_ms": 0,
        "window_skip_until_ms": 0,
    }
    assert all(rule["id"] != managed_id for rule in _rules(client))
    with factory() as session:
        from l04_repo.orm import UpstreamModelORM

        assert session.get(UpstreamModelORM, model_id).cooldown_until_ms == 0


def test_periodic_rule_drives_api_state_and_render_exclusion(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    model_id = ids["upstream_model_id"]

    created = client.post(
        "/admin/availability-rules",
        json={
            "kind": "cooldown",
            "scope": "upstream_model",
            "scope_id": model_id,
            "recurrence": "daily",
            "schedule_json": FULL_DAY,
            "note": "每天全天冷却",
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]

    listed = _find(client.get("/admin/upstream-models?page_size=200").json(), model_id)
    assert listed["availability"]["state"] == "cooling"
    assert listed["availability"]["cooldown_until_ms"] > now_ms()

    from l05_service.rendering import build_render_plan

    # The only upstream model is cooling, so no public model has a target left.
    with factory() as session:
        with pytest.raises(AppError, match="nothing to render"):
            build_render_plan(session, revision="rev_periodic_cool")

    assert client.delete(f"/admin/availability-rules/{rule_id}").status_code == 204
    released = _find(client.get("/admin/upstream-models?page_size=200").json(), model_id)
    assert released["availability"] == {
        "state": "normal",
        "cooldown_until_ms": 0,
        "window_skip_until_ms": 0,
    }
    with factory() as session:
        ir, _keys = build_render_plan(session, revision="rev_periodic_ok")
    assert model_id in {model.id for model in ir.models}


def test_ban_rule_closes_state_without_disabling_the_row(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    model_id = ids["upstream_model_id"]
    created = client.post(
        "/admin/availability-rules",
        json={"kind": "ban", "scope": "upstream_model", "scope_id": model_id},
    )
    assert created.status_code == 201, created.text

    listed = _find(client.get("/admin/upstream-models?page_size=200").json(), model_id)
    assert listed["enabled"] is True
    assert listed["availability"] == {
        "state": "closed",
        "cooldown_until_ms": 0,
        "window_skip_until_ms": 0,
    }
