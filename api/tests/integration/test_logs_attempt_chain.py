"""Ticket 04：日志请求尝试链——批量字段、一页一次聚合查询与行级错误摘要。

只从 HTTP API seam 断言控制台真正消费的形状：列表行的 attempts_count /
has_attempts / error，以及一页里 request_attempts 只被聚合查询一次。
请求尝试由适配器归一化后写入同一个 request_attempts 表（ADR-028），这里用
record_attempts 写入真实事实，不做内部实现模拟。
"""

from __future__ import annotations

import json

from sqlalchemy import event

from l02_domain.models import RequestAttempt, UsageEvent
from l05_service.attempts import record_attempts
from l05_service.usage_ingest import ingest_usage_events


def _attempt(
    key: str,
    no: int,
    *,
    status: int | None,
    outcome: str,
    error_type: str = "",
    error_message: str = "",
    upstream: str = "ups_test",
    model: str = "glm-5.3",
) -> RequestAttempt:
    return RequestAttempt(
        correlation_key=key,
        attempt_no=no,
        upstream_ref=upstream,
        model=model,
        status_code=status,
        error_type=error_type,
        error_message=error_message,
        started_at_ms=1_800_000_000_000 + no * 10,
        duration_ms=5,
        outcome=outcome,
        adapter_id="agentgateway",
    )


def _seed(factory, events: list[UsageEvent], attempts: list[RequestAttempt]) -> None:
    with factory() as session:
        assert ingest_usage_events(session, events) == len(events)
        assert record_attempts(session, attempts) == len(attempts)
        session.commit()


def _event(
    event_id: str, *, status: int, trace_id: str = "", raw: dict | None = None
) -> UsageEvent:
    return UsageEvent(
        event_id=event_id,
        started_at_ms=1_800_000_000_000,
        duration_ms=20,
        http_status=status,
        public_model="flagship",
        upstream_model="glm-5.3",
        provider="testv",
        trace_id=trace_id,
        raw_json=json.dumps(raw or {"has_payload": False}),
    )


def _items(client) -> dict[str, dict]:
    response = client.get("/admin/logs?page_size=50")
    assert response.status_code == 200, response.text
    return {item["event_id"]: item for item in response.json()["items"]}


def test_row_error_summary_is_backfilled_from_the_last_failed_attempt(
    client, engine_and_sessionmaker
):
    """上游 5xx 且 attempts 可用：行级 error 用最后一次失败尝试补齐。

    适配器把 error.type 归一化成状态码字符串时，摘要不重复成
    「upstream 502: 502」，只保留 upstream 状态头。
    """
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_retry_failed", status=502, trace_id="tr_failed")],
        [
            _attempt("tr_failed", 1, status=500, outcome="error", error_type="500"),
            _attempt("tr_failed", 2, status=503, outcome="error", error_type="503"),
            _attempt("tr_failed", 3, status=502, outcome="error", error_type="502"),
        ],
    )

    item = _items(client)["evt_retry_failed"]
    assert item["attempts_count"] == 3
    assert item["has_attempts"] is True
    assert item["error"] == "upstream 502"


def test_attempt_error_summary_prefers_the_adapter_error_message(
    client, engine_and_sessionmaker
):
    """错误摘要保留适配器给的错误细节，而不是只回显状态码。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_quota", status=429, trace_id="tr_quota")],
        [
            _attempt(
                "tr_quota",
                1,
                status=429,
                outcome="error",
                error_type="rate_limited",
                error_message="upstream quota exhausted",
            )
        ],
    )

    item = _items(client)["evt_quota"]
    assert item["error"] == "upstream 429: upstream quota exhausted"


def test_attempt_error_summary_uses_error_type_when_message_is_missing(
    client, engine_and_sessionmaker
):
    """error_message 为空时用 error_type 补齐（适配器通常只给 error.type）。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_timeout", status=504, trace_id="tr_timeout")],
        [_attempt("tr_timeout", 1, status=504, outcome="error", error_type="upstream_timeout")],
    )

    item = _items(client)["evt_timeout"]
    assert item["error"] == "upstream 504: upstream_timeout"


def test_row_error_stays_empty_when_no_attempts_are_recorded(
    client, engine_and_sessionmaker
):
    """无 attempts 时行级错误摘要保持为空，不伪造链路信息。"""
    _, factory = engine_and_sessionmaker
    _seed(factory, [_event("evt_no_chain", status=500)], [])

    item = _items(client)["evt_no_chain"]
    assert item["attempts_count"] == 0
    assert item["has_attempts"] is False
    assert item["error"] == ""


def test_raw_log_error_is_not_replaced_by_the_attempt_summary(
    client, engine_and_sessionmaker
):
    """原始日志已有错误文本时保留原文，attempts 只做「补齐」不覆盖。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            _event(
                "evt_raw_error",
                status=500,
                trace_id="tr_raw",
                raw={"error": "all upstreams failed", "has_payload": False},
            )
        ],
        [_attempt("tr_raw", 1, status=500, outcome="error", error_type="500")],
    )

    item = _items(client)["evt_raw_error"]
    assert item["error"] == "all upstreams failed"


def test_successful_request_with_failed_attempts_keeps_error_empty(
    client, engine_and_sessionmaker
):
    """重试后成功（HTTP 200）的请求不因链中失败尝试被标记为错误。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_retry_ok", status=200, trace_id="tr_retry_ok")],
        [
            _attempt("tr_retry_ok", 1, status=500, outcome="error", error_type="500"),
            _attempt("tr_retry_ok", 2, status=200, outcome="ok"),
        ],
    )

    item = _items(client)["evt_retry_ok"]
    assert item["attempts_count"] == 2
    assert item["has_attempts"] is True
    assert item["error"] == ""


def test_list_page_batches_attempt_counts_per_row(client, engine_and_sessionmaker):
    """一页多行按 correlation_key 各自取到自己的尝试数，不串行。"""
    _, factory = engine_and_sessionmaker
    events = [
        _event("evt_one", status=200, trace_id="tr_one"),
        _event("evt_two", status=502, trace_id="tr_two"),
        _event("evt_none", status=200),
    ]
    attempts = [
        _attempt("tr_one", 1, status=200, outcome="ok"),
        _attempt("tr_two", 1, status=500, outcome="error", error_type="500"),
        _attempt("tr_two", 2, status=502, outcome="error", error_type="502"),
        _attempt("tr_two", 3, status=502, outcome="error", error_type="502"),
    ]
    _seed(factory, events, attempts)

    items = _items(client)
    assert items["evt_one"]["attempts_count"] == 1
    assert items["evt_two"]["attempts_count"] == 3
    assert items["evt_none"]["attempts_count"] == 0
    assert items["evt_one"]["has_attempts"] is True
    assert items["evt_none"]["has_attempts"] is False


def _request_attempt_statements(engine, client) -> list[str]:
    statements: list[str] = []

    def capture(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get("/admin/logs?page_size=50")
        assert response.status_code == 200, response.text
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    return [statement for statement in statements if "request_attempts" in statement.lower()]


def test_a_log_page_queries_request_attempts_exactly_once(
    client, engine_and_sessionmaker
):
    """一页日志只允许一次尝试聚合查询：行数增长不得变成 N+1。"""
    engine, factory = engine_and_sessionmaker
    events = [
        _event("evt_page_" + str(idx), status=200, trace_id="tr_page_" + str(idx))
        for idx in range(20)
    ]
    attempts = [
        _attempt("tr_page_" + str(idx), no, status=200, outcome="ok")
        for idx in range(20)
        for no in (1, 2)
    ]
    _seed(factory, events, attempts)

    queries = _request_attempt_statements(engine, client)
    assert len(queries) == 1, "一页只允许一次 request_attempts 查询，实际：" + str(len(queries))
