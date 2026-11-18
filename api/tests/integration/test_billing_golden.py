"""Golden rule: event -> cost/charge entries -> daily read models use one number."""

from __future__ import annotations

from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import (
    ChargeEntryORM,
    ChargePriceORM,
    CostDailyORM,
    CostEntryORM,
    LedgerEntryORM,
    UpstreamPriceORM,
    UserDailyORM,
    UserORM,
)
from l05_service import money, usage_ingest


def _seed_prices(factory, seed: dict, now: int) -> None:
    with factory() as session:
        session.add_all(
            [
                UpstreamPriceORM(
                    id="upr_in",
                    vendor_id=seed["vendor_id"],
                    upstream_model="glm-5.3",
                    item="input",
                    unit_price_micro=2_500_000,
                    currency="CNY",
                    effective_from_ms=0,
                    version=1,
                    created_at_ms=now,
                ),
                UpstreamPriceORM(
                    id="upr_out",
                    vendor_id=seed["vendor_id"],
                    upstream_model="glm-5.3",
                    item="output",
                    unit_price_micro=10_000_000,
                    currency="CNY",
                    effective_from_ms=0,
                    version=1,
                    created_at_ms=now,
                ),
                ChargePriceORM(
                    id="cpr_markup",
                    public_model_id=seed["public_id"],
                    item="request",
                    mode="markup",
                    value=12_000,
                    currency="CNY",
                    effective_from_ms=0,
                    version=1,
                    created_at_ms=now,
                ),
            ]
        )
        session.commit()


def test_one_event_prices_cost_once_and_writes_consistent_rows(
    engine_and_sessionmaker, monkeypatch
) -> None:
    _, factory = engine_and_sessionmaker
    seed = seed_channel(engine_and_sessionmaker[0], factory)
    now = 1_800_000_000_000
    _seed_prices(factory, seed, now)

    calls = 0
    original = money.cost_numerator

    def counting(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(money, "cost_numerator", counting)

    event = UsageEvent(
        event_id="evt_golden",
        started_at_ms=now,
        http_status=200,
        public_model="flagship",
        upstream_model="glm-5.3",
        provider=seed["upstream_id"],
        api_key_id=seed["key_id"],
        input_tokens=1000,
        output_tokens=2000,
        total_tokens=3000,
    )
    with factory() as session:
        assert usage_ingest.ingest_usage_events(session, [event]) == 1
        result = usage_ingest.process_billing(session)
        session.commit()

        cost = session.query(CostEntryORM).filter_by(gateway_event_id="evt_golden").one()
        charge = session.query(ChargeEntryORM).filter_by(gateway_event_id="evt_golden").one()
        # 22_500 micro cost x 1.2 markup = 27_000 micro charge, rounded once each.
        assert cost.amount_micro == 22_500
        assert cost.status == "ok"
        assert charge.amount_micro == 27_000
        assert charge.status == "ok"
        assert result["cost_entries"] == 1
        assert result["charge_entries"] == 1
        assert calls == 1, "the markup book must reuse the cost pass, not re-price"

        user = session.get(UserORM, seed["user_id"])
        assert user.balance_micro == 50_000_000 - 27_000
        ledger = session.query(LedgerEntryORM).filter_by(ref_id=charge.id).one()
        assert ledger.delta_micro == -27_000
        assert ledger.balance_after_micro == user.balance_micro

        day = usage_ingest._day_of(now)
        daily = session.query(UserDailyORM).filter_by(day=day).one()
        assert daily.amount_micro == 27_000
        cost_daily = session.query(CostDailyORM).filter_by(day=day).one()
        assert cost_daily.amount_micro == 22_500

        # Re-pricing is idempotent and still produces the same two numbers.
        usage_ingest.process_billing(session, recompute_event_ids=["evt_golden"])
        session.commit()
        assert session.query(CostEntryORM).count() == 1
        assert session.query(ChargeEntryORM).count() == 1
        assert (
            session.query(CostEntryORM).one().amount_micro,
            session.query(ChargeEntryORM).one().amount_micro,
        ) == (22_500, 27_000)
