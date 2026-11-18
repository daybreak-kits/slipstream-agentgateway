"""Ticket 05 pricing API: editable model costs/markup + derived public prices + ledger."""

from __future__ import annotations

from decimal import Decimal

from tests.conftest import _app_client, make_admin, new_session_token, seed_channel

from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
)
from l05_service import prices
from l06_api.deps import SESSION_COOKIE


def test_upstream_model_prices_are_editable_and_validated(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    body = {
        "cost_input_per_1m": "2.5",
        "cost_output_per_1m": "10",
        "markup": "1.2",
    }
    patched = client.patch("/admin/upstream-models/umdl_test", json=body)
    assert patched.status_code == 200, patched.text
    row = patched.json()
    assert row["cost_input_per_1m"] == "2.500000"
    assert row["cost_output_per_1m"] == "10.000000"
    assert row["markup"] == "1.2000"

    # Explicit null clears a price back to unpriced.
    cleared = client.patch("/admin/upstream-models/umdl_test", json={"cost_input_per_1m": None})
    assert cleared.status_code == 200
    assert cleared.json()["cost_input_per_1m"] is None

    assert client.patch("/admin/upstream-models/umdl_test", json={"markup": "0"}).status_code == 422
    negative = client.patch("/admin/upstream-models/umdl_test", json={"markup": "-1"})
    assert negative.status_code == 422
    assert (
        client.patch(
            "/admin/upstream-models/umdl_test", json={"cost_output_per_1m": "-0.01"}
        ).status_code
        == 422
    )
    assert client.patch("/admin/upstream-models/nope", json={"markup": "1.2"}).status_code == 404


def test_upstream_model_cost_fields_are_hidden_without_billing_cost(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    # 普通用户有 upstream_models:read 但没有 billing:cost：成本键整体缺席。
    viewer = make_admin(factory, username="pricing-viewer", role="user")
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, viewer))
    rows = browser.get("/admin/upstream-models").json()
    assert rows[0]["name"] == "glm-5.3"
    assert "cost_input_per_1m" not in rows[0]
    assert "cost_output_per_1m" not in rows[0]
    assert "markup" not in rows[0]
    # 公开模型只暴露已售花费单价，仍可读。
    price_row = browser.get("/admin/prices/public-models").json()[0]
    assert price_row["price_input_per_1m"] == "3.000000"
    assert "cost_input_per_1m" not in price_row


def test_public_model_price_is_derived_and_read_only(client, engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    rows = client.get("/admin/prices/public-models").json()
    assert len(rows) == 1
    flagship = rows[0]
    assert flagship["public_model_id"] == "pmdl_test"
    assert flagship["price_input_per_1m"] == "3.000000"  # 2.5 x 1.2
    assert flagship["price_output_per_1m"] == "12.000000"
    assert flagship["read_only"] is True
    assert flagship["available"] is True
    # Read-only means no write verb is exposed on this derived view.
    assert client.post("/admin/prices/public-models", json={}).status_code == 405
    # Nothing was persisted in the downstream book by reading the average.
    with factory() as session:
        assert session.query(prices.ChargePriceORM).count() == 0


def test_billing_ledger_has_cost_spend_margin_and_field_permissions(
    client, engine_and_sessionmaker
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    now = now_ms()
    with factory() as session:
        session.add(
            GatewayUsageEventORM(
                event_id="evt_ledger",
                started_at_ms=now - 1000,
                http_status=200,
                public_model="flagship",
                upstream_model="glm-5.3",
            )
        )
        session.add(
            CostEntryORM(
                id="co_ledger",
                gateway_event_id="evt_ledger",
                amount_micro=800,
                currency="CNY",
                status="ok",
                created_at_ms=now - 1000,
            )
        )
        session.add(
            ChargeEntryORM(
                id="ce_ledger",
                gateway_event_id="evt_ledger",
                user_id="usr_ledger",
                amount_micro=960,
                currency="CNY",
                status="ok",
                created_at_ms=now - 1000,
            )
        )
        session.commit()

    admin_rows = client.get("/admin/billing/ledger").json()
    assert len(admin_rows) == 1
    row = admin_rows[0]
    assert row["cost_micro"] == 800
    assert row["spend_micro"] == 960
    assert row["margin_micro"] == 160
    assert row["markup"] == "1.2000"

    # 普通用户: billing:spend + ledger:read but no billing:cost -> spend only.
    admin_id = make_admin(factory, username="ledger-user", role="user")
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    user_rows = browser.get("/admin/billing/ledger").json()
    assert user_rows[0]["spend_micro"] == 960
    assert "cost_micro" not in user_rows[0]
    assert "margin_micro" not in user_rows[0]
    assert browser.get("/admin/cost/entries").status_code == 403


def test_cost_book_write_requires_billing_cost(client, engine_and_sessionmaker):
    """写成本账同样要 billing:cost：只有 upstream_models:write 的自定义角色被拒。"""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    created = client.post(
        "/admin/roles",
        json={
            "name": "价目维护",
            "description": "可维护上游模型，但看不到成本",
            "permissions": ["upstream_models:read", "upstream_models:write", "prices:read"],
        },
    )
    assert created.status_code == 201, created.text
    operator = make_admin(factory, username="pricing-editor", role=created.json()["key"])
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, operator))
    denied = browser.patch("/admin/upstream-models/umdl_test", json={"markup": "1.2"})
    assert denied.status_code == 403
    rows = browser.get("/admin/upstream-models").json()
    assert rows[0]["name"] == "glm-5.3"
    assert "markup" not in rows[0]


def test_editing_price_book_updates_the_derived_public_price(client, engine_and_sessionmaker):
    """改成本/倍率后派生公开模型价立即变：看板与模型管理读的是同一派生值。"""
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    first = client.get("/admin/prices/public-models").json()[0]
    assert first["price_input_per_1m"] == "3.000000"
    assert first["price_output_per_1m"] == "12.000000"

    client.patch("/admin/upstream-models/umdl_test", json={"markup": "2"})
    second = client.get("/admin/prices/public-models").json()[0]
    assert second["price_input_per_1m"] == "5.000000"
    assert second["price_output_per_1m"] == "20.000000"

    # 清空输入价：输入价变 null，输出价仍可计算，公开模型仍算可计算。
    client.patch("/admin/upstream-models/umdl_test", json={"cost_input_per_1m": None})
    third = client.get("/admin/prices/public-models").json()[0]
    assert third["price_input_per_1m"] is None
    assert third["price_output_per_1m"] == "20.000000"
    assert third["available"] is True


def test_legacy_markup_book_matches_model_markup_calibre(engine_and_sessionmaker):
    """口径对齐：legacy 12000 万分比 == Decimal 1.2, same cost -> same spend."""
    cost_micro = 800
    cost_numerator = 800 * 1_000_000  # micro -> token numerator at 1M tokens
    legacy = prices.charge_micro_from_cost(
        cost_numerator,
        {
            "request": prices.ChargePriceORM(
                public_model_id="p",
                item="request",
                mode="markup",
                value=12_000,
                currency="CNY",
            )
        },
        {"input": 0, "output": 0},
        per_request_items=0,
    )
    model_level = __import__("l05_service.pricing", fromlist=["spend_micro"]).spend_micro(
        cost_micro, Decimal("1.2")
    )
    assert legacy == model_level == 960
