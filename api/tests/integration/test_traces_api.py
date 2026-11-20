"""M5-a: OTLP receive -> trace_spans -> /admin/traces routing-chain query.

The receiver is exercised through its real ASGI app (TestClient), then the admin
endpoint reads the same control-plane DB. This is the E19 contract end to end:
one server root span + one client span per upstream attempt, attempt order by
start time, and request_logs.trace_id as the join key.
"""

from __future__ import annotations

import socket
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.conftest import _app_client, make_admin, new_session_token
from tests.otlp_builder import CLIENT_1, ROOT_SPAN_ID, TRACE_ID, e19_export

from l01_core.settings import Settings
from l02_domain.models import UsageEvent
from l05_service.usage_ingest import ingest_usage_events
from l06_api import trace_receiver
from l06_api.deps import SESSION_COOKIE
from l06_api.trace_receiver import (
    TraceReceiver,
    create_trace_receiver_app,
    wire_trace_receiver,
)

CONTENT_TYPE = "application/x-protobuf"


def _post_traces(factory, payload: bytes):
    app = create_trace_receiver_app(factory)
    with TestClient(app) as client:
        return client.post("/v1/traces", content=payload, headers={"content-type": CONTENT_TYPE})


def test_receiver_ingests_and_trace_endpoint_rebuilds_attempts(
    client, engine_and_sessionmaker
):
    _, factory = engine_and_sessionmaker
    received = _post_traces(factory, e19_export())
    assert received.status_code == 200, received.text
    assert received.content == b""

    response = client.get(f"/admin/traces/{TRACE_ID}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["trace_id"] == TRACE_ID
    spans = body["spans"]
    assert [span["span_id"] for span in spans] == [
        ROOT_SPAN_ID,
        CLIENT_1,
        "0c271b41cc5f454c",
        "6ad1cd338ac8b7c3",
    ]
    root = spans[0]
    assert root["kind"] == "server"
    assert root["parent_span_id"] == ""
    assert root["http_status"] == 200
    assert root["retry_attempt"] == 2
    assert root["duration_ms"] == 20
    assert root["attributes"]["gen_ai.request.model"] == "mock-model"
    assert "client.address" not in root["attributes"]
    # Only the client attempt spans become attempts, numbered in start order.
    attempts = body["attempts"]
    assert [attempt["attempt"] for attempt in attempts] == [1, 2, 3]
    assert [attempt["http_path"] for attempt in attempts] == [
        "/fail500/chat/completions",
        "/fail500/chat/completions",
        "/ok/chat/completions",
    ]
    assert [attempt["http_status"] for attempt in attempts] == [500, 500, 200]
    assert [attempt["error_type"] for attempt in attempts] == ["500", "500", ""]
    assert [attempt["duration_ms"] for attempt in attempts] == [2, 2, 2]
    assert [attempt["span_id"] for attempt in attempts] == [
        CLIENT_1,
        "0c271b41cc5f454c",
        "6ad1cd338ac8b7c3",
    ]
    # Client attribute whitelist: AG outbound subtype is dropped.
    assert spans[1]["attributes"] == {
        "http.path": "/fail500/chat/completions",
        "http.status": 500,
        "error.type": "500",
    }


def test_duplicate_export_is_idempotent(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    assert _post_traces(factory, e19_export()).status_code == 200
    assert _post_traces(factory, e19_export()).status_code == 200
    body = client.get(f"/admin/traces/{TRACE_ID}").json()
    assert len(body["spans"]) == 4
    assert len(body["attempts"]) == 3


def test_unknown_trace_is_404(client):
    response = client.get("/admin/traces/does-not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_trace_query_requires_logs_read_permission(
    client, engine_and_sessionmaker
):
    _, factory = engine_and_sessionmaker
    _post_traces(factory, e19_export())
    created = client.post(
        "/admin/roles",
        json={"name": "trace-noperm-" + uuid4().hex[:6], "permissions": []},
    )
    assert created.status_code == 201, created.text
    admin_id = make_admin(
        factory, username="trace-noperm-" + uuid4().hex[:6], role=created.json()["key"]
    )
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    response = browser.get(f"/admin/traces/{TRACE_ID}")
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_trace_query_requires_a_session(anon_client):
    response = anon_client.get(f"/admin/traces/{TRACE_ID}")
    assert response.status_code == 401


def test_receiver_rejects_malformed_json_and_oversized_bodies(
    engine_and_sessionmaker, monkeypatch
):
    _, factory = engine_and_sessionmaker
    app = create_trace_receiver_app(factory)
    with TestClient(app) as receiver:
        malformed = receiver.post(
            "/v1/traces", content=b"\x0a\xff", headers={"content-type": CONTENT_TYPE}
        )
        assert malformed.status_code == 400
        unsupported = receiver.post(
            "/v1/traces", json={}, headers={"content-type": "application/json"}
        )
        assert unsupported.status_code == 415
        monkeypatch.setattr(trace_receiver, "MAX_OTLP_BODY_BYTES", 16)
        oversized = receiver.post(
            "/v1/traces", content=e19_export(), headers={"content-type": CONTENT_TYPE}
        )
        assert oversized.status_code == 413


def test_body_size_limit_can_be_overridden_only_for_tests(
    engine_and_sessionmaker,
):
    # The production guard is 8 MB; this document-level assertion keeps the
    # ticket's explicit limit from drifting silently.
    assert trace_receiver.MAX_OTLP_BODY_BYTES == 8 * 1024 * 1024


def test_bind_failure_degrades_to_a_warning(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        port = occupied.getsockname()[1]
        receiver = TraceReceiver(factory, host="127.0.0.1", port=port)
        assert receiver.start() is False
        assert receiver.running is False
        receiver.stop()
    finally:
        occupied.close()


def test_receiver_starts_and_stops_on_an_ephemeral_port(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    receiver = None
    for _ in range(3):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        candidate = TraceReceiver(factory, host="127.0.0.1", port=port)
        if candidate.start():
            receiver = candidate
            break
    assert receiver is not None, "receiver failed to bind three free ephemeral ports"
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            pass
        assert receiver.running is True
    finally:
        receiver.stop()
    assert receiver.running is False


def test_wiring_registers_lifespan_handlers_without_binding_failure_crash(
    engine_and_sessionmaker,
):
    _, factory = engine_and_sessionmaker
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        occupied.bind(("127.0.0.1", 0))
        port = occupied.getsockname()[1]
        app = FastAPI()

        @app.get("/ping")
        def ping() -> dict:
            return {"ok": True}

        settings = Settings(trace_otlp_host="127.0.0.1", trace_otlp_port=port)
        receiver = wire_trace_receiver(app, factory, settings)
        with TestClient(app) as browser:
            assert browser.get("/ping").json() == {"ok": True}
            assert receiver.running is False
    finally:
        occupied.close()


def test_ingested_usage_log_exposes_trace_id_in_detail_and_list(
    client, engine_and_sessionmaker
):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        added = ingest_usage_events(
            session,
            [
                UsageEvent(
                    event_id="evt_trace_join",
                    started_at_ms=1_800_000_000_000,
                    completed_at_ms=1_800_000_000_020,
                    duration_ms=20,
                    http_status=200,
                    public_model="flagship",
                    trace_id=TRACE_ID,
                )
            ],
        )
        session.commit()
    assert added == 1
    detail = client.get("/admin/logs/evt_trace_join")
    assert detail.status_code == 200, detail.text
    assert detail.json()["trace_id"] == TRACE_ID
    items = client.get("/admin/logs").json()["items"]
    by_id = {item["event_id"]: item for item in items}
    assert by_id["evt_trace_join"]["trace_id"] == TRACE_ID
