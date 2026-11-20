"""Trace span ingestion, query assembly and retention (M5-a).

The OTLP receiver (l06) decodes AG telemetry in l03 and hands layer-neutral
:class:`TraceSpanRecord` objects to this service; storage is the control-plane
``trace_spans`` table. Queries rebuild the routing chain from the stored tree:

* spans are listed by ``(start_ms, span_id)``;
* attempts are the client spans in the same start order, numbered from 1 (E19:
  AG carries no explicit attempt ordinal, time order matches the mock hit
  matrix);
* request logs join on ``trace_id`` (the request_logs column filled by AG when
  tracing is enabled).

Ingestion is idempotent by ``(trace_id, span_id)`` so an exporter retry cannot
duplicate a span tree. Retention deletes only expired ``trace_spans`` rows;
request logs, usage events and the ledger are never touched here.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from l01_core.timeutil import now_ms
from l02_domain.models import TraceSpanRecord
from l04_repo.orm import TraceSpanORM

#: Only these span kinds carry routing-chain meaning in AG 1.7 telemetry.
STORED_SPAN_KINDS: frozenset[str] = frozenset({"server", "client"})

_DAY_MS = 86_400_000
_IN_CHUNK = 500


def _chunked(values: list[str]) -> Iterable[list[str]]:
    for start in range(0, len(values), _IN_CHUNK):
        yield values[start : start + _IN_CHUNK]


def _attributes_json(attributes: dict[str, Any]) -> str:
    return json.dumps(
        attributes, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def _row_values(span: TraceSpanRecord, ingested_at_ms: int) -> dict[str, Any]:
    return {
        "trace_id": span.trace_id,
        "span_id": span.span_id,
        "parent_span_id": span.parent_span_id,
        "kind": span.kind,
        "http_path": span.http_path,
        "http_status": span.http_status or 0,
        "error_type": span.error_type,
        "retry_attempt": span.retry_attempt or 0,
        "start_ms": span.start_ms,
        "end_ms": span.end_ms,
        "duration_ms": span.duration_ms,
        "attributes_json": _attributes_json(span.attributes),
        "ingested_at_ms": ingested_at_ms,
    }


def ingest_spans(session: Session, spans: Iterable[TraceSpanRecord]) -> int:
    """Persist unseen server/client spans; returns how many rows were added.

    The caller owns the transaction (the receiver commits once per OTLP export).
    Empty ids and non-server/client spans are skipped: the table contract is the
    routing chain, not a general-purpose span archive.
    """
    prepared: list[dict[str, Any]] = []
    for span in spans:
        if span.kind not in STORED_SPAN_KINDS:
            continue
        if not span.trace_id or not span.span_id:
            continue
        prepared.append(_row_values(span, 0))
    if not prepared:
        return 0
    span_ids = [row["span_id"] for row in prepared]
    existing: set[tuple[str, str]] = set()
    for chunk in _chunked(span_ids):
        existing.update(
            (trace_id, span_id)
            for trace_id, span_id in session.execute(
                select(TraceSpanORM.trace_id, TraceSpanORM.span_id).where(
                    TraceSpanORM.span_id.in_(chunk)
                )
            ).all()
        )
    stamp = now_ms()
    seen = set(existing)
    added = 0
    for row in prepared:
        key = (row["trace_id"], row["span_id"])
        if key in seen:
            continue
        seen.add(key)
        row["ingested_at_ms"] = stamp
        session.add(TraceSpanORM(**row))
        added += 1
    session.flush()
    return added


def _load_attributes(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _span_dict(row: TraceSpanORM) -> dict[str, Any]:
    return {
        "trace_id": row.trace_id,
        "span_id": row.span_id,
        "parent_span_id": row.parent_span_id or "",
        "kind": row.kind,
        "http_path": row.http_path or "",
        "http_status": row.http_status or None,
        "error_type": row.error_type or "",
        "retry_attempt": row.retry_attempt or None,
        "start_ms": row.start_ms,
        "end_ms": row.end_ms,
        "duration_ms": row.duration_ms,
        "attributes": _load_attributes(row.attributes_json),
    }


def get_trace_detail(session: Session, trace_id: str) -> dict[str, Any] | None:
    """The routing chain for one trace, or None when no span was stored."""
    rows = list(
        session.scalars(
            select(TraceSpanORM)
            .where(TraceSpanORM.trace_id == trace_id)
            .order_by(TraceSpanORM.start_ms, TraceSpanORM.span_id)
        ).all()
    )
    if not rows:
        return None
    attempts = []
    for index, row in enumerate((row for row in rows if row.kind == "client"), start=1):
        attempts.append(
            {
                "attempt": index,
                "span_id": row.span_id,
                "http_path": row.http_path or "",
                "http_status": row.http_status or None,
                "error_type": row.error_type or "",
                "duration_ms": row.duration_ms,
                "start_ms": row.start_ms,
            }
        )
    return {
        "trace_id": trace_id,
        "spans": [_span_dict(row) for row in rows],
        "attempts": attempts,
    }


def _day_start_ms(instant_ms: int) -> int:
    """UTC midnight: epoch milliseconds floor to the 86_400_000 ms day bucket."""
    return (instant_ms // _DAY_MS) * _DAY_MS


def cleanup_expired_spans(
    session: Session, retention_days: int, *, now_ms_value: int | None = None
) -> int:
    """Delete trace spans older than the daily retention cutoff; returns rows removed.

    Retention is day-granular exactly like the request-log cleanup: spans whose
    start day is older than the UTC day ``retention_days`` ago are removed. Only
    ``trace_spans`` is targeted - the same operator setting must never prune
    usage facts or money rows.
    """
    days = max(1, int(retention_days))
    anchor = now_ms() if now_ms_value is None else int(now_ms_value)
    cutoff_ms = _day_start_ms(anchor - days * _DAY_MS)
    result = session.execute(
        delete(TraceSpanORM).where(TraceSpanORM.start_ms < cutoff_ms)
    )
    deleted = max(result.rowcount or 0, 0)
    session.flush()
    return deleted


__all__ = [
    "STORED_SPAN_KINDS",
    "cleanup_expired_spans",
    "get_trace_detail",
    "ingest_spans",
]
