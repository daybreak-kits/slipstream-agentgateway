"""Golden rule: event -> cost/charge entries -> daily read models use one number.

ADR-020 pricing: the model row owns cost and markup; only the cache items still
live on the price book, so this test seeds no book row at all (unpriced cache).
"""

from __future__ import annotations

from decimal import Decimal

from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import (
    ChargeEntryORM,
    CostDailyORM,
    CostEntryORM,
    LedgerEntryORM,
    UpstreamModelORM,
    UserDailyORM,
    UserORM,
)
from l05_service import usage_ingest


def _seed_prices(factory, seed: dict, now: int) -> None:
    """Model-row cost (CNY/1M) + markup; both price books stay empty on purpose."""
    with factory() as session:
        model = session.get(UpstreamModelORM, seed["upstream_model_id"])
        model.cost_input_per_1m = Decimal("2.5")
        model.cost_output_per_1m = Decimal("10")
        model.markup = Decimal("1.2")
        session.commit()


def test_one_event_prices_cost_once_and_writes_consistent_rows(
    engine_and_sessionmaker,
) -> None:
    _, factory = engine_and_sessionmaker
    seed = seed_channel(engine_and_sessionmaker[0], factory)
    now = 1_800_000_000_000
    _seed_prices(factory, seed, now)

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
        # 1000 x 2.5 + 2000 x 10 = 22_500 micro cost; x 1.2 markup = 27_000 charge.
        assert cost.amount_micro == 22_500
        assert cost.status == "ok"
        assert charge.amount_micro == 27_000
        assert charge.status == "ok"
        assert result["cost_entries"] == 1
        assert result["charge_entries"] == 1

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
        ledger_before = session.query(LedgerEntryORM).count()
        balance_before = session.get(UserORM, seed["user_id"]).balance_micro
        usage_ingest.process_billing(session, recompute_event_ids=["evt_golden"])
        session.commit()
        assert session.query(CostEntryORM).count() == 1
        assert session.query(ChargeEntryORM).count() == 1
        assert (
            session.query(CostEntryORM).one().amount_micro,
            session.query(ChargeEntryORM).one().amount_micro,
        ) == (22_500, 27_000)
        # The charge was replaced, not stacked: same ledger row count, and the
        # balance was debited exactly once for the event.
        assert session.query(LedgerEntryORM).count() == ledger_before
        assert session.get(UserORM, seed["user_id"]).balance_micro == balance_before
