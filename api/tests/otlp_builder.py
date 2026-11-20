"""Hand-built OTLP trace payloads for M5-a tests (standard library only).

Mirrors the E19 export: one server root span plus one client span per upstream
attempt, with AG 1.7's exact attribute keys. Kept outside the test modules so
the decoder unit test and the receiver->DB->API integration test share the same
wire shape.
"""

from __future__ import annotations

import struct

_NANOS_PER_MS = 1_000_000

TRACE_ID = "12379ecdbe383b2adf77ac4b61fa6898"
ROOT_SPAN_ID = "3614b578e3f41fbb"
CLIENT_1 = "1443cc3f68133e52"
CLIENT_2 = "0c271b41cc5f454c"
CLIENT_3 = "6ad1cd338ac8b7c3"
CLIENT_IDS = (CLIENT_1, CLIENT_2, CLIENT_3, "7b00d40c9e1f2a36")
BASE_NS = 1_800_000_000_000 * _NANOS_PER_MS


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def key(field: int, wire: int) -> bytes:
    return varint((field << 3) | wire)


def varint_field(field: int, value: int) -> bytes:
    return key(field, 0) + varint(value)


def bytes_field(field: int, value: bytes) -> bytes:
    return key(field, 2) + varint(len(value)) + value


def fixed64_field(field: int, value: int) -> bytes:
    return key(field, 1) + value.to_bytes(8, "little")


def string_value(value: str) -> bytes:
    return bytes_field(1, value.encode())


def int_value(value: int) -> bytes:
    return varint_field(3, value if value >= 0 else (1 << 64) + value)


def bool_value(value: bool) -> bytes:
    return varint_field(2, 1 if value else 0)


def double_value(value: float) -> bytes:
    return key(4, 1) + struct.pack("<d", value)


def attr(name: str, any_value: bytes) -> bytes:
    return bytes_field(1, name.encode()) + bytes_field(2, any_value)


def span(
    *,
    trace_id: str,
    span_id: str,
    parent_span_id: str = "",
    kind: int,
    start_ns: int,
    end_ns: int,
    attributes: tuple[bytes, ...] = (),
) -> bytes:
    payload = bytearray()
    payload += bytes_field(1, bytes.fromhex(trace_id))
    payload += bytes_field(2, bytes.fromhex(span_id))
    if parent_span_id:
        payload += bytes_field(4, bytes.fromhex(parent_span_id))
    payload += bytes_field(5, b"POST")
    payload += varint_field(6, kind)
    payload += fixed64_field(7, start_ns)
    payload += fixed64_field(8, end_ns)
    for attribute in attributes:
        payload += bytes_field(9, attribute)
    return bytes(payload)


def export(*spans: bytes) -> bytes:
    scope_spans = b"".join(bytes_field(2, item) for item in spans)
    resource_spans = bytes_field(2, scope_spans)
    return bytes_field(1, resource_spans)


def e19_export(
    trace_id: str = TRACE_ID,
    *,
    root_span_id: str = ROOT_SPAN_ID,
    attempts: tuple[tuple[str, int, str], ...] = (
        ("/fail500/chat/completions", 500, "500"),
        ("/fail500/chat/completions", 500, "500"),
        ("/ok/chat/completions", 200, ""),
    ),
) -> bytes:
    """The E19 tree: root status 200, retry.attempt = len(attempts)-1."""
    root = span(
        trace_id=trace_id,
        span_id=root_span_id,
        kind=2,
        start_ns=BASE_NS,
        end_ns=BASE_NS + 20 * _NANOS_PER_MS,
        attributes=(
            attr("http.response.status_code", int_value(200)),
            attr("http.request.method", string_value("POST")),
            attr("retry.attempt", int_value(max(0, len(attempts) - 1))),
            attr("duration", string_value("20ms")),
            attr("gen_ai.request.model", string_value("mock-model")),
            attr("gen_ai.usage.input_tokens", int_value(5)),
            attr("gen_ai.request.stream", bool_value(True)),
            attr("gen_ai.request.temperature", double_value(0.2)),
            attr("client.address", string_value("127.0.0.1")),
            attr("agentgateway.outbound.kind", string_value("Primary")),
        ),
    )
    clients = []
    for index, (path, status, error_type) in enumerate(attempts):
        start = BASE_NS + (1 + index * 4) * _NANOS_PER_MS
        attrs = [
            attr("http.path", string_value(path)),
            attr("http.status", int_value(status)),
            attr("agentgateway.outbound.subtype", string_value("Llm")),
        ]
        if error_type:
            attrs.append(attr("error.type", string_value(error_type)))
        clients.append(
            span(
                trace_id=trace_id,
                span_id=CLIENT_IDS[index],
                parent_span_id=root_span_id,
                kind=3,
                start_ns=start,
                end_ns=start + 2 * _NANOS_PER_MS,
                attributes=tuple(attrs),
            )
        )
    return export(root, *clients)
