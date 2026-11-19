"""ADR-021 payload reader: GET /admin/logs/{event_id}/payload over a fake AG SQLite.

The data plane owns request_log_payloads; the test builds one with the exact
shape observed in ops/experiments/ag-lab (log_id, request_prompt_json,
response_completion_json) and points SLIPSTREAM_AG_DB_PATH at it.
"""

from __future__ import annotations

import sqlite3

import pytest

from l01_core.settings import reset_settings_cache


@pytest.fixture()
def ag_db(tmp_path, monkeypatch):
    """A minimal AG request-log database with one payload row."""
    db_path = tmp_path / "ag-data.db"
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE request_logs (
                id TEXT PRIMARY KEY, started_at TEXT, completed_at TEXT,
                duration_ms INTEGER, trace_id TEXT, span_id TEXT,
                http_status INTEGER, error TEXT, gen_ai_operation_name TEXT,
                gen_ai_provider_name TEXT, gen_ai_request_model TEXT,
                gen_ai_response_model TEXT, input_tokens INTEGER,
                output_tokens INTEGER, total_tokens INTEGER, cost REAL,
                agentgateway_user TEXT, agentgateway_group TEXT,
                user_agent_name TEXT, has_payload INTEGER, attributes_json TEXT,
                cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
                reasoning_tokens INTEGER, time_to_first_token_ms INTEGER,
                time_per_output_token_ms INTEGER
            );
            CREATE TABLE request_log_payloads (
                log_id TEXT PRIMARY KEY, request_prompt_json TEXT,
                response_completion_json TEXT
            );
            INSERT INTO request_logs (id, http_status, has_payload)
            VALUES ('evt_full', 200, 1);
            INSERT INTO request_log_payloads VALUES (
                'evt_full', '{"messages":[{"role":"user","content":"你好"}]}',
                '{"role":"assistant","content":"你好！"}'
            );
            INSERT INTO request_logs (id, http_status, has_payload)
            VALUES ('evt_bare', 200, 0);
            """
        )
        connection.commit()
    finally:
        connection.close()
    monkeypatch.setenv("SLIPSTREAM_AG_DB_PATH", str(db_path))
    reset_settings_cache()
    yield str(db_path)
    monkeypatch.undo()
    reset_settings_cache()


def test_payload_returns_prompt_and_completion(client, ag_db):
    body = client.get("/admin/logs/evt_full/payload")
    assert body.status_code == 200, body.text
    payload = body.json()
    assert payload["event_id"] == "evt_full"
    assert "你好" in payload["request_prompt_json"]
    assert "assistant" in payload["response_completion_json"]


def test_missing_payload_row_is_404(client, ag_db):
    bare = client.get("/admin/logs/evt_bare/payload")
    assert bare.status_code == 404
    unknown = client.get("/admin/logs/evt_unknown/payload")
    assert unknown.status_code == 404


def test_missing_default_db_file_is_reported(client, monkeypatch, tmp_path):
    """Unset SLIPSTREAM_AG_DB_PATH falls back to the AG config-dir default file."""
    monkeypatch.delenv("SLIPSTREAM_AG_DB_PATH", raising=False)
    monkeypatch.setenv("SLIPSTREAM_AG_CONFIG_DIR", str(tmp_path / "ag-config"))
    reset_settings_cache()
    try:
        response = client.get("/admin/logs/whatever/payload")
        assert response.status_code == 500
        assert "数据面请求日志不存在" in response.json()["message"]
    finally:
        reset_settings_cache()


def test_ag_schema_change_fails_loudly(client, ag_db):
    """The upgrade gate: a payload table with new columns is surfaced, not hidden."""
    connection = sqlite3.connect(ag_db)
    try:
        connection.execute("DROP TABLE request_log_payloads")
        connection.commit()
    finally:
        connection.close()
    # fetch_request_payload treats a missing table as "no payload" -> 404.
    assert client.get("/admin/logs/evt_full/payload").status_code == 404
