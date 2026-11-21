"""Ticket 05 pricing API: editable model costs/markup + derived public prices + ledger."""

from __future__ import annotations

from tests.conftest import _app_client, make_admin, new_session_token, seed_channel

from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ChargeEntryORM,
    ChargePriceORM,
    CostEntryORM,
    GatewayUsageEventORM,
)
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
    viewer = make_admin(factory, username="pricing-viewer", role="customer")
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
    # Nothing was persisted by reading the average (the downstream book is retired).
    with factory() as session:
        assert session.query(ChargePriceORM).count() == 0


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
    admin_id = make_admin(factory, username="ledger-user", role="customer")
    browser = _app_client(factory)
    browser.cookies.set(SESSION_COOKIE, new_session_token(factory, admin_id))
    user_rows = browser.get("/admin/billing/ledger").json()
    assert user_rows[0]["spend_micro"] == 960
    assert "cost_micro" not in user_rows[0]
    assert "margin_micro" not in user_rows[0]
    assert browser.get("/admin/cost/entries").status_code == 403


def test_cost_book_write_requires_billing_cost(client, engine_and_sessionmaker):
    """写成本账同样要 billing:cost：只有 upstream_models:write 的自定义角色被拒。

    The PATCH route already had the gate; the CREATE route (same cost/markup
    payload) now carries it too (P2 symmetric write permission).
    """
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
    denied_create = browser.post(
        "/admin/upstream-models",
        json={
            "upstream_id": "ups_test",
            "name": "glm-6",
            "model_type": "chat",
            "cost_input_per_1m": "2.5",
        },
    )
    assert denied_create.status_code == 403
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


def test_ui_priced_model_bills_from_model_row_with_empty_price_books(
    client, engine_and_sessionmaker
):
    """ADR-020 end to end: UI model + price, empty price books, ingest -> bill.

    The two versioned books hold nothing (not even cache rows), so a correct
    cost and charge can only come from the model row: input/output cost and the
    markup are its columns, and the user is debited once.
    """
    from l02_domain.models import UsageEvent
    from l04_repo.orm import ChargePriceORM, UpstreamPriceORM, UserORM
    from l05_service import usage_ingest

    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    now = now_ms()

    # UI path: create the model with its cost fields (no markup sent). A fresh
    # name keeps the resolver off the unpriced seed row of the same name.
    created = client.post(
        "/admin/upstream-models",
        json={
            "upstream_id": seed["upstream_id"],
            "name": "glm-5.3-air",
            "model_type": "chat",
            "cost_input_per_1m": "2.5",
            "cost_output_per_1m": "10",
        },
    )
    assert created.status_code == 201, created.text
    # A model row created without a markup bills at the 1.2 house rate.
    assert created.json()["markup"] == "1.2000"
    model_id = created.json()["id"]

    # Empty price books: nothing to read but the cache channel, which stays empty.
    with factory() as session:
        assert session.query(UpstreamPriceORM).count() == 0
        assert session.query(ChargePriceORM).count() == 0

        event = UsageEvent(
            event_id="evt_ui_priced",
            started_at_ms=now,
            http_status=200,
            public_model="flagship",
            upstream_model="glm-5.3-air",
            provider=seed["upstream_id"],
            api_key_id=seed["key_id"],
            input_tokens=1000,
            output_tokens=2000,
            total_tokens=3000,
        )
        assert usage_ingest.ingest_usage_events(session, [event]) == 1
        usage_ingest.process_billing(session)
        session.commit()

        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_ui_priced").one()
        charge = (
            session.query(ChargeEntryORM).filter_by(gateway_event_id="evt_ui_priced").one()
        )
        assert cost.amount_micro == 22_500  # 1000 x 2.5 + 2000 x 10
        assert cost.status == "ok"
        assert cost.upstream_model_id == model_id
        # 22_500 x 1.2 = 27_000, rounded once at the micro boundary.
        assert charge.amount_micro == 27_000
        assert charge.status == "ok"
        assert charge.price_version_id == model_id
        assert session.get(UserORM, seed["user_id"]).balance_micro == 50_000_000 - 27_000


def test_unpriced_cache_costs_nothing_but_input_output_still_bill(
    client, engine_and_sessionmaker
):
    """ADR-020 cache exception: cache tokens follow the book price; absent = 0.

    With cache prices missing the cache tokens cost nothing (unpriced-cache),
    while input/output still bill from the model row. A cache_read row shows the
    book channel is still read for exactly those two items.
    """
    from l02_domain.models import UsageEvent
    from l04_repo.orm import UpstreamPriceORM
    from l05_service import usage_ingest

    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    now = now_ms()
    client.patch(
        "/admin/upstream-models/umdl_test",
        json={"cost_input_per_1m": "2.5", "cost_output_per_1m": "10", "markup": "1.2"},
    )
    with factory() as session:
        session.add(
            UpstreamPriceORM(
                id="upr_cache",
                vendor_id=seed["vendor_id"],
                upstream_model="glm-5.3",
                item="cache_read",
                unit_price_micro=1_000_000,
                currency="CNY",
                effective_from_ms=0,
                version=1,
                created_at_ms=now,
            )
        )
        session.commit()

        event = UsageEvent(
            event_id="evt_cache",
            started_at_ms=now,
            http_status=200,
            public_model="flagship",
            upstream_model="glm-5.3",
            provider=seed["upstream_id"],
            api_key_id=seed["key_id"],
            input_tokens=1000,
            output_tokens=2000,
            total_tokens=3000,
            cache_read_tokens=500,
        )
        usage_ingest.ingest_usage_events(session, [event])
        usage_ingest.process_billing(session)
        session.commit()

        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_cache").one()
        charge = (
            session.query(ChargeEntryORM).filter_by(gateway_event_id="evt_cache").one()
        )
        # input 1000 x 2.5 + output 2000 x 10 + cache_read 500 x 1.0 = 23_000.
        assert cost.amount_micro == 23_000
        assert charge.amount_micro == 27_600  # 23_000 x 1.2
