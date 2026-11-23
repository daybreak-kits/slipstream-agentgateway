"""W9 model tests go through the data plane, never straight to an upstream.

Seam: HTTP API + the model_test service; only the HTTP call to the data plane is
mocked. The assertions pin the contract the UI relies on: auto public name,
internal test key, per-model order, error passthrough and log-backed history.
"""

from __future__ import annotations

import httpx
from tests.conftest import _authenticated_client, seed_channel

from l03_adapters.fake import FakeAdapter
from l04_repo.orm import GatewayUsageEventORM, PublicModelORM
from l05_service import auto_public, model_test


def _client(engine, factory):
    client = _authenticated_client(factory, "admin")
    from l06_api.deps import get_adapter

    client.app.dependency_overrides[get_adapter] = lambda: FakeAdapter()
    return client


class _DataPlane:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self.responses = list(responses)
        self.requests: list[dict] = []

    def __call__(self, *args, **kwargs):
        plane = self

        class Client:
            def __init__(self, *a, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, json=None, headers=None):
                plane.requests.append({"url": url, "json": json, "headers": headers})
                return plane.responses.pop(0)

        return Client()


def test_probe_uses_internal_key_and_auto_public_name(
    client, engine_and_sessionmaker, monkeypatch
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    plane = _DataPlane(
        [
            httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "pong"}}],
                    "usage": {"prompt_tokens": 2, "completion_tokens": 1},
                },
            )
        ]
    )
    monkeypatch.setattr(model_test.httpx, "Client", plane)

    response = client.post(
        f"/admin/upstreams/{ids['upstream_id']}/models/probe",
        json={"model_ids": [ids["upstream_model_id"]]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"][0]["ok"] is True
    assert body["items"][0]["public_model"] == "upstream-example/glm-5.3"
    assert body["key_id"] != "upk_test"
    assert body["items"][0]["usage"] == {"prompt_tokens": 2, "completion_tokens": 1}

    assert len(plane.requests) == 1
    request = plane.requests[0]
    assert request["json"]["model"] == "upstream-example/glm-5.3"
    assert request["json"]["max_tokens"] == 16
    assert request["json"]["messages"][0]["content"] == "hi"
    assert request["headers"]["Authorization"].startswith("Bearer sk-")


def test_upstream_error_is_reported_without_raising(
    client, engine_and_sessionmaker, monkeypatch
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    plane = _DataPlane(
        [httpx.Response(401, json={"error": {"message": "Incorrect API key provided"}})]
    )
    monkeypatch.setattr(model_test.httpx, "Client", plane)
    response = client.post(
        f"/admin/upstreams/{ids['upstream_id']}/models/probe",
        json={"model_ids": [ids["upstream_model_id"]]},
    )
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["ok"] is False
    assert item["status"] == 401
    assert "Incorrect API key" in item["message"]


def test_data_plane_auth_failure_points_at_missing_config_apply(
    client, engine_and_sessionmaker, monkeypatch
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    plane = _DataPlane([httpx.Response(401, text="authentication failed")])
    monkeypatch.setattr(model_test.httpx, "Client", plane)
    response = client.post(
        f"/admin/upstreams/{ids['upstream_id']}/models/probe",
        json={"model_ids": [ids["upstream_model_id"]]},
    )
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["ok"] is False
    assert item["status"] == 401
    assert "尚未加载测试专用凭据" in item["message"]
    assert "保存并下发" in item["message"]


def test_unknown_model_and_foreign_model_are_422(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    response = client.post(
        f"/admin/upstreams/{ids['upstream_id']}/models/probe",
        json={"model_ids": ["umdl_missing"]},
    )
    assert response.status_code == 422


def test_test_results_are_read_from_usage_log(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        from l04_repo.orm import UpstreamModelORM

        model = session.get(UpstreamModelORM, ids["upstream_model_id"])
        public = auto_public.ensure_auto_public_model(session, model)
        key = model_test.ensure_test_identity(session)
        session.add(
            GatewayUsageEventORM(
                event_id="evt_model_test_1",
                started_at_ms=1_800_000_000_000,
                duration_ms=321,
                http_status=200,
                public_model=public.name,
                upstream_model=model.name,
                api_key_id=key.id,
                input_tokens=12,
                output_tokens=3,
            )
        )
        session.commit()
        public_name = public.name

    response = client.get(
        f"/admin/upstreams/{ids['upstream_id']}/models/test-results"
    )
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["public_model"] == public_name
    assert item["status"] == 200
    assert item["ok"] is True
    assert item["latency_ms"] == 321
    assert item["input_tokens"] == 12


def test_new_upstream_model_auto_registers_public_model(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    created = client.post(
        "/admin/upstream-models",
        json={"upstream_id": ids["upstream_id"], "name": "deepseek-v3"},
    )
    assert created.status_code == 201, created.text
    with factory() as session:
        public = session.query(PublicModelORM).filter_by(
            name="upstream-example/deepseek-v3"
        ).one()
        assert public.auto_generated is True


def test_rename_upstream_model_keeps_auto_public_name_in_sync(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    ids = seed_channel(engine, factory)
    with factory() as session:
        from l04_repo.orm import UpstreamModelORM

        model = session.get(UpstreamModelORM, ids["upstream_model_id"])
        public = auto_public.ensure_auto_public_model(session, model)
        old_name = public.name
        assert old_name == "upstream-example/glm-5.3"
        model.name = "glm-5.3-renamed"
        auto_public.rename_for_upstream_model(
            session, model, old_model_name="glm-5.3"
        )
        session.commit()
        assert public.name == "upstream-example/glm-5.3-renamed"
        assert (
            session.query(PublicModelORM)
            .filter_by(name="upstream-example/glm-5.3")
            .first()
            is None
        )
