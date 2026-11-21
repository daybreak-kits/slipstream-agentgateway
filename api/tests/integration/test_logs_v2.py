"""Usage-log v2: merged columns, identity, derived metrics, permissions (ticket 14)."""

from __future__ import annotations

import json

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l04_repo.orm import ApiKeyORM, ChargeEntryORM, CostEntryORM, GatewayUsageEventORM, UserORM
from l06_api.deps import SESSION_COOKIE


def _browser(factory, role: str, username: str):
    admin_id = make_admin(factory, username=username, role=role)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _custom_role_browser(admin_client, factory, permissions: list[str], name: str):
    created = admin_client.post("/admin/roles", json={"name": name, "permissions": permissions})
    assert created.status_code == 201, created.text
    return _browser(factory, created.json()["key"], "custom-" + name)


def _seed_logs(factory) -> None:
    """Two consumers, two keys, three events: streamed success, error, embedding."""
    now = now_ms()
    with factory() as session:
        session.add(UserORM(id="usr_alice", name="alice", created_at_ms=now))
        session.add(UserORM(id="usr_bob", name="bob", created_at_ms=now))
        session.add(
            ApiKeyORM(
                id="key_alice",
                user_id="usr_alice",
                prefix="sk-abcd",
                key_hash="sha256:alice",
                key_enc="",
                key_suffix="WXYZ",
                status="active",
                created_at_ms=now,
            )
        )
        session.add(
            ApiKeyORM(
                id="key_bob",
                user_id="usr_bob",
                prefix="sk-efgh",
                key_hash="sha256:bob",
                key_enc="",
                key_suffix="QRST",
                status="active",
                created_at_ms=now,
            )
        )
        session.add(
            GatewayUsageEventORM(
                event_id="evt_stream",
                started_at_ms=now - 3000,
                completed_at_ms=now - 1600,
                duration_ms=1400,
                time_to_first_token_ms=400,
                http_status=200,
                public_model="flagship",
                upstream_model="glm-5.3",
                provider="testv",
                api_key_id="key_alice",
                input_tokens=1000,
                output_tokens=600,
                total_tokens=1600,
                cache_read_tokens=250,
                cache_write_tokens=0,
                error="",
                has_payload=True,
                is_stream=True,
                correlation_key="trace-stream",
                raw_json=json.dumps({"cost": 0.002}),
            )
        )
        session.add(
            GatewayUsageEventORM(
                event_id="evt_error",
                started_at_ms=now - 2000,
                completed_at_ms=now - 1100,
                duration_ms=900,
                time_to_first_token_ms=0,
                http_status=429,
                public_model="flagship",
                upstream_model="glm-5.3",
                provider="testv",
                api_key_id="key_bob",
                input_tokens=200,
                output_tokens=120,
                total_tokens=320,
                error="upstream rate limited",
                has_payload=False,
                is_stream=False,
                raw_json="",
            )
        )
        session.add(
            GatewayUsageEventORM(
                event_id="evt_embed",
                started_at_ms=now - 1000,
                completed_at_ms=now - 950,
                duration_ms=50,
                time_to_first_token_ms=0,
                http_status=200,
                public_model="embed-small",
                upstream_model="bge-m3",
                provider="testv",
                api_key_id="key_alice",
                input_tokens=800,
                output_tokens=0,
                total_tokens=800,
                raw_json=json.dumps({"seed": True}),
            )
        )
        session.add(
            CostEntryORM(
                id="co_stream",
                gateway_event_id="evt_stream",
                amount_micro=800,
                currency="CNY",
                status="ok",
                created_at_ms=now - 3000,
            )
        )
        session.add(
            ChargeEntryORM(
                id="ce_stream",
                gateway_event_id="evt_stream",
                user_id="usr_alice",
                amount_micro=1000,
                currency="CNY",
                status="ok",
                created_at_ms=now - 3000,
            )
        )
        session.add(
            ChargeEntryORM(
                id="ce_error",
                gateway_event_id="evt_error",
                user_id="usr_bob",
                amount_micro=400,
                currency="CNY",
                status="ok",
                created_at_ms=now - 2000,
            )
        )
        session.commit()


def _by_id(body: dict) -> dict[str, dict]:
    return {item["event_id"]: item for item in body["items"]}


def test_log_list_carries_merged_columns(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)
    body = client.get("/admin/logs").json()
    assert body["total"] == 3
    row = _by_id(body)["evt_stream"]

    # Identity: the list shows the owner and the masked key, never the hash.
    assert row["user_id"] == "usr_alice"
    assert row["user_name"] == "alice"
    assert row["api_key_label"] == "sk-abcd...WXYZ"
    assert "sha256:alice" not in json.dumps(body)

    # Derived metrics the merged columns render.
    assert row["is_stream"] is True
    # Containment rule: 250 cached of 1000 prompt tokens is a quarter of the prompt.
    assert row["cache_ratio"] == 25.0
    assert row["throughput_tps"] == 600.0
    assert row["has_payload"] is True
    assert row["has_error"] is False
    assert row["error"] == ""

    # Money: cost + spend + margin ride on the same row for a full-permission admin.
    assert row["cost_micro"] == 800
    assert row["charge_micro"] == 1000
    assert row["margin_micro"] == 200
    assert row["currency"] == "CNY"

    err = _by_id(body)["evt_error"]
    assert err["has_error"] is True
    assert err["error"] == "upstream rate limited"
    assert err["is_stream"] is False
    assert err["cache_ratio"] is None
    # Non-streaming calls have no generating window, so the old UI leaves throughput blank.
    assert err["throughput_tps"] is None
    # Money keys stay stable in the schema; a missing entry is null, not absent.
    assert err["cost_micro"] is None
    assert err["margin_micro"] is None


def test_log_detail_matches_list_row_and_serves_neutral_facts(
    client, engine_and_sessionmaker
):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)
    row = _by_id(client.get("/admin/logs").json())["evt_stream"]
    detail = client.get("/admin/logs/evt_stream").json()

    for key, value in row.items():
        assert detail.get(key) == value, key
    assert detail["provider"] == "testv"
    assert detail["api_key_id"] == "key_alice"
    # The correlation key is served under its neutral name; the raw wire row is
    # a diagnostic attachment in the table, never an API contract field.
    assert detail["correlation_key"] == "trace-stream"
    assert "raw_json" not in detail


def test_log_query_tokens_filter_and_report_bad_syntax(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)

    def ids(query: str) -> set[str]:
        response = client.get("/admin/logs", params={"query": query})
        assert response.status_code == 200, response.text
        return set(_by_id(response.json()))

    assert ids("user:alice") == {"evt_stream", "evt_embed"}
    assert ids("user:ali") == {"evt_stream", "evt_embed"}
    # user: also matches the consumer id, not only the display name.
    assert ids("user:usr_bob") == {"evt_error"}
    assert ids("user:usr_") == {"evt_stream", "evt_error", "evt_embed"}
    assert ids("key:QRST") == {"evt_error"}
    assert ids("status:429") == {"evt_error"}
    assert ids("status:4xx") == {"evt_error"}
    assert ids("status:5xx") == set()
    assert ids("stream:true") == {"evt_stream"}
    assert ids("stream:false") == {"evt_error", "evt_embed"}
    assert ids("cache>10") == {"evt_stream"}
    assert ids("ttft>300") == {"evt_stream"}
    assert ids("latency>1000") == {"evt_stream"}
    assert ids("latency<100") == {"evt_embed"}
    assert ids("model:embed") == {"evt_embed"}
    assert ids("upstream:testv") == {"evt_stream", "evt_error", "evt_embed"}
    assert ids("alice") == {"evt_stream", "evt_embed"}
    assert ids("user:alice status:200 stream:true") == {"evt_stream"}

    bad_tokens = (
        "status:ok",
        "status:600x",
        "latency>abc",
        "ttft>-1",
        "cache>120",
        "stream:maybe",
        "user:",
    )
    for bad in bad_tokens:
        response = client.get("/admin/logs", params={"query": bad})
        assert response.status_code == 422, (bad, response.status_code)
        assert "查询语法错误" in response.text, bad


def test_log_detail_never_leaks_cost_without_billing_cost(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)
    browser = _custom_role_browser(client, factory, ["logs:read"], "仅日志")

    detail = browser.get("/admin/logs/evt_stream").json()
    for key in ("cost_micro", "margin_micro", "charge_micro"):
        assert key not in detail, key
    # No raw wire row is served at all, so no money can hide inside one.
    assert "raw_json" not in detail

    row = _by_id(browser.get("/admin/logs").json())["evt_stream"]
    for key in ("cost_micro", "margin_micro", "charge_micro"):
        assert key not in row, key

    spend_only = _custom_role_browser(
        client, factory, ["logs:read", "billing:spend"], "日志加花费"
    )
    spend_row = _by_id(spend_only.get("/admin/logs").json())["evt_stream"]
    assert spend_row["charge_micro"] == 1000
    assert "cost_micro" not in spend_row
    assert "margin_micro" not in spend_row


def test_log_paging_sorting_and_error_filter(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)

    first = client.get("/admin/logs", params={"page_size": 25}).json()
    assert len(first["items"]) == 3
    assert first["next_offset"] is None

    errored = client.get("/admin/logs", params={"has_error": "true"}).json()
    assert [item["event_id"] for item in errored["items"]] == ["evt_error"]

    cheapest = client.get(
        "/admin/logs", params={"sort": "charge_micro", "order": "asc"}
    ).json()
    assert cheapest["items"][0]["event_id"] == "evt_embed"  # no charge sorts lowest

    # total_tokens sort: the streamed success carries the most tokens.
    fattest = client.get("/admin/logs", params={"sort": "total_tokens", "order": "desc"}).json()
    assert fattest["items"][0]["event_id"] == "evt_stream"
    assert fattest["items"][-1]["event_id"] == "evt_error"
    assert client.get("/admin/logs", params={"sort": "total_tokens", "order": "asc"}).json()[
        "items"
    ][0]["event_id"] == "evt_error"

    assert client.get("/admin/logs", params={"sort": "bogus"}).status_code == 422
    detail = client.get("/admin/logs/evt_stream").json()
    assert client.get("/admin/logs/nope").status_code == 404
    assert detail["estimate"] is True


def test_log_sorting_by_money_needs_the_matching_permission(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_logs(factory)
    plain = _custom_role_browser(client, factory, ["logs:read"], "仅日志排序")
    assert plain.get("/admin/logs", params={"sort": "cost_micro"}).status_code == 403
    assert plain.get("/admin/logs", params={"sort": "charge_micro"}).status_code == 403

    spend_only = _custom_role_browser(
        client, factory, ["logs:read", "billing:spend"], "花费排序"
    )
    assert spend_only.get("/admin/logs", params={"sort": "charge_micro"}).status_code == 200
    assert spend_only.get("/admin/logs", params={"sort": "cost_micro"}).status_code == 403
