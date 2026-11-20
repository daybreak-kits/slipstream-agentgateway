"""ADR-028: adapter-owned OTLP telemetry -> RequestAttempt -> /admin/logs/{id}/attempts.

The adapter receiver is exercised through its ASGI app; the control-plane DB is
exercised through the real attempt sink. The E19 wire shape (one server root
span + one client span per upstream attempt) is decoded into normalized attempt
facts and joined to a usage event by trace id.
"""

from __future__ import annotations

import socket
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from tests.conftest import _app_client, make_admin, new_session_token, seed_channel
from tests.otlp_builder import TRACE_ID, e19_export

from l02_domain.models import RequestAttempt, UsageEvent
from l03_adapters.agentgateway import telemetry
from l03_adapters.agentgateway.telemetry import (
    TelemetryReceiver,
    create_telemetry_app,
    wire_telemetry,
)
from l04_repo.orm import GatewayUsageEventORM, RequestAttemptORM
from l05_service.attempts import build_attempt_sink, record_attempts
from l05_service.usage_ingest import ingest_usage_events
from l06_api.deps import SESSION_COOKIE

CONTENT_TYPE = "application/x-protobuf"


def _post_traces(app, payload: bytes):
    with TestClient(app) as client:
        return client.post("/v1/traces", content=payload, headers={"content-type": CONTENT_TYPE})


def test_telemetry_app_decodes_e19_export_into_normalized_attempts():
    captured: list[RequestAttempt] = []

    def sink(attempts):
        captured.extend(attempts)
        return len(attempts)

    received = _post_traces(create_telemetry_app(sink), e19_export())
    assert received.status_code == 200, received.text
    assert received.content == b""
    assert [attempt.attempt_no for attempt in captured] == [1, 2, 3]
    assert [attempt.status_code for attempt in captured] == [500, 500, 200]
    assert [attempt.error_type for attempt in captured] == ["500", "500", ""]
    assert [attempt.outcome for attempt in captured] == ["error", "error", "ok"]
    assert [attempt.duration_ms for attempt in captured] == [2, 2, 2]
    assert [attempt.upstream_ref for attempt in captured] == [
        "/fail500/chat/completions",
        "/fail500/chat/completions",
        "/ok/chat/completions",
    ]
    assert {attempt.correlation_key for attempt in captured} == {TRACE_ID}
    assert {attempt.adapter_id for attempt in captured} == {"agentgateway"}
    assert {attempt.model for attempt in captured} == {"mock-model"}


def test_duplicate_export_upserts_the_same_attempts(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    app = create_telemetry_app(build_attempt_sink(factory))
    assert _post_traces(app, e19_export()).status_code == 200
    assert _post_traces(app, e19_export()).status_code == 200
    with factory() as session:
        rows = session.scalars(
            select(RequestAttemptORM).order_by(RequestAttemptORM.attempt_no)
        ).all()
    assert [row.attempt_no for row in rows] == [1, 2, 3]
    assert [row.status_code for row in rows] == [500, 500, 200]


def test_attempt_endpoint_returns_attempts_and_resolves_upstream_name(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    with factory() as session:
        ingest_usage_events(
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
        record_attempts(
            session,
            [
                RequestAttempt(
                    correlation_key=TRACE_ID,
                    attempt_no=1,
                    upstream_ref="ups_test",
                    model="glm-5.3",
                    status_code=500,
                    error_type="500",
                    started_at_ms=1_800_000_000_001,
                    duration_ms=2,
                    outcome="error",
                    adapter_id="agentgateway",
                ),
                RequestAttempt(
                    correlation_key=TRACE_ID,
                    attempt_no=2,
                    upstream_ref="ups_test",
                    model="glm-5.3",
                    status_code=200,
                    started_at_ms=1_800_000_000_005,
                    duration_ms=2,
                    outcome="ok",
                    adapter_id="agentgateway",
                ),
            ],
        )
        session.commit()

    response = client.get("/admin/logs/evt_trace_join/attempts")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["event_id"] == "evt_trace_join"
    assert body["trace_id"] == TRACE_ID
    assert [attempt["attempt"] for attempt in body["attempts"]] == [1, 2]
    assert [attempt["upstream_ref"] for attempt in body["attempts"]] == [
        "ups_test",
        "ups_test",
    ]
    assert [attempt["upstream_name"] for attempt in body["attempts"]] == [
        "testv-01",
        "testv-01",
    ]
    assert [attempt["status_code"] for attempt in body["attempts"]] == [500, 200]
    assert [attempt["outcome"] for attempt in body["attempts"]] == ["error", "ok"]

    item = client.get("/admin/logs").json()["items"][0]
    assert item["attempts_count"] == 2
    assert item["has_attempts"] is True


def test_log_without_attempts_returns_an_empty_list(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        ingest_usage_events(
            session,
            [
                UsageEvent(
                    event_id="evt_no_trace",
                    started_at_ms=1_800_000_000_000,
                    duration_ms=1,
                    http_status=200,
                    public_model="flagship",
                )
            ],
        )
        session.commit()

    response = client.get("/admin/logs/evt_no_trace/attempts")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "event_id": "evt_no_trace",
        "trace_id": "",
        "attempts": [],
    }


def test_attempt_query_for_an_unknown_log_is_404(client):
    response = client.get("/admin/logs/does-not-exist/attempts")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_attempt_query_requires_logs_read_permission(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    created = client.post(
        "/admin/roles",
        json={"name": "attempt-noperm-" + uuid4().hex[:6], "permissions": []},
    )
    assert created.status_code == 201, created.text
    admin_id = make_admin(
        factory,
        username="attempt-noperm-" + uuid4().hex[:6],
        role=created.json()["key"],
    )
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    response = browser.get("/admin/logs/evt_trace_join/attempts")
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_attempt_query_requires_a_session(anon_client):
    response = anon_client.get("/admin/logs/evt_trace_join/attempts")
    assert response.status_code == 401


def test_receiver_rejects_malformed_json_and_oversized_bodies(monkeypatch):
    captured: list[RequestAttempt] = []
    app = create_telemetry_app(lambda attempts: captured.extend(attempts) or len(attempts))
    with TestClient(app) as receiver:
        malformed = receiver.post(
            "/v1/traces", content=b"\x0a\xff", headers={"content-type": CONTENT_TYPE}
        )
        assert malformed.status_code == 400
        unsupported = receiver.post(
            "/v1/traces", json={}, headers={"content-type": "application/json"}
        )
        assert unsupported.status_code == 415
        monkeypatch.setattr(telemetry, "MAX_OTLP_BODY_BYTES", 16)
        oversized = receiver.post(
            "/v1/traces", content=e19_export(), headers={"content-type": CONTENT_TYPE}
        )
        assert oversized.status_code == 413
    assert captured == []


def test_body_size_limit_is_eight_megabytes():
    assert telemetry.MAX_OTLP_BODY_BYTES == 8 * 1024 * 1024


def test_bind_failure_degrades_to_a_warning(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        port = occupied.getsockname()[1]
        receiver = TelemetryReceiver(lambda attempts: len(attempts), host="127.0.0.1", port=port)
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
        candidate = TelemetryReceiver(
            lambda attempts: len(attempts), host="127.0.0.1", port=port
        )
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


def test_wiring_degrades_without_crashing_when_the_port_is_taken(monkeypatch):
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen(1)
        port = occupied.getsockname()[1]
        monkeypatch.setenv("SLIPSTREAM_AG_TRACE_PORT", str(port))
        app = FastAPI()

        @app.get("/ping")
        def ping() -> dict:
            return {"ok": True}

        telemetry.set_export_enabled(False)
        receiver = wire_telemetry(app, lambda attempts: len(attempts))
        with TestClient(app) as browser:
            assert browser.get("/ping").json() == {"ok": True}
            assert receiver.running is False
            assert telemetry.export_enabled() is False
        assert telemetry.export_enabled() is False
    finally:
        occupied.close()


def test_usage_event_attempt_count_aggregation(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        ingest_usage_events(
            session,
            [
                UsageEvent(
                    event_id="evt_a", started_at_ms=1, duration_ms=1, http_status=200
                ),
                UsageEvent(
                    event_id="evt_b", started_at_ms=2, duration_ms=1, http_status=200
                ),
            ],
        )
        record_attempts(
            session,
            [
                RequestAttempt(correlation_key="k1", attempt_no=1, outcome="ok"),
                RequestAttempt(correlation_key="k1", attempt_no=2, outcome="ok"),
                RequestAttempt(correlation_key="k2", attempt_no=1, outcome="error"),
            ],
        )
        session.commit()
        assert session.scalar(select(func.count()).select_from(GatewayUsageEventORM)) == 2
