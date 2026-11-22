"""Money fields over HTTP: absent without permission, present with it (ticket 03)."""

from __future__ import annotations

import json

from tests.conftest import _app_client, make_admin, new_session_token

from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
    LedgerEntryORM,
    UserDailyORM,
)
from l06_api.deps import SESSION_COOKIE


def _browser(factory, role: str, username: str, user_id: str = ""):
    admin_id = make_admin(factory, username=username, role=role, user_id=user_id)
    client = _app_client(factory)
    client.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    return client


def _seed_books(factory, user_id: str = "usr_filter") -> None:
    now = now_ms()
    with factory() as session:
        session.add(
            GatewayUsageEventORM(
                event_id="evt_filter",
                started_at_ms=now - 1000,
                completed_at_ms=now - 900,
                duration_ms=100,
                http_status=200,
                public_model="flagship",
                upstream_model="glm-5.3",
                provider="testv",
                input_tokens=10,
                output_tokens=5,
                total_tokens=15,
                raw_json=json.dumps(
                    {"trace_id": "trace-filter", "cost": 0.002, "charge": 0.001}
                ),
            )
        )
        session.add(
            CostEntryORM(
                id="co_filter",
                gateway_event_id="evt_filter",
                amount_micro=800,
                currency="CNY",
                status="ok",
                created_at_ms=now - 1000,
            )
        )
        session.add(
            ChargeEntryORM(
                id="ce_filter",
                gateway_event_id="evt_filter",
                user_id=user_id,
                amount_micro=1000,
                currency="CNY",
                status="ok",
                created_at_ms=now - 1000,
            )
        )
        session.add(
            UserDailyORM(
                day="2026-01-01",
                user_id=user_id,
                requests=1,
                input_tokens=10,
                output_tokens=5,
                amount_micro=1000,
                currency="CNY",
            )
        )
        session.add(
            LedgerEntryORM(
                id="led_filter",
                user_id=user_id,
                kind="charge",
                delta_micro=-1000,
                balance_after_micro=0,
                currency="CNY",
                created_at_ms=now - 1000,
            )
        )
        session.commit()


def _custom_role_browser(
    admin_client, factory, permissions: list[str], name: str, user_id: str = ""
):
    created = admin_client.post(
        "/admin/roles", json={"name": name, "permissions": permissions}
    )
    assert created.status_code == 201, created.text
    return _browser(factory, created.json()["key"], "custom-" + name, user_id=user_id)


def test_ordinary_user_overview_hides_cost_keeps_spend(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    browser = _browser(factory, "customer", "plain-overview")
    body = browser.get("/admin/reports/overview").json()
    assert "cost_micro" not in body
    assert "margin_micro" not in body
    assert "charge_micro" in body
    flow = browser.get("/admin/reports/flow").json()
    for link in flow["links"]:
        assert "cost_micro" not in link
        assert "charge_micro" in link


def test_role_without_billing_gets_no_money_keys(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_books(factory)
    browser = _custom_role_browser(
        client,
        factory,
        ["reports:read", "logs:read", "ledger:read"],
        "无金额",
        user_id="usr_filter",
    )

    overview = browser.get("/admin/reports/overview").json()
    for key in ("cost_micro", "charge_micro", "margin_micro"):
        assert key not in overview, key

    logs = browser.get("/admin/logs").json()
    assert logs["items"]
    assert "cost_micro" not in logs["items"][0]
    assert "charge_micro" not in logs["items"][0]

    detail = browser.get("/admin/usage/events/evt_filter").json()
    assert "cost" not in detail
    assert "charge" not in detail
    # The raw wire row is a diagnostic attachment in the table, never served:
    # no money key can hide inside a raw JSON string the API no longer returns.
    assert "raw_json" not in detail

    daily = browser.get("/admin/usage/daily").json()
    assert daily and "amount_micro" not in daily[0]

    ledger = browser.get("/admin/usage/ledger").json()
    assert ledger
    assert "delta_micro" not in ledger[0]
    assert "balance_after_micro" not in ledger[0]


def test_ordinary_user_sees_spend_fields(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_books(factory)
    browser = _browser(factory, "customer", "plain-spend", user_id="usr_filter")
    daily = browser.get("/admin/usage/daily").json()
    assert daily[0]["amount_micro"] == 1000
    ledger = browser.get("/admin/usage/ledger").json()
    assert ledger[0]["delta_micro"] == -1000
    assert ledger[0]["balance_after_micro"] == 0
    detail = browser.get("/admin/usage/events/evt_filter").json()
    assert detail["charge"]["amount_micro"] == 1000
    assert "cost" not in detail
    # No raw wire row is served, so no money value can hide inside one.
    assert "raw_json" not in detail


def test_cost_endpoints_forbidden_without_billing_cost(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    browser = _browser(factory, "customer", "plain-forbidden")
    assert browser.get("/admin/cost/entries").status_code == 403
    assert browser.get("/admin/reports/margin").status_code == 403
    assert browser.get("/admin/charge/entries").status_code == 200


# ---------------------------------------------------------------- 报表 payload 契约


def _walk_keys(node) -> set[str]:
    found: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            found.add(key)
            found |= _walk_keys(value)
    elif isinstance(node, list):
        for item in node:
            found |= _walk_keys(item)
    return found


REPORT_PATHS = (
    "/admin/reports/overview",
    "/admin/reports/latency",
    "/admin/reports/timeseries",
    "/admin/reports/heatmap",
    "/admin/reports/flow",
)


def test_report_payloads_omit_money_without_permission(client, engine_and_sessionmaker):
    """ticket 03: no billing permission -> the money KEY is absent, not null."""
    _, factory = engine_and_sessionmaker
    _seed_books(factory)
    browser = _custom_role_browser(
        client, factory, ["reports:read"], "报表无金额", user_id="usr_filter"
    )
    for path in REPORT_PATHS:
        response = browser.get(path)
        assert response.status_code == 200, (path, response.text)
        money_keys = {"cost_micro", "charge_micro", "margin_micro"} & _walk_keys(response.json())
        assert money_keys == set(), (path, sorted(money_keys))

    timeseries = browser.get("/admin/reports/timeseries").json()
    assert "cost_micro" not in timeseries["totals"]
    assert "charge_micro" not in timeseries["totals"]
    assert "cost_micro" not in _walk_keys(timeseries["members"])
    # Money metrics stay forbidden without billing, whatever the route.
    assert browser.get("/admin/reports/timeseries?metric=cost_micro").status_code == 403
    assert browser.get("/admin/reports/heatmap?metric=cost_micro").status_code == 403


def test_report_payloads_include_money_with_permission(client, engine_and_sessionmaker):
    """ticket 03: the same payload keeps the money VALUES when permitted."""
    _, factory = engine_and_sessionmaker
    _seed_books(factory)
    browser = _custom_role_browser(
        client,
        factory,
        ["reports:read", "billing:cost", "billing:spend"],
        "报表有金额",
        user_id="usr_filter",
    )

    overview = browser.get("/admin/reports/overview").json()
    assert overview["cost_micro"] == 800
    assert overview["charge_micro"] == 1000
    assert overview["margin_micro"] == 200

    timeseries = browser.get(
        "/admin/reports/timeseries",
        params={"metrics": "cost_micro,charge_micro"},
    ).json()
    assert timeseries["totals"]["cost_micro"] == 800
    assert timeseries["totals"]["charge_micro"] == 1000

    flow = browser.get("/admin/reports/flow").json()
    assert flow["totals"]["cost_micro"] == 800
    assert flow["totals"]["charge_micro"] == 1000

    heatmap = browser.get("/admin/reports/heatmap", params={"metric": "cost_micro"}).json()
    assert heatmap["metric"] == "cost_micro"
    assert heatmap["total"] == 800

    latency = browser.get("/admin/reports/latency").json()
    assert not ({"cost_micro", "charge_micro", "margin_micro"} & _walk_keys(latency))
