"""M5-a: request_logs.trace_id survives the AG usage reader.

AG 1.7 fills trace_id/span_id when frontendPolicies.tracing is on (E19). The
reader used to drop trace_id; ingestion now persists it as the join key to the
span tree, so the row mapper must carry it through.
"""

from __future__ import annotations

import sqlite3

from l03_adapters.agentgateway.usage import fetch_events

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
"""


def test_usage_reader_carries_trace_id_and_span_id_from_request_logs() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_AG_SCHEMA)
        conn.execute(
            "INSERT INTO request_logs (id, started_at, trace_id, span_id, http_status) "
            "VALUES ('evt_1', '2026-11-19T16:33:34.791243+00:00', "
            "'12379ecdbe383b2adf77ac4b61fa6898', '3614b578e3f41fbb', 200)"
        )
        page = fetch_events(conn, None)
    finally:
        conn.close()
    assert len(page.events) == 1
    event = page.events[0]
    assert event.trace_id == "12379ecdbe383b2adf77ac4b61fa6898"
    assert '"trace_id": "12379ecdbe383b2adf77ac4b61fa6898"' in event.raw_json
