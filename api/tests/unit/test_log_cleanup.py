"""ADR-021 retention: only the data-plane request log is pruned.

The cleanup helper is the one write path over agentgateway's SQLite DB; these
tests pin the boundary: expired rows disappear, rows inside the window stay,
and a control-plane ledger database is never touched.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta

from l01_core.settings import Settings
from l03_adapters.agentgateway.usage import cleanup_expired_logs
from l07_jobs.log_cleanup import cleanup_job

#: Same request-log shape AG 1.7 creates (subset used by the cleanup predicates).
_AG_SCHEMA = """
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
"""


def _make_ag_db(path, rows):
    connection = sqlite3.connect(path)
    try:
        connection.executescript(_AG_SCHEMA)
        connection.executemany(
            "INSERT INTO request_logs (id, started_at) VALUES (?, ?)", rows
        )
        connection.executemany(
            "INSERT INTO request_log_payloads (log_id) VALUES (?)",
            [(row[0],) for row in rows],
        )
        connection.commit()
    finally:
        connection.close()
    return path


def _ids(path, table):
    column = "id" if table == "request_logs" else "log_id"
    connection = sqlite3.connect(path)
    try:
        return [
            row[0]
            for row in connection.execute("SELECT " + column + " FROM " + table)
        ]
    finally:
        connection.close()


def test_expired_rows_deleted_and_rows_inside_window_kept(tmp_path):
    db = _make_ag_db(
        tmp_path / "ag-data.db",
        [
            ("evt_old", "2020-01-01T00:00:00+00:00"),
            ("evt_recent", (datetime.now(UTC) - timedelta(days=5)).isoformat()),
            ("evt_new", datetime.now(UTC).isoformat()),
        ],
    )
    counts = cleanup_expired_logs(str(db), 30)
    assert counts == {"request_logs": 1, "request_log_payloads": 1}
    assert sorted(_ids(db, "request_logs")) == ["evt_new", "evt_recent"]
    assert sorted(_ids(db, "request_log_payloads")) == ["evt_new", "evt_recent"]


def test_control_plane_ledger_database_is_never_touched(tmp_path):
    ag_db = _make_ag_db(
        tmp_path / "ag-data.db", [("evt_old", "2020-01-01T00:00:00+00:00")]
    )
    ledger_db = tmp_path / "slipstream.db"
    connection = sqlite3.connect(ledger_db)
    try:
        connection.executescript(
            """
            CREATE TABLE ledger_entries (id TEXT PRIMARY KEY);
            CREATE TABLE gateway_usage_events (event_id TEXT PRIMARY KEY);
            INSERT INTO ledger_entries VALUES ('led_1');
            INSERT INTO gateway_usage_events VALUES ('evt_1');
            """
        )
        connection.commit()
    finally:
        connection.close()

    cleanup_expired_logs(str(ag_db), 30)

    connection = sqlite3.connect(ledger_db)
    try:
        assert connection.execute("SELECT COUNT(*) FROM ledger_entries").fetchone()[0] == 1
        assert (
            connection.execute("SELECT COUNT(*) FROM gateway_usage_events").fetchone()[0]
            == 1
        )
    finally:
        connection.close()


def test_missing_database_is_a_noop(tmp_path):
    assert cleanup_expired_logs(str(tmp_path / "nope.db"), 30) == {
        "request_logs": 0,
        "request_log_payloads": 0,
    }


def test_cleanup_job_default_path_prunes_through_the_adapter(
    engine_and_sessionmaker, tmp_path
):
    """W6 t02: the production default (no injected adapter) prunes the same way.

    The job resolves the configured adapter itself and prunes via the SPI port;
    expired request-log rows and their payload rows go, rows inside the window
    and the control-plane attempt/usage facts stay.
    """
    _, factory = engine_and_sessionmaker
    ag_dir = tmp_path / "ag-config"
    ag_dir.mkdir(parents=True, exist_ok=True)
    db = _make_ag_db(
        ag_dir / "ag-data.db",
        [
            ("evt_old", "2020-01-01T00:00:00+00:00"),
            ("evt_new", datetime.now(UTC).isoformat()),
        ],
    )

    counts = cleanup_job(factory, Settings(ag_config_dir=str(ag_dir)))

    assert counts == {
        "request_logs": 1,
        "request_log_payloads": 1,
        "request_attempts": 0,
    }
    assert _ids(db, "request_logs") == ["evt_new"]
