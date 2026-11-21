"""Usage fact normalization lives in the adapter (W6 ticket 05, ADR-029).

The AG request log stores client-facing facts in wire columns and wire
attributes (attributes_json); only the adapter may decode them. The system
consumes one neutral UsageEvent: requested model, streaming verdict, error
text, payload flag and the correlation key. Malformed or old rows degrade to
neutral defaults — the system API never re-parses raw attributes.
"""

from __future__ import annotations

import json
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


def _conn_with(*rows: dict) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_AG_SCHEMA)
        for row in rows:
            columns = ", ".join(row)
            placeholders = ", ".join("?" for _ in row)
            conn.execute(
                f"INSERT INTO request_logs ({columns}) VALUES ({placeholders})",
                tuple(row.values()),
            )
        return conn
    except BaseException:
        conn.close()
        raise


def _fetch_one(row: dict):
    conn = _conn_with(row)
    try:
        return fetch_events(conn, None).events[0]
    finally:
        conn.close()


def test_usage_reader_normalizes_correlation_key_from_trace_id() -> None:
    event = _fetch_one(
        {
            "id": "evt_1",
            "started_at": "2026-11-19T16:33:34.791243+00:00",
            "trace_id": "12379ecdbe383b2adf77ac4b61fa6898",
            "http_status": 200,
        }
    )
    # The neutral join key survives; the wire column name stays adapter-internal.
    assert event.correlation_key == "12379ecdbe383b2adf77ac4b61fa6898"
    assert '"trace_id": "12379ecdbe383b2adf77ac4b61fa6898"' in event.raw_json


def test_usage_reader_decodes_requested_model_from_wire_attributes() -> None:
    attrs = {"agw.ai.original_model": "pub-a", "gen_ai.request.stream": True}
    event = _fetch_one(
        {
            "id": "evt_2",
            "started_at": "2026-11-19T16:33:34.791243+00:00",
            "http_status": 200,
            "gen_ai_request_model": "up-a",
            "attributes_json": json.dumps(attrs),
        }
    )
    assert event.requested_model == "pub-a"
    # The recorded model keeps its ledger meaning (final upstream model).
    assert event.public_model == "up-a"


def test_usage_reader_decodes_stream_flag_from_wire_attributes() -> None:
    event = _fetch_one(
        {
            "id": "evt_3",
            "started_at": "2026-11-19T16:33:34.791243+00:00",
            "http_status": 200,
            "attributes_json": json.dumps({"gen_ai.request.stream": True}),
        }
    )
    assert event.is_stream is True


def test_usage_reader_leaves_stream_unverdicted_without_an_explicit_signal() -> None:
    # Mixed-form rows without any stream attribute: the system falls back to its
    # own TTFT rule, so the adapter must NOT invent a verdict here.
    event = _fetch_one(
        {
            "id": "evt_4",
            "started_at": "2026-11-19T16:33:34.791243+00:00",
            "http_status": 200,
            "time_to_first_token_ms": 400,
        }
    )
    assert event.is_stream is None


def test_usage_reader_normalizes_error_and_payload_flag() -> None:
    event = _fetch_one(
        {
            "id": "evt_5",
            "started_at": "2026-11-19T16:33:34.791243+00:00",
            "http_status": 429,
            "error": "upstream rate limited",
            "has_payload": 1,
        }
    )
    assert event.error == "upstream rate limited"
    assert event.has_payload is True


def test_usage_reader_degrades_malformed_wire_attributes_to_neutral_defaults() -> None:
    stamp = "2026-11-19T16:33:34.791243+00:00"
    broken = [
        # attributes_json that is not JSON at all
        {"id": "evt_bad", "started_at": stamp, "attributes_json": "{not json"},
        # attributes_json that parses to a non-object
        {"id": "evt_arr", "started_at": stamp, "attributes_json": "[1, 2]"},
        # requested model value that is not a string
        {
            "id": "evt_num",
            "started_at": stamp,
            "attributes_json": json.dumps({"agw.ai.original_model": 7}),
        },
        # old full-form row: no attributes content at all
        {"id": "evt_old", "started_at": stamp},
    ]
    for row in broken:
        event = _fetch_one(row)
        assert event.requested_model == "", row["id"]
        assert event.is_stream is None, row["id"]
        assert event.error == "", row["id"]
        assert event.has_payload is False, row["id"]
