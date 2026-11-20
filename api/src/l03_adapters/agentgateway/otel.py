"""Minimal stdlib OTLP/HTTP trace decoder for agentgateway telemetry (E19).

Ported from ``ops/experiments/ag-lab/otel_capture.py`` (the E19-verified,
dependency-free wire-format reader) with the experiment shell removed: no HTTP
capture server, no file output, no logs layout. Only OTLP traces at
``POST /v1/traces`` are decoded, and the parser walks the exact
ExportTraceServiceRequest -> ResourceSpans -> ScopeSpans -> Span path instead of
recursively guessing every length-delimited field. That keeps parsing light at
the measured >= 4 spans per gateway request.

Attribute policy: only the keys the routing-chain UI needs are kept; everything
else is dropped before it ever reaches the database. The whitelist is
``http.path``, ``http.status``, ``http.response.status_code``, ``error.type``,
``retry.attempt``, ``duration``, ``start`` and every ``gen_ai.*`` key. Start/end
times are primarily Span scalar fields; the ``start``/``duration`` attributes
are kept because AG also reports them on the root span.
"""

from __future__ import annotations

import struct
from collections.abc import Iterator
from typing import Any

from l02_domain.models import TraceSpanRecord

#: OTLP SpanKind: 0 unspecified, 1 internal, 2 server, 3 client, 4 producer,
#: 5 consumer. AG 1.7 emits server roots and one client span per upstream try.
SPAN_KINDS = {
    0: "unspecified",
    1: "internal",
    2: "server",
    3: "client",
    4: "producer",
    5: "consumer",
}

#: Attribute keys (besides the ``gen_ai.*`` prefix) worth persisting.
ATTRIBUTE_WHITELIST: frozenset[str] = frozenset(
    {
        "http.path",
        "http.status",
        # AG's server root reports its final status under this OTel key.
        "http.response.status_code",
        "error.type",
        "retry.attempt",
        "duration",
        "start",
    }
)
ATTRIBUTE_PREFIXES: tuple[str, ...] = ("gen_ai.",)

_NANOS_PER_MS = 1_000_000


class OtlpDecodeError(ValueError):
    """The body is not a well-formed OTLP ExportTraceServiceRequest."""


def _read_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise OtlpDecodeError("varint truncated")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7
        if shift >= 70:
            raise OtlpDecodeError("varint too long")


def _iter_fields(data: bytes) -> Iterator[tuple[int, int, int | bytes]]:
    """Yield (field_number, wire_type, value); bytes for wire 1/2/5, int for 0."""
    pos = 0
    size = len(data)
    while pos < size:
        key, pos = _read_varint(data, pos)
        field, wire = key >> 3, key & 7
        if field == 0:
            raise OtlpDecodeError("protobuf field number 0")
        if wire == 0:
            value, pos = _read_varint(data, pos)
        elif wire == 1:
            end = pos + 8
            if end > size:
                raise OtlpDecodeError("fixed64 truncated")
            value = data[pos:end]
            pos = end
        elif wire == 2:
            length, pos = _read_varint(data, pos)
            end = pos + length
            if end > size:
                raise OtlpDecodeError("length-delimited field truncated")
            value = data[pos:end]
            pos = end
        elif wire == 5:
            end = pos + 4
            if end > size:
                raise OtlpDecodeError("fixed32 truncated")
            value = data[pos:end]
            pos = end
        else:
            # Protobuf groups (3/4) never appear in OTLP/AG telemetry.
            raise OtlpDecodeError(f"unsupported wire type {wire}")
        yield field, wire, value


def _text(raw: bytes) -> str:
    return raw.decode("utf-8", "replace")


def _signed_int64(value: int) -> int:
    """Interpret a protobuf int64 varint (two's complement for negatives)."""
    if value >= 1 << 63:
        return value - (1 << 64)
    return value


def _decode_any_value(raw: bytes) -> Any:
    """Decode the oneof in opentelemetry.proto.common.v1.AnyValue."""
    for field, wire, value in _iter_fields(raw):
        if field == 1 and wire == 2:
            return _text(value)
        if field == 2 and wire == 0:
            return bool(value)
        if field == 3 and wire == 0:
            return _signed_int64(value)
        if field == 4 and wire == 1:
            return struct.unpack("<d", value)[0]
        if field == 5 and wire == 2:
            return [
                _decode_any_value(item)
                for item_field, item_wire, item in _iter_fields(value)
                if item_field == 1 and item_wire == 2
            ]
        if field == 6 and wire == 2:
            return _decode_key_value_list(value)
        if field == 7 and wire == 2:
            return value.hex()
    return None


def _decode_key_value(raw: bytes) -> tuple[str, Any]:
    key = ""
    value: Any = None
    for field, wire, item in _iter_fields(raw):
        if field == 1 and wire == 2:
            key = _text(item)
        elif field == 2 and wire == 2:
            value = _decode_any_value(item)
    return key, value


def _decode_key_value_list(raw: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field, wire, item in _iter_fields(raw):
        if field == 1 and wire == 2:
            key, value = _decode_key_value(item)
            if key:
                result[key] = value
    return result


def _keep_attribute(key: str) -> bool:
    return key in ATTRIBUTE_WHITELIST or key.startswith(ATTRIBUTE_PREFIXES)


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _decode_span(raw: bytes) -> TraceSpanRecord:
    trace_id = ""
    span_id = ""
    parent_span_id = ""
    kind = ""
    start_unix_nano = 0
    end_unix_nano = 0
    attributes: dict[str, Any] = {}
    for field, wire, value in _iter_fields(raw):
        if field == 1 and wire == 2:
            trace_id = value.hex()
        elif field == 2 and wire == 2:
            span_id = value.hex()
        elif field == 4 and wire == 2:
            parent_span_id = value.hex()
        elif field == 6 and wire == 0:
            kind = SPAN_KINDS.get(int(value), "unspecified")
        elif field == 7 and wire == 1:
            start_unix_nano = int.from_bytes(value, "little")
        elif field == 8 and wire == 1:
            end_unix_nano = int.from_bytes(value, "little")
        elif field == 9 and wire == 2:
            key, attr_value = _decode_key_value(value)
            if key and _keep_attribute(key):
                attributes[key] = attr_value
    status_value = attributes.get("http.status")
    if status_value is None:
        status_value = attributes.get("http.response.status_code")
    start_ms = start_unix_nano // _NANOS_PER_MS
    end_ms = end_unix_nano // _NANOS_PER_MS
    delta_ns = end_unix_nano - start_unix_nano
    duration_ms = int(round(delta_ns / _NANOS_PER_MS)) if delta_ns > 0 else 0
    return TraceSpanRecord(
        trace_id=trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        kind=kind,
        http_path=_as_text(attributes.get("http.path")),
        http_status=_as_int(status_value),
        error_type=_as_text(attributes.get("error.type")),
        retry_attempt=_as_int(attributes.get("retry.attempt")),
        start_ms=start_ms,
        end_ms=end_ms,
        duration_ms=duration_ms,
        attributes=attributes,
    )


def decode_trace_export(body: bytes) -> tuple[TraceSpanRecord, ...]:
    """Decode one ExportTraceServiceRequest body into normalized spans.

    The field numbers follow opentelemetry-proto v1.x:

    * ExportTraceServiceRequest.resource_spans = 1
    * ResourceSpans.scope_spans = 2
    * ScopeSpans.spans = 2
    * Span.{trace_id=1, span_id=2, parent_span_id=4, kind=6,
      start=7, end=8, attributes=9}

    Unknown fields are skipped; malformed/truncated protobuf raises
    :class:`OtlpDecodeError` so the receiver can answer 400 instead of storing a
    half-decoded tree.
    """
    try:
        spans: list[TraceSpanRecord] = []
        for field, wire, resource_spans in _iter_fields(body):
            if field != 1 or wire != 2:
                continue
            for scope_field, scope_wire, scope_spans in _iter_fields(resource_spans):
                if scope_field != 2 or scope_wire != 2:
                    continue
                for span_field, span_wire, span in _iter_fields(scope_spans):
                    if span_field == 2 and span_wire == 2:
                        spans.append(_decode_span(span))
        return tuple(spans)
    except OtlpDecodeError:
        raise
    except (IndexError, struct.error, UnicodeDecodeError, ValueError) as exc:
        raise OtlpDecodeError(str(exc)) from exc


__all__ = [
    "ATTRIBUTE_PREFIXES",
    "ATTRIBUTE_WHITELIST",
    "OtlpDecodeError",
    "SPAN_KINDS",
    "decode_trace_export",
]
