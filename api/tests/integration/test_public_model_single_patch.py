"""Ticket 12: one PATCH carries basic fields, routing_mode, enabled and members.

The public-model save is atomic: the same request replaces the whole member list
and edits the alias row, and the final state is validated before anything is
committed. The old PUT /admin/public-models/{id}/targets endpoint is deleted with
no alias and no compatibility layer (ticket 12).
"""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token, seed_channel

from l06_api.deps import SESSION_COOKIE


def _create_upstream_model(client, upstream_id: str, name: str) -> dict:
    response = client.post(
        "/admin/upstream-models", json={"upstream_id": upstream_id, "name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_public_model(
    client,
    name: str,
    routing_mode: str = "failover",
    targets: list[dict] | None = None,
) -> dict:
    response = client.post(
        "/admin/public-models",
        json={"name": name, "routing_mode": routing_mode, "targets": targets or []},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _public_model(client, public_model_id: str) -> dict:
    rows = client.get("/admin/public-models?page_size=200").json()
    return next(row for row in rows if row["id"] == public_model_id)


def _members(body: dict) -> list[tuple[str, int, int, str]]:
    return [
        (target["upstream_model_id"], target["priority"], target["weight"], target["when"])
        for target in body["targets"]
    ]


def _client_for(factory, role: str):
    admin_id = make_admin(factory, username="pm-" + role + "-x", role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def test_patch_saves_basic_fields_routing_mode_enabled_and_targets_atomically(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    second = _create_upstream_model(client, ids["upstream_id"], "glm-6-air")
    third = _create_upstream_model(client, ids["upstream_id"], "glm-6-turbo")
    created = _create_public_model(
        client,
        "combo",
        targets=[
            {"upstream_model_id": ids["upstream_model_id"], "priority": 2},
            {"upstream_model_id": second["id"], "priority": 1},
        ],
    )
    kept_id = next(
        target["id"]
        for target in created["targets"]
        if target["upstream_model_id"] == ids["upstream_model_id"]
    )

    saved = client.patch(
        f"/admin/public-models/{created['id']}",
        json={
            "name": "combo-v2",
            "routing_mode": "weighted",
            "note": "单次保存",
            "enabled": False,
            "targets": [
                {"upstream_model_id": third["id"], "priority": 2, "weight": 3},
                {"upstream_model_id": ids["upstream_model_id"], "priority": 1, "weight": 1},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["name"] == "combo-v2"
    assert body["routing_mode"] == "weighted"
    assert body["note"] == "单次保存"
    assert body["enabled"] is False
    assert body["availability"]["state"] == "closed"
    assert body["target_count"] == 2
    # Response is in routing order (priority SMALL first), not request order.
    assert _members(body) == [
        (ids["upstream_model_id"], 1, 1, ""),
        (third["id"], 2, 3, ""),
    ]
    # A member that stayed keeps its row id across the re-declaration.
    assert body["targets"][0]["id"] == kept_id

    # The whole change landed in one transaction, so the list view agrees.
    listed = _public_model(client, created["id"])
    assert (listed["name"], listed["routing_mode"], listed["enabled"]) == (
        "combo-v2",
        "weighted",
        False,
    )
    assert _members(listed) == _members(body)


def test_patch_without_targets_keeps_members(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    patched = client.patch(
        f"/admin/public-models/{ids['public_id']}",
        json={"name": "renamed", "note": "只改基本字段"},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert (body["name"], body["note"]) == ("renamed", "只改基本字段")
    assert _members(body) == [(ids["upstream_model_id"], 1, 0, "")]


def test_patch_with_empty_targets_is_rejected_and_rolls_back(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    rejected = client.patch(
        f"/admin/public-models/{ids['public_id']}",
        json={"name": "half-saved", "targets": []},
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["code"] == "VALIDATION_ERROR"

    # The name write that preceded the rejected member list must be rolled back.
    listed = _public_model(client, ids["public_id"])
    assert listed["name"] == "flagship"
    assert _members(listed) == [(ids["upstream_model_id"], 1, 0, "")]


def test_patch_duplicate_members_is_rejected_and_rolls_back(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    second = _create_upstream_model(client, ids["upstream_id"], "glm-6-air")

    rejected = client.patch(
        f"/admin/public-models/{ids['public_id']}",
        json={
            "routing_mode": "weighted",
            "targets": [
                {"upstream_model_id": second["id"], "priority": 1, "weight": 1},
                {"upstream_model_id": second["id"], "priority": 2, "weight": 2},
            ],
        },
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["code"] == "VALIDATION_ERROR"
    assert "重复" in rejected.json()["message"]

    listed = _public_model(client, ids["public_id"])
    assert listed["routing_mode"] == "failover"
    assert _members(listed) == [(ids["upstream_model_id"], 1, 0, "")]


def test_patch_enters_and_leaves_conditional_in_one_save(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    second = _create_upstream_model(client, ids["upstream_id"], "glm-6-air")
    url = f"/admin/public-models/{ids['public_id']}"

    entered = client.patch(
        url,
        json={
            "routing_mode": "conditional",
            "targets": [
                {
                    "upstream_model_id": ids["upstream_model_id"],
                    "priority": 1,
                    "when": 'request.user_id == "u1"',
                },
                {"upstream_model_id": second["id"], "priority": 2, "when": ""},
            ],
        },
    )
    assert entered.status_code == 200, entered.text
    assert entered.json()["routing_mode"] == "conditional"
    assert _members(entered.json()) == [
        (ids["upstream_model_id"], 1, 0, 'request.user_id == "u1"'),
        (second["id"], 2, 0, ""),
    ]

    # The empty-when fallback must stay last AFTER priority ordering.
    rejected = client.patch(
        url,
        json={
            "routing_mode": "conditional",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 1, "when": ""},
                {
                    "upstream_model_id": second["id"],
                    "priority": 2,
                    "when": 'request.model == "x"',
                },
            ],
        },
    )
    assert rejected.status_code == 422, rejected.text
    assert "最后" in rejected.json()["message"]
    assert _members(_public_model(client, ids["public_id"])) == _members(entered.json())

    left = client.patch(url, json={"routing_mode": "failover"})
    assert left.status_code == 200, left.text
    assert left.json()["routing_mode"] == "failover"
    assert _members(left.json()) == _members(entered.json())


def test_patch_invalid_member_rolls_back_everything(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)

    rejected = client.patch(
        f"/admin/public-models/{ids['public_id']}",
        json={
            "name": "should-not-land",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 9},
                {"upstream_model_id": "umdl_does_not_exist", "priority": 2},
            ],
        },
    )
    assert rejected.status_code == 404, rejected.text
    assert rejected.json()["code"] == "NOT_FOUND"

    listed = _public_model(client, ids["public_id"])
    assert listed["name"] == "flagship"
    # The first member's priority update was flushed before the failure; the
    # transaction rollback must undo it.
    assert _members(listed) == [(ids["upstream_model_id"], 1, 0, "")]


def test_patch_with_targets_requires_model_targets_write(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    created_role = client.post(
        "/admin/roles",
        json={
            "name": "公开模型基础编辑",
            "permissions": ["public_models:read", "public_models:write"],
        },
    )
    assert created_role.status_code == 201, created_role.text
    role_key = created_role.json()["key"]
    editor = _client_for(factory, role_key)
    url = f"/admin/public-models/{ids['public_id']}"

    basic = editor.patch(url, json={"name": "basic-only"})
    assert basic.status_code == 200, basic.text

    denied = editor.patch(
        url,
        json={
            "name": "should-not-land",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 3}
            ],
        },
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["code"] == "FORBIDDEN"
    assert denied.json()["details"]["permission"] == "model_targets:write"
    # The permission gate runs before any write, so nothing half-landed.
    listed = _public_model(client, ids["public_id"])
    assert listed["name"] == "basic-only"
    assert _members(listed) == [(ids["upstream_model_id"], 1, 0, "")]

    # Granting model_targets:write makes the very same request succeed.
    role_row = next(
        row for row in client.get("/admin/roles").json()["items"] if row["key"] == role_key
    )
    granted = client.patch(
        "/admin/roles/" + role_row["id"],
        json={
            "permissions": [
                "public_models:read",
                "public_models:write",
                "model_targets:write",
            ]
        },
    )
    assert granted.status_code == 200, granted.text
    allowed = editor.patch(
        url,
        json={
            "name": "should-land",
            "targets": [
                {"upstream_model_id": ids["upstream_model_id"], "priority": 3}
            ],
        },
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["name"] == "should-land"
    assert _members(allowed.json()) == [(ids["upstream_model_id"], 3, 0, "")]


def test_old_put_targets_endpoint_is_gone(engine_and_sessionmaker, monkeypatch):
    engine, factory = engine_and_sessionmaker
    # Pin the API-only app: a built web/dist mounts a SPA catch-all GET route, and
    # Starlette answers 405 for a PUT whose path only matches that GET (the route
    # really is gone either way; this test asserts the plain API deployment).
    from l06_api import spa

    monkeypatch.setattr(spa, "resolve_web_dist", lambda dist_dir=None: None)
    admin_id = make_admin(factory, username="no-spa-owner", role="owner")
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    ids = seed_channel(engine, factory)

    gone = client.put(
        f"/admin/public-models/{ids['public_id']}/targets",
        json={"targets": [{"upstream_model_id": ids["upstream_model_id"], "priority": 2}]},
    )
    assert gone.status_code == 404

    # No compatibility alias, no OpenAPI surface, no leftover request schema.
    spec = client.app.openapi()
    assert "/admin/public-models/{public_model_id}/targets" not in spec["paths"]
    assert "PublicModelTargets" not in spec["components"]["schemas"]
    patch_schema = spec["components"]["schemas"]["PublicModelPatch"]
    assert "targets" in patch_schema["properties"]
    registered = {getattr(route, "path", None) for route in client.app.routes}
    assert "/admin/public-models/{public_model_id}/targets" not in registered
