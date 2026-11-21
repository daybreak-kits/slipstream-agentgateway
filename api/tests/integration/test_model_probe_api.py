"""Ticket 05: model probe API (POST /admin/upstreams/{id}/models/probe).

The seam is the HTTP API with the upstream socket mocked by an httpx
MockTransport: real routing, validation, request construction and sanitising
are exercised end to end, only the network is fake.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx

from conftest import seed_channel
from l05_service import upstream_ops


def _mock_upstream(monkeypatch, handler: Callable[[httpx.Request], httpx.Response]):
    """Replace only the HTTP client factory; the probe code itself stays real."""

    def factory(timeout_s: float) -> httpx.Client:
        return httpx.Client(
            timeout=timeout_s, transport=httpx.MockTransport(handler)
        )

    monkeypatch.setattr(upstream_ops, "_probe_http_client", factory)


def _probe(client, upstream_id: str, body: dict):
    return client.post(
        f"/admin/upstreams/{upstream_id}/models/probe", json=body
    )


def _add_model(client, upstream_id: str, name: str) -> dict:
    response = client.post(
        "/admin/upstream-models", json={"upstream_id": upstream_id, "name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_probe_returns_one_result_per_model_in_request_order(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    second = _add_model(client, ids["upstream_id"], "deepseek-v3")
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen.append(
            {
                "url": str(request.url),
                "authorization": request.headers.get("authorization"),
                "payload": payload,
            }
        )
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "pong"}}]}
        )

    _mock_upstream(monkeypatch, handler)

    response = _probe(
        client,
        ids["upstream_id"],
        {"model_ids": [second["id"], ids["upstream_model_id"]]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["upstream_id"] == ids["upstream_id"]
    # no key_id in the request -> the first stored key row, reported back
    # (conftest seeds exactly one upstream key row, id=upk_test)
    assert body["key_id"] == "upk_test"
    items = body["items"]
    assert [item["model"] for item in items] == ["deepseek-v3", "glm-5.3"]
    assert [item["model_id"] for item in items] == [
        second["id"],
        ids["upstream_model_id"],
    ]
    for item in items:
        assert item["ok"] is True
        assert item["status"] == 200
        assert item["error_type"] == ""
        assert item["message"] == ""
        assert isinstance(item["latency_ms"], int) and item["latency_ms"] >= 0

    # serial, request order, minimal chat, stored base URL/style/key
    assert [entry["payload"]["model"] for entry in seen] == [
        "deepseek-v3",
        "glm-5.3",
    ]
    assert all(entry["payload"]["max_tokens"] == 16 for entry in seen)
    assert all(entry["payload"]["messages"] for entry in seen)
    assert seen[0]["url"] == "https://upstream.example/v1/chat/completions"
    assert seen[0]["authorization"] == "Bearer raw-upstream-key"

def _create_upstream(
    client,
    *,
    base_url: str = "https://other.example/v1",
    api_style: str = "openai_chat",
    api_key: str = "sk-other-0001",
) -> dict:
    response = client.post(
        "/admin/upstreams",
        json={"base_url": base_url, "api_style": api_style, "api_key": api_key},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_upstream_401_is_reported_with_redacted_truncated_message(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    long_tail = "x" * 500

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "error": {
                    "message": (
                        "Incorrect API key provided: raw-upstream-key "
                        "and sk-live-ABC123XYZ " + long_tail
                    )
                }
            },
        )

    _mock_upstream(monkeypatch, handler)
    response = _probe(
        client, ids["upstream_id"], {"model_ids": [ids["upstream_model_id"]]}
    )

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["ok"] is False
    assert item["status"] == 401
    assert item["error_type"] == "http"
    assert "401" in item["message"]
    # secret scrub: the request key, sk- style tokens and the bearer form never leak
    assert "raw-upstream-key" not in item["message"]
    assert "sk-live-ABC123XYZ" not in item["message"]
    assert "***" in item["message"]
    # truncation: one bounded line, not the whole upstream body
    assert len(item["message"]) <= upstream_ops.MODEL_PROBE_MESSAGE_LIMIT
    assert item["message"].endswith("…")


def test_timeout_is_classified_with_the_twenty_second_budget(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    timeouts: list[float] = []

    def factory(timeout_s: float) -> httpx.Client:
        timeouts.append(timeout_s)

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("read timed out", request=request)

        return httpx.Client(timeout=timeout_s, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(upstream_ops, "_probe_http_client", factory)
    response = _probe(
        client, ids["upstream_id"], {"model_ids": [ids["upstream_model_id"]]}
    )

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["ok"] is False
    assert item["status"] == 0
    assert item["error_type"] == "timeout"
    assert "20" in item["message"]
    assert timeouts == [20.0]


def test_connection_failure_is_reported_not_raised(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    _mock_upstream(monkeypatch, handler)
    response = _probe(
        client, ids["upstream_id"], {"model_ids": [ids["upstream_model_id"]]}
    )

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["ok"] is False
    assert item["status"] == 0
    assert item["error_type"] == "connection"
    assert item["message"]


def test_unknown_foreign_and_empty_model_ids_are_rejected(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    other = _create_upstream(client)
    foreign_model = _add_model(client, other["id"], "other-model")
    calls: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    endpoint = f"/admin/upstreams/{ids['upstream_id']}/models/probe"

    unknown = client.post(endpoint, json={"model_ids": ["umdl_missing"]})
    assert unknown.status_code == 422, unknown.text
    assert unknown.json()["code"] == "VALIDATION_ERROR"
    assert unknown.json()["details"]["unknown_model_ids"] == ["umdl_missing"]

    cross = client.post(endpoint, json={"model_ids": [foreign_model["id"]]})
    assert cross.status_code == 422, cross.text
    assert cross.json()["details"]["foreign_model_ids"] == [foreign_model["id"]]

    empty = client.post(endpoint, json={"model_ids": []})
    assert empty.status_code == 422, empty.text
    missing_body = client.post(endpoint, json={})
    assert missing_body.status_code == 422, missing_body.text

    # rejected requests never touch the upstream
    assert calls == []


def test_unknown_upstream_is_404(client):
    missing = client.post(
        "/admin/upstreams/ups_missing/models/probe", json={"model_ids": ["umdl_x"]}
    )
    assert missing.status_code == 404, missing.text
    assert missing.json()["code"] == "NOT_FOUND"


def test_probe_requires_model_write_permission(client, login_cookies):
    customer = client.post(
        "/admin/upstreams/ups_whatever/models/probe",
        json={"model_ids": ["umdl_whatever"]},
        cookies=login_cookies("customer"),
    )
    assert customer.status_code == 403, customer.text
    assert customer.json()["code"] == "FORBIDDEN"


def test_request_cannot_supply_a_base_url_or_style(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    calls: list[object] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    endpoint = f"/admin/upstreams/{ids['upstream_id']}/models/probe"

    base_override = client.post(
        endpoint,
        json={
            "model_ids": [ids["upstream_model_id"]],
            "base_url": "http://evil.example/v1",
        },
    )
    assert base_override.status_code == 422, base_override.text

    style_override = client.post(
        endpoint,
        json={"model_ids": [ids["upstream_model_id"]], "api_style": "gemini"},
    )
    assert style_override.status_code == 422, style_override.text
    assert calls == []


def test_key_id_selects_the_credential_and_unknown_key_is_404(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    second_key = client.post(
        f"/admin/upstreams/{ids['upstream_id']}/keys",
        json={"label": "backup", "api_key": "sk-second-9876"},
    )
    assert second_key.status_code == 201, second_key.text
    second_key_id = second_key.json()["id"]
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization", ""))
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    endpoint = f"/admin/upstreams/{ids['upstream_id']}/models/probe"

    chosen = client.post(
        endpoint,
        json={"model_ids": [ids["upstream_model_id"]], "key_id": second_key_id},
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["key_id"] == second_key_id

    default = client.post(endpoint, json={"model_ids": [ids["upstream_model_id"]]})
    assert default.status_code == 200, default.text
    assert default.json()["key_id"] == "upk_test"

    unknown = client.post(
        endpoint,
        json={"model_ids": [ids["upstream_model_id"]], "key_id": "upk_missing"},
    )
    assert unknown.status_code == 404, unknown.text

    assert seen == ["Bearer sk-second-9876", "Bearer raw-upstream-key"]


def test_probe_does_not_persist_any_state(client, engine_and_sessionmaker, monkeypatch):
    from sqlalchemy import func, select

    from l04_repo.orm import UpstreamKeyORM, UpstreamModelORM, UpstreamProbeORM

    ids = seed_channel(*engine_and_sessionmaker)
    _, factory = engine_and_sessionmaker

    def snapshot():
        with factory() as session:
            probes = int(
                session.scalar(select(func.count()).select_from(UpstreamProbeORM)) or 0
            )
            keys = {
                row.id: (row.last_test_json, row.last_test_at_ms)
                for row in session.scalars(select(UpstreamKeyORM)).all()
            }
            models = {
                row.id: (row.name, row.enabled, row.cooldown_until_ms)
                for row in session.scalars(select(UpstreamModelORM)).all()
            }
            return probes, keys, models

    before = snapshot()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    response = _probe(
        client, ids["upstream_id"], {"model_ids": [ids["upstream_model_id"]]}
    )
    assert response.status_code == 200, response.text

    assert snapshot() == before
    detail = client.get(f"/admin/upstreams/{ids['upstream_id']}").json()
    assert detail["last_probe"] is None


def test_single_model_id_spelling_and_both_forms_combine(
    client, engine_and_sessionmaker, monkeypatch
):
    ids = seed_channel(*engine_and_sessionmaker)
    second = _add_model(client, ids["upstream_id"], "deepseek-v3")
    probed: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        probed.append(json.loads(request.content)["model"])
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    endpoint = f"/admin/upstreams/{ids['upstream_id']}/models/probe"

    single = client.post(endpoint, json={"model_id": ids["upstream_model_id"]})
    assert single.status_code == 200, single.text
    assert [item["model"] for item in single.json()["items"]] == ["glm-5.3"]

    both = client.post(
        endpoint,
        json={"model_id": ids["upstream_model_id"], "model_ids": [second["id"]]},
    )
    assert both.status_code == 200, both.text
    assert [item["model"] for item in both.json()["items"]] == [
        "glm-5.3",
        "deepseek-v3",
    ]

    assert probed == ["glm-5.3", "glm-5.3", "deepseek-v3"]


def test_each_api_style_uses_its_own_minimal_chat_endpoint(client, monkeypatch):
    styles = [
        (
            "openai_chat",
            "https://chat.example/v1",
            "https://chat.example/v1/chat/completions",
            {},
        ),
        (
            "openai_responses",
            "https://responses.example/v1",
            "https://responses.example/v1/responses",
            {},
        ),
        (
            "anthropic_messages",
            "https://anthropic.example/v1",
            "https://anthropic.example/v1/messages",
            {"anthropic-version": "2023-06-01", "x-api-key": "sk-anthropic_messages"},
        ),
        (
            "gemini",
            "https://gemini.example/v1beta",
            "https://gemini.example/v1beta/models/gemini-2.5-pro:generateContent",
            {"x-goog-api-key": "sk-gemini"},
        ),
    ]
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(
            {
                "url": str(request.url),
                "headers": dict(request.headers),
                "payload": json.loads(request.content),
            }
        )
        return httpx.Response(200, json={})

    _mock_upstream(monkeypatch, handler)
    for style, base_url, url, headers in styles:
        upstream = _create_upstream(
            client, base_url=base_url, api_style=style, api_key=f"sk-{style}"
        )
        model_name = "gemini-2.5-pro" if style == "gemini" else f"{style}-model"
        model = _add_model(client, upstream["id"], model_name)
        response = _probe(
            client, upstream["id"], {"model_ids": [model["id"]]}
        )
        assert response.status_code == 200, response.text
        assert response.json()["items"][0]["ok"] is True
        entry = seen[-1]
        assert entry["url"] == url
        for header, value in headers.items():
            assert entry["headers"][header] == value

    payloads = [entry["payload"] for entry in seen]
    assert payloads[0]["max_tokens"] == 16 and payloads[0]["messages"]
    assert payloads[1]["max_output_tokens"] == 16 and payloads[1]["input"] == "ping"
    assert payloads[2]["max_tokens"] == 16 and payloads[2]["messages"]
    assert payloads[3]["generationConfig"] == {"maxOutputTokens": 16}
    assert payloads[3]["contents"]
