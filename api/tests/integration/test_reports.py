"""Report regressions: margin window defaults, currency hygiene, overview money.

Guards the defects t1 found: an argument-less margin call used to report the empty
[0, 0) window, failed requests leaked a bogus "" currency bucket, the report
currency needed an fx snapshot (now rate 1), and overview money ignored the window
while its card claims "today".
"""

from __future__ import annotations

from l01_core.timeutil import now_ms
from l04_repo.orm import ChargeEntryORM, CostEntryORM

DAY_MS = 86_400_000


def _charge(
    session, *, rid: str, amount: int, currency: str, at_ms: int, status: str = "ok"
) -> None:
    session.add(
        ChargeEntryORM(
            id=rid,
            gateway_event_id="evt_" + rid,
            user_id="usr_1",
            public_model_id="pmdl_1",
            input_tokens=10,
            output_tokens=5,
            amount_micro=amount,
            currency=currency,
            price_version_id="cp_1",
            status=status,
            created_at_ms=at_ms,
        )
    )


def _cost(session, *, rid: str, amount: int, currency: str, at_ms: int) -> None:
    session.add(
        CostEntryORM(
            id=rid,
            gateway_event_id="evt_" + rid,
            vendor_id="vend_1",
            upstream_model_id="umdl_1",
            input_tokens=10,
            output_tokens=5,
            amount_micro=amount,
            currency=currency,
            price_version_id="up_1",
            status="ok",
            created_at_ms=at_ms,
        )
    )


def _seed_money(factory) -> None:
    now = now_ms()
    with factory() as session:
        _charge(session, rid="ce_today", amount=1_000_000, currency="CNY", at_ms=now - 1000)
        _cost(session, rid="co_today", amount=800_000, currency="CNY", at_ms=now - 1000)
        # failed request: zero amount, no currency (must not create a "" bucket)
        _charge(session, rid="ce_failed", amount=0, currency="", at_ms=now - 900, status="free")
        _cost(session, rid="co_failed", amount=0, currency="", at_ms=now - 900)
        # old money, outside a "today" window
        _charge(session, rid="ce_old", amount=5_000_000, currency="CNY", at_ms=now - 2 * DAY_MS)
        _cost(session, rid="co_old", amount=4_000_000, currency="CNY", at_ms=now - 2 * DAY_MS)
        session.commit()


def test_margin_defaults_cover_all_time(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_money(factory)
    body = client.get("/admin/reports/margin").json()
    assert body["from_ms"] == 0
    assert body["to_ms"] > now_ms() - 60_000
    assert "" not in body["by_currency"]
    cny = body["by_currency"]["CNY"]
    assert cny["charge_micro"] == 6_000_000
    assert cny["cost_micro"] == 4_800_000
    assert cny["margin_micro"] == 1_200_000
    assert cny["fx_rate_micro_to_report"] == 1_000_000  # report currency is its own unit
    assert body["report_currency_margin_micro"] == 1_200_000
    assert body["fx_missing"] == []


def test_margin_respects_explicit_window(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_money(factory)
    now = now_ms()
    body = client.get(
        f"/admin/reports/margin?from_ms={now - DAY_MS}&to_ms={now}"
    ).json()
    assert body["by_currency"]["CNY"]["charge_micro"] == 1_000_000
    assert body["report_currency_margin_micro"] == 200_000
    empty = client.get("/admin/reports/margin?from_ms=1&to_ms=2").json()
    assert empty["by_currency"] == {}
    assert empty["report_currency_margin_micro"] is None


def test_margin_foreign_currency_needs_fx_then_converts(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    now = now_ms()
    with factory() as session:
        _cost(session, rid="co_usd", amount=500_000, currency="USD", at_ms=now - 1000)
        session.commit()
    body = client.get("/admin/reports/margin").json()
    assert body["fx_missing"] == ["USD"]
    assert body["by_currency"]["USD"]["fx_rate_micro_to_report"] is None
    assert body["report_currency_margin_micro"] is None
    assert body["report_currency_cost_micro"] is None

    client.put("/admin/fx", json={"currency": "USD", "rate_micro": 7_200_000})
    converted = client.get("/admin/reports/margin").json()
    assert converted["fx_missing"] == []
    assert converted["by_currency"]["USD"]["fx_rate_micro_to_report"] == 7_200_000
    assert converted["report_currency_cost_micro"] == 3_600_000
    assert converted["report_currency_margin_micro"] == -3_600_000


def test_overview_money_follows_window(client, engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_money(factory)
    now = now_ms()
    today = client.get(
        f"/admin/reports/overview?from_ms={now - DAY_MS}&to_ms={now}"
    ).json()
    assert today["charge_micro"] == 1_000_000
    assert today["cost_micro"] == 800_000
    assert today["margin_micro"] == 200_000
    assert today["currency"] == "CNY"
    assert today["money_scope"] == "converted"
    assert today["fx_missing"] == []

    all_time = client.get("/admin/reports/overview").json()
    assert all_time["money_scope"] == "converted"
    assert all_time["charge_micro"] == 6_000_000
    assert all_time["cost_micro"] == 4_800_000
    assert all_time["margin_micro"] == 1_200_000
