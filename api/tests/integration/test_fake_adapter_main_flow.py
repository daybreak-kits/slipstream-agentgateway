"""W6 ticket 01: the control plane runs its main flow on the fake adapter.

The fake driver is selected through the normal settings/registry path (never a
test-only branch inside routers). With no real data plane, startup, health,
connection info, usage pull/list, log list/detail, a config apply and the daily
cleanup seam must all work.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from tests.conftest import make_admin, new_session_token, seed_channel

from l01_core.settings import reset_settings_cache
from l03_adapters.fake import FakeAdapter
from l06_api.deps import SESSION_COOKIE
from l07_jobs.log_cleanup import cleanup_job
from server import create_app

FAKE_ADAPTER_ENV = "SLIPSTREAM_DATA_PLANE_ADAPTER"


@pytest.fixture()
def fake_flow(engine_and_sessionmaker, monkeypatch):
    """An authenticated app whose configured data plane is the fake driver."""
    engine, factory = engine_and_sessionmaker
    monkeypatch.setenv(FAKE_ADAPTER_ENV, "fake")
    monkeypatch.setenv("SLIPSTREAM_JOBS_ENABLED", "0")
    reset_settings_cache()
    app = create_app(session_factory=factory, init_tables=False, jobs=False)
    admin_id = make_admin(factory, username="fake-flow-owner")
    token = new_session_token(factory, admin_id)
    with TestClient(app) as client:
        client.cookies.set(SESSION_COOKIE, token)
        yield client, engine, factory
    reset_settings_cache()


def test_fake_adapter_runs_startup_health_and_connection(fake_flow) -> None:
    client, _engine, _factory = fake_flow

    health = client.get("/admin/health")
    assert health.status_code == 200, health.text
    body = health.json()
    assert body["status"] == "ok"
    assert body["adapter"] == "fake"

    connection = client.get("/admin/connection")
    assert connection.status_code == 200, connection.text
    payload = connection.json()
    assert payload["endpoints"]
    assert all(path.startswith("/v1/") for path in payload["endpoints"])


def test_fake_adapter_runs_usage_and_log_flows(fake_flow) -> None:
    client, _engine, _factory = fake_flow
    adapter = FakeAdapter()
    default_ids = [event.event_id for event in adapter.usage(None).events]
    assert default_ids, "the fake driver must ship deterministic flow events"

    pulled = client.post("/admin/usage/pull")
    assert pulled.status_code == 200, pulled.text
    assert pulled.json()["added"] == len(default_ids)

    usage = client.get("/admin/usage/events")
    assert usage.status_code == 200, usage.text
    assert {row["event_id"] for row in usage.json()} == set(default_ids)
    # Usage events carry neutral facts only; the raw wire row is never served.
    assert all("raw_json" not in row for row in usage.json())

    logs = client.get("/admin/logs")
    assert logs.status_code == 200, logs.text
    log_body = logs.json()
    assert {row["event_id"] for row in log_body["items"]} == set(default_ids)
    assert log_body["total"] == len(default_ids)
    by_id = {row["event_id"]: row for row in log_body["items"]}
    # The adapter-normalized facts survive the whole ingest -> list path.
    assert by_id["evt_fake_0001"]["requested_model"] == "fake-chat"
    assert by_id["evt_fake_0001"]["is_stream"] is True
    assert by_id["evt_fake_0002"]["error"] == "fake upstream rate limited"
    assert by_id["evt_fake_0002"]["has_error"] is True
    assert all(row["has_payload"] is False for row in by_id.values())
    assert all("raw_json" not in row for row in by_id.values())

    detail = client.get(f"/admin/logs/{default_ids[0]}")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["event_id"] == default_ids[0]
    assert body["requested_model"] == "fake-chat"
    assert "raw_json" not in body


def test_fake_adapter_runs_render_apply_and_cleanup(fake_flow) -> None:
    client, engine, factory = fake_flow
    seed_channel(engine, factory)

    applied = client.post("/admin/config/apply", json={"reason": "fake-main-flow"})
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["status"] == "active"
    assert body["adapter_id"] == "fake"
    assert body["reason"] == "fake-main-flow"

    cleanup_adapter = FakeAdapter()
    cleanup_adapter.seed_payload("evt_fake_retention", request_prompt_json="{}")
    counts = cleanup_job(factory, adapter=cleanup_adapter)
    # The fake port is the data-plane half; the system-owned attempts pass still
    # runs in the same job (its own retention tests live in test_attempt_retention).
    assert cleanup_adapter.pruned_retention_days == [30]
    assert counts["request_log_payloads"] == 1
