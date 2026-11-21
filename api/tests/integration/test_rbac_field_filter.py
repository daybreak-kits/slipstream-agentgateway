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
    raw = json.loads(detail["raw_json"])
    assert raw["trace_id"] == "trace-filter"
    assert "cost" not in raw and "charge" not in raw

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
    raw = json.loads(detail["raw_json"])
    assert raw["charge"] == 0.001
    assert "cost" not in raw


def test_cost_endpoints_forbidden_without_billing_cost(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    browser = _browser(factory, "customer", "plain-forbidden")
    assert browser.get("/admin/cost/entries").status_code == 403
    assert browser.get("/admin/reports/margin").status_code == 403
    assert browser.get("/admin/charge/entries").status_code == 200
