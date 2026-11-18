"""Read-only incremental usage reader over the agentgateway request_logs SQLite.

The binary owns that database; we only open it read-only and assert the expected
schema first (ADR-001 upgrade gate: schema breakage must fail loudly). E6 fixed
the real shape: table request_logs with 26 columns; the incremental cursor is
the composite (started_at, id) - both lexicographic/numeric safe - never a bare
id. Cache columns (cache_read_input_tokens / cache_creation_input_tokens) are
read raw; billing folds them into input per the conservative lead rule.
USD cost stays untouched: with no modelCatalog AG reports cost=None (E10), so
the control plane prices everything itself.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC
from typing import Any

from l01_core.errors import AppError, ErrorCode
from l02_domain.models import UsageEvent
from l03_adapters.spi import UsageCursor, UsagePage

#: Full request_logs contract from P0 experiment E6 (agentgateway 1.7.0). Any
#: removal breaks ingestion and must fail the upgrade gate; additions are fine.
EXPECTED_REQUEST_LOG_COLUMNS: frozenset[str] = frozenset(
    {
        "id",
        "started_at",
        "completed_at",
        "duration_ms",
        "trace_id",
        "span_id",
        "http_status",
        "error",
        "gen_ai_operation_name",
        "gen_ai_provider_name",
        "gen_ai_request_model",
        "gen_ai_response_model",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cost",
        "agentgateway_user",
        "agentgateway_group",
        "user_agent_name",
        "has_payload",
        "attributes_json",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "reasoning_tokens",
        "time_to_first_token_ms",
        "time_per_output_token_ms",
    }
)

_CURSOR_SEP = "|"


def open_readonly(db_path: str) -> sqlite3.Connection:
    """Open the AG SQLite file strictly read-only (URI mode); missing file is an error."""
    if not os.path.exists(db_path):
        raise AppError(
            ErrorCode.SCHEMA_MISMATCH, f"数据面请求日志不存在: {db_path}", details={"path": db_path}
        )
    uri = "file:" + db_path.replace("\\", "/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def assert_schema(conn: sqlite3.Connection) -> None:
    """Fail with SCHEMA_MISMATCH (and the missing column list) when AG changes shape."""
    rows = conn.execute("PRAGMA table_info(request_logs)").fetchall()
    if not rows:
        raise AppError(
            ErrorCode.SCHEMA_MISMATCH,
            "数据面请求日志缺少 request_logs 表（schema 变更，拒绝拉取）",
            details={"expected": sorted(EXPECTED_REQUEST_LOG_COLUMNS)},
        )
    present = {str(row["name"]) for row in rows}
    missing = sorted(EXPECTED_REQUEST_LOG_COLUMNS - present)
    if missing:
        raise AppError(
            ErrorCode.SCHEMA_MISMATCH,
            "数据面请求日志 schema 断言失败（升级门禁）",
            details={"missing": missing, "present": sorted(present)},
        )


def encode_cursor(started_at: str, event_id: str) -> str:
    """Composite cursor `started_at|id` (E6): never rely on ids alone."""
    return f"{started_at}{_CURSOR_SEP}{event_id}"


def decode_cursor(value: str) -> tuple[str, str] | None:
    """Parse a composite cursor; None when absent or malformed."""
    if not value or _CURSOR_SEP not in value:
        return None
    started_at, _, event_id = value.rpartition(_CURSOR_SEP)
    if not started_at or not event_id:
        return None
    return started_at, event_id


def _started_at_ms(raw: Any) -> int:
    """Parse request_logs.started_at (epoch seconds/ms or ISO-8601) into epoch ms."""
    text = str(raw or "")
    if not text:
        return 0
    if text.isdigit():
        number = int(text)
        return number if number > 10**12 else number * 1000
    try:
        normalized = text.replace("Z", "+00:00")
        return int(float(datetime_from_iso(normalized)) * 1000)
    except ValueError:
        return 0


def datetime_from_iso(text: str) -> float:
    """Import-light ISO parse to epoch seconds (datetime lives inside the helper)."""
    from datetime import datetime

    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone_utc())
    return parsed.timestamp()


def timezone_utc():

    return UTC


def fetch_events(
    conn: sqlite3.Connection, cursor: UsageCursor | None, limit: int = 500
) -> UsagePage:
    """Return request_logs rows strictly after the composite cursor, ascending."""
    assert_schema(conn)
    position = decode_cursor(cursor.value) if cursor is not None else None
    params: list[Any] = []
    where = ""
    if position is not None:
        started_at, event_id = position
        where = "WHERE (started_at > ?) OR (started_at = ? AND id > ?)"
        params.extend([started_at, started_at, event_id])
    params.append(limit)
    rows = conn.execute(
        f"SELECT * FROM request_logs {where} ORDER BY started_at ASC, id ASC LIMIT ?",
        params,
    ).fetchall()
    events = tuple(_row_to_event(row) for row in rows)
    if events:
        last_raw = rows[-1]
        next_cursor = UsageCursor(
            value=encode_cursor(str(last_raw["started_at"] or ""), str(last_raw["id"]))
        )
    else:
        next_cursor = cursor
    return UsagePage(events=events, next_cursor=next_cursor)


def _row_to_event(row: sqlite3.Row) -> UsageEvent:
    keys = row.keys()
    raw = dict(row)
    return UsageEvent(
        event_id=str(row["id"]),
        started_at_ms=_started_at_ms(row["started_at"]),
        completed_at_ms=_started_at_ms(row["completed_at"]) if "completed_at" in keys else 0,
        duration_ms=int(row["duration_ms"] or 0),
        time_to_first_token_ms=int(row["time_to_first_token_ms"] or 0)
        if "time_to_first_token_ms" in keys
        else 0,
        http_status=int(row["http_status"] or 0),
        public_model=str(row["gen_ai_request_model"] or ""),
        upstream_model=str(row["gen_ai_response_model"] or ""),
        provider=str(row["gen_ai_provider_name"] or ""),
        api_key_id=str(row["agentgateway_user"] or "") or None,
        input_tokens=int(row["input_tokens"] or 0),
        output_tokens=int(row["output_tokens"] or 0),
        total_tokens=int(row["total_tokens"] or 0),
        cache_read_tokens=int(row["cache_read_input_tokens"] or 0)
        if "cache_read_input_tokens" in keys
        else 0,
        cache_write_tokens=int(row["cache_creation_input_tokens"] or 0)
        if "cache_creation_input_tokens" in keys
        else 0,
        raw_json=json.dumps(raw, ensure_ascii=False, default=str),
    )


def fetch_request_payload(conn: sqlite3.Connection, event_id: str) -> dict | None:
    """ADR-021: the stored prompt/completion bodies of one request log row.

    Reads AG's `request_log_payloads` (log_id -> request_logs.id); returns None
    when the table does not exist (payload logging never enabled) or the event
    has no payload row. The caller owns connection lifetime and read-only mode.
    """
    table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='request_log_payloads'"
    ).fetchone()
    if table is None:
        return None
    row = conn.execute(
        "SELECT log_id, request_prompt_json, response_completion_json "
        "FROM request_log_payloads WHERE log_id = ?",
        (event_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "event_id": str(row["log_id"]),
        "request_prompt_json": row["request_prompt_json"] or "",
        "response_completion_json": row["response_completion_json"] or "",
    }
