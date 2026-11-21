"""Ticket 04：日志请求尝试链——批量字段、一页一次聚合查询与失败事实字段。

只从 HTTP API seam 断言控制台真正消费的形状：列表行的 attempts_count /
has_attempts 与最后一次失败的事实字段（last_failure_status / error_type /
error_message），以及一页里 request_attempts 只被聚合查询一次。行级错误文案
由前端唯一拼装，服务层不再产出 UI 摘要。
请求尝试由适配器归一化后写入同一个 request_attempts 表（ADR-028），这里用
record_attempts 写入真实事实，不做内部实现模拟。
"""

from __future__ import annotations

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
    event_id: str, *, status: int, correlation_key: str = "", error: str = ""
) -> UsageEvent:
    return UsageEvent(
        event_id=event_id,
        started_at_ms=1_800_000_000_000,
        duration_ms=20,
        http_status=status,
        public_model="flagship",
        upstream_model="glm-5.3",
        provider="testv",
        correlation_key=correlation_key,
        error=error,
        has_payload=False,
    )


def _items(client) -> dict[str, dict]:
    response = client.get("/admin/logs?page_size=50")
    assert response.status_code == 200, response.text
    return {item["event_id"]: item for item in response.json()["items"]}


def test_row_exposes_last_failed_attempt_facts_without_a_server_side_summary(
    client, engine_and_sessionmaker
):
    """上游 5xx 且 attempts 可用：行只带最后一次失败的事实字段。

    适配器把 error.type 归一化成状态码字符串，服务层不再拼 UI 文案；
    列表行的 error 保持原始日志文本（此处为空），摘要由前端唯一拼装。
    """
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_retry_failed", status=502, correlation_key="tr_failed")],
        [
            _attempt("tr_failed", 1, status=500, outcome="error", error_type="500"),
            _attempt("tr_failed", 2, status=503, outcome="error", error_type="503"),
            _attempt("tr_failed", 3, status=502, outcome="error", error_type="502"),
        ],
    )

    item = _items(client)["evt_retry_failed"]
    assert item["attempts_count"] == 3
    assert item["has_attempts"] is True
    assert item["error"] == ""
    assert item["last_failure_status"] == 502
    assert item["last_failure_error_type"] == "502"
    assert item["last_failure_error_message"] == ""

    # 详情抽屉复用同一 _log_item 形状：失败事实字段必须一致。
    detail = client.get("/admin/logs/evt_retry_failed").json()
    assert detail["attempts_count"] == 3
    assert detail["last_failure_status"] == 502
    assert detail["last_failure_error_type"] == "502"
    assert detail["last_failure_error_message"] == ""


def test_failure_facts_keep_the_adapter_error_message_and_type(
    client, engine_and_sessionmaker
):
    """失败事实保留适配器给的 error_message / error_type，前端据此拼摘要。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_quota", status=429, correlation_key="tr_quota")],
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
    assert item["error"] == ""
    assert item["last_failure_status"] == 429
    assert item["last_failure_error_type"] == "rate_limited"
    assert item["last_failure_error_message"] == "upstream quota exhausted"


def test_failure_facts_keep_error_type_when_message_is_missing(
    client, engine_and_sessionmaker
):
    """error_message 为空时 error_type 单独保留（适配器通常只给 error.type）。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_timeout", status=504, correlation_key="tr_timeout")],
        [_attempt("tr_timeout", 1, status=504, outcome="error", error_type="upstream_timeout")],
    )

    item = _items(client)["evt_timeout"]
    assert item["error"] == ""
    assert item["last_failure_status"] == 504
    assert item["last_failure_error_type"] == "upstream_timeout"
    assert item["last_failure_error_message"] == ""



def test_row_error_stays_empty_when_no_attempts_are_recorded(
    client, engine_and_sessionmaker
):
    """无 attempts 时失败事实字段为空，不伪造链路信息。"""
    _, factory = engine_and_sessionmaker
    _seed(factory, [_event("evt_no_chain", status=500)], [])

    item = _items(client)["evt_no_chain"]
    assert item["attempts_count"] == 0
    assert item["has_attempts"] is False
    assert item["error"] == ""
    assert item["last_failure_status"] is None
    assert item["last_failure_error_type"] == ""
    assert item["last_failure_error_message"] == ""


def test_ingested_error_text_is_not_replaced_by_the_attempt_summary(
    client, engine_and_sessionmaker
):
    """归一化错误文本照实返回；失败事实字段仍照实返回。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [
            _event(
                "evt_raw_error",
                status=500,
                correlation_key="tr_raw",
                error="all upstreams failed",
            )
        ],
        [_attempt("tr_raw", 1, status=500, outcome="error", error_type="500")],
    )

    item = _items(client)["evt_raw_error"]
    assert item["error"] == "all upstreams failed"
    assert item["last_failure_status"] == 500
    assert item["last_failure_error_type"] == "500"
    assert item["last_failure_error_message"] == ""


def test_successful_request_with_failed_attempts_keeps_error_empty(
    client, engine_and_sessionmaker
):
    """重试后成功（HTTP 200）的请求不因链中失败尝试被标记为错误。"""
    _, factory = engine_and_sessionmaker
    _seed(
        factory,
        [_event("evt_retry_ok", status=200, correlation_key="tr_retry_ok")],
        [
            _attempt("tr_retry_ok", 1, status=500, outcome="error", error_type="500"),
            _attempt("tr_retry_ok", 2, status=200, outcome="ok"),
        ],
    )

    item = _items(client)["evt_retry_ok"]
    assert item["attempts_count"] == 2
    assert item["has_attempts"] is True
    assert item["error"] == ""
    # 失败事实照实返回；是否展示摘要由前端按 http_status 判断，不在服务层裁决。
    assert item["last_failure_status"] == 500


def test_list_page_batches_attempt_counts_per_row(client, engine_and_sessionmaker):
    """一页多行按 correlation_key 各自取到自己的尝试数，不串行。"""
    _, factory = engine_and_sessionmaker
    events = [
        _event("evt_one", status=200, correlation_key="tr_one"),
        _event("evt_two", status=502, correlation_key="tr_two"),
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
        _event("evt_page_" + str(idx), status=200, correlation_key="tr_page_" + str(idx))
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
