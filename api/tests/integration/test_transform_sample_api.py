"""Ticket 05: sample transform preview endpoint.

Seam: POST /admin/upstreams/{id}/transforms/sample. It replays the posted rule document
against pasted request/response snapshots and returns a field diff; it must never touch
the store, an adapter or the network (a preview, not a test against the real upstream).
"""

from __future__ import annotations

import json

from tests.conftest import seed_channel

TRANSFORMS = {
    "request_headers": [{"op": "update", "name": "x-trace", "value": "slip"}],
    "request_body": [
        {"op": "update", "path": "temperature", "value": "0.2",
         "conditions": [{"field": "model", "mode": "full", "value": "glm-5.3"}]}
    ],
}

SAMPLE = {
    "transforms": TRANSFORMS,
    "request": {
        "headers": {"x-trace": "old"},
        "body": {"model": "glm-5.3", "temperature": 0.9},
    },
    "response": {"headers": {"server": "nginx"}, "body": {"usage": {"prompt_tokens": 3}}},
}


def test_sample_preview_returns_before_after_and_field_diff(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory, transforms=json.dumps(TRANSFORMS))
    upstream_id = ids["upstream_id"]

    before_store = client.get(f"/admin/upstreams/{upstream_id}/transforms").json()["transforms"]
    response = client.post(f"/admin/upstreams/{upstream_id}/transforms/sample", json=SAMPLE)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upstream_id"] == upstream_id
    assert body["before"]["request"] == SAMPLE["request"]
    assert body["after"]["request"]["headers"] == {"x-trace": "slip"}
    assert body["after"]["request"]["body"] == {"model": "glm-5.3", "temperature": 0.2}
    assert body["after"]["response"] == SAMPLE["response"]
    diff = {(item["segment"], item["path"]): item for item in body["diff"]}
    assert diff[("request_headers", "x-trace")] == {
        "segment": "request_headers",
        "kind": "header",
        "path": "x-trace",
        "op": "update",
        "before": "old",
        "after": "slip",
    }
    assert diff[("request_body", "temperature")]["before"] == 0.9
    assert diff[("request_body", "temperature")]["after"] == 0.2

    # Non-destructive: the rule document in the store is unchanged.
    assert client.get(f"/admin/upstreams/{upstream_id}/transforms").json()["transforms"] == before_store


def test_sample_preview_rejects_unknown_rule_fields_with_readable_validation(client):
    bad = {
        "transforms": {"request_headers": [{"op": "copy", "name": "x-a"}]},
        "request": {"headers": {}, "body": None},
    }
    response = client.post("/admin/upstreams/ups_any/transforms/sample", json=bad)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert "source_name" in response.json()["message"]


def test_sample_preview_requires_an_authenticated_transforms_reader(anon_client):
    # Same permission as the existing preview (transforms:read); customer has it,
    # an anonymous browser must not reach the endpoint at all.
    response = anon_client.post("/admin/upstreams/ups_any/transforms/sample", json=SAMPLE)
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_sample_preview_rejects_unknown_top_level_and_phase_fields(client):
    unknown_top = {**SAMPLE, "surprise": 1}
    assert client.post("/admin/upstreams/ups_any/transforms/sample", json=unknown_top).status_code == 422

    unknown_phase = {**SAMPLE, "request": {"headers": {}, "body": None, "url": "/v1/chat"}}
    assert client.post("/admin/upstreams/ups_any/transforms/sample", json=unknown_phase).status_code == 422


def test_sample_preview_tolerates_an_empty_sample_and_no_rules(client):
    response = client.post(
        "/admin/upstreams/ups_any/transforms/sample",
        json={
            "transforms": {},
            "request": {"headers": {}, "body": None},
            "response": {"headers": {}, "body": None},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["diff"] == []
    assert body["after"]["request"] == {"headers": {}, "body": None}
