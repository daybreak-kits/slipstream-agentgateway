"""M5-a OTLP decoder: hand-built protobuf bytes round-trip (stdlib only).

The encoder in tests/otlp_builder.py writes the exact OTLP trace.proto field
numbers AG 1.7 emits; the decoder must recover the E19 span tree (1 server root
+ N client attempts), normalize ids/times/status/error/retry, and drop every
attribute outside the routing-chain whitelist.
"""

from __future__ import annotations

import pytest
from tests.otlp_builder import (
    BASE_NS,
    CLIENT_1,
    CLIENT_2,
    CLIENT_3,
    ROOT_SPAN_ID,
    TRACE_ID,
    e19_export,
    varint_field,
)

from l03_adapters.agentgateway.otel import (
    OtlpDecodeError,
    decode_trace_export,
)


def test_decodes_the_e19_span_tree() -> None:
    spans = decode_trace_export(e19_export())
    assert [span.span_id for span in spans] == [
        ROOT_SPAN_ID,
        CLIENT_1,
        CLIENT_2,
        CLIENT_3,
    ]
    assert {span.trace_id for span in spans} == {TRACE_ID}
    root = spans[0]
    assert root.kind == "server"
    assert root.parent_span_id == ""
    assert root.start_ms == 1_800_000_000_000
    assert root.duration_ms == 20
    assert root.http_status == 200
    assert root.retry_attempt == 2
    assert root.http_path == ""
    assert root.error_type == ""
    clients = spans[1:]
    assert [client.kind for client in clients] == ["client", "client", "client"]
    assert [client.parent_span_id for client in clients] == [ROOT_SPAN_ID] * 3
    assert [client.start_ms for client in clients] == [
        1_800_000_000_001,
        1_800_000_000_005,
        1_800_000_000_009,
    ]
    assert [client.http_path for client in clients] == [
        "/fail500/chat/completions",
        "/fail500/chat/completions",
        "/ok/chat/completions",
    ]
    assert [client.http_status for client in clients] == [500, 500, 200]
    assert [client.error_type for client in clients] == ["500", "500", ""]
    assert [client.duration_ms for client in clients] == [2, 2, 2]


def test_attribute_whitelist_keeps_http_genai_and_drops_the_rest() -> None:
    root = decode_trace_export(e19_export())[0]
    assert root.attributes["http.response.status_code"] == 200
    assert root.attributes["retry.attempt"] == 2
    assert root.attributes["duration"] == "20ms"
    assert root.attributes["gen_ai.request.model"] == "mock-model"
    assert root.attributes["gen_ai.usage.input_tokens"] == 5
    assert root.attributes["gen_ai.request.stream"] is True
    assert root.attributes["gen_ai.request.temperature"] == pytest.approx(0.2)
    assert "http.request.method" not in root.attributes
    assert "client.address" not in root.attributes
    assert "agentgateway.outbound.kind" not in root.attributes
    client = decode_trace_export(e19_export())[1]
    assert client.attributes == {
        "http.path": "/fail500/chat/completions",
        "http.status": 500,
        "error.type": "500",
    }


def test_empty_body_is_a_valid_empty_export() -> None:
    assert decode_trace_export(b"") == ()


def test_truncated_payload_raises_decode_error() -> None:
    payload = e19_export()
    with pytest.raises(OtlpDecodeError):
        decode_trace_export(payload[:-5])


def test_unknown_top_level_fields_are_skipped() -> None:
    payload = varint_field(9, 1) + e19_export()
    assert len(decode_trace_export(payload)) == 4


def test_times_are_milliseconds_not_nanoseconds() -> None:
    spans = decode_trace_export(e19_export())
    assert spans[0].start_ms == BASE_NS // 1_000_000
    assert spans[0].end_ms == (BASE_NS + 20 * 1_000_000) // 1_000_000
