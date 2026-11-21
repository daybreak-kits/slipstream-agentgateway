"""P2-8: the ingest/billing pipeline resolves references once per batch.

Regression test for the N+1 shape: a 500-row batch used to issue one dedupe
SELECT per ingested event plus several lookups per billed event (measured:
501 SELECTs to ingest and 4507 for one billing pass on the mixed batch below).
The pipeline now
preloads the reference rows (upstream models by name, upstreams by id, public
models by name, the cache price book by scope, api keys/users, and the existing
cost/charge entry ids) once outside the loop and resolves every event from those
maps, so the count stays constant in the batch size.

The digest pins every money-bearing field to the pre-refactor values: amounts,
statuses, currencies, price_version_ids, ledger deltas, daily aggregates and the
final balances must all be unchanged.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from sqlalchemy import event, func, select, text
from tests.conftest import seed_channel

from l02_domain.models import UsageEvent
from l04_repo.orm import (
    ChargeEntryORM,
    CostDailyORM,
    CostEntryORM,
    GatewayUsageEventORM,
    LedgerEntryORM,
    UpstreamModelORM,
    UpstreamPriceORM,
    UserDailyORM,
    UserORM,
)
from l05_service import usage_ingest

BATCH = 500
# Measured SELECT counts for this 500-row mixed batch:
#   refactored:    ingest 2 / billing 13 / recompute 17
#   pre-refactor:  ingest 501 / billing 4507 / recompute 603
# Thresholds keep a little headroom without letting an N+1 back in.
MAX_INGEST_SELECTS = 5
MAX_BILLING_SELECTS = 25
MAX_RECOMPUTE_SELECTS = 25
# sha256 of the deterministic billing-row digest produced by the pre-refactor code
# (all amounts/statuses/versions/ledger deltas/daily rows unchanged by the refactor).
# W7 t03 / ADR-030: the digest tuple dropped the retired vendor_id bucket and the
# cache price rows now key on upstream_model_id; the pinned value moved with the
# tuple shape while every amount/row count/balance stayed identical.
EXPECTED_DIGEST = "fe2e29d9c7fa94e6f4b5e6257b4e30236d81de228a601e6520d74e6f9d42b080"


class _SelectCounter:
    """Count SELECT statements executed on one engine (all other statements: total)."""

    def __init__(self) -> None:
        self.selects = 0
        self.total = 0

    def reset(self) -> None:
        self.selects = 0
        self.total = 0

    def __call__(self, conn, cursor, statement, parameters, context, executemany) -> None:
        self.total += 1
        if statement.lstrip()[:6].upper() == "SELECT":
            self.selects += 1


def _event(
    event_id: str,
    started_at_ms: int,
    seed: dict,
    *,
    http_status: int = 200,
    public_model: str = "flagship",
    upstream_model: str = "glm-5.3",
    provider: str | None = None,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> UsageEvent:
    return UsageEvent(
        event_id=event_id,
        started_at_ms=started_at_ms,
        http_status=http_status,
        public_model=public_model,
        upstream_model=upstream_model,
        provider=seed["upstream_id"] if provider is None else provider,
        api_key_id=seed["key_id"],
        input_tokens=1000,
        output_tokens=500,
        total_tokens=1500,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
    )


def _billed_channel(engine_and_sessionmaker) -> tuple:
    """Seeded channel + model-row prices + cache book + one NULL-cost model row."""
    engine, factory = engine_and_sessionmaker
    seed = seed_channel(engine, factory)
    now = 1_800_000_000_000
    # The issued api key id is random; pin it so the row digest below is
    # comparable across runs and between the old and refactored pipelines.
    with factory() as session:
        session.execute(
            text("UPDATE api_keys SET id = 'key_test' WHERE id = :old"),
            {"old": seed["key_id"]},
        )
        session.commit()
    seed["key_id"] = "key_test"
    with factory() as session:
        model = session.get(UpstreamModelORM, seed["upstream_model_id"])
        model.cost_input_per_1m = Decimal("2.5")
        model.cost_output_per_1m = Decimal("10")
        model.markup = Decimal("1.2")
        session.add_all(
            [
                UpstreamModelORM(
                    id="umdl_null",
                    upstream_id=seed["upstream_id"],
                    name="glm-null",
                    model_type="chat",
                    created_at_ms=now,
                ),
                # Failed rows keep currency "" on their 0-amount cost entry while
                # priced rows carry "CNY"; cost_daily's PK has no currency column,
                # so one model/day cannot mix the two (pre-existing shape, out of
                # scope here): failed rows use their own model row.
                UpstreamModelORM(
                    id="umdl_fail",
                    upstream_id=seed["upstream_id"],
                    name="glm-fail",
                    model_type="chat",
                    created_at_ms=now,
                ),
            ]
        )
        # Two versions of the cache_read price: an old one effective at epoch 0
        # (the price_version snapshot) and a newer one effective at 1s (the
        # cache-token numerator). No cache_write row = unpriced cache item.
        session.add_all(
            [
                UpstreamPriceORM(
                    id="upr_cache_read",
                    upstream_model_id=seed["upstream_model_id"],
                    item="cache_read",
                    unit_price_micro=2_000_000,
                    currency="CNY",
                    effective_from_ms=1000,
                    version=2,
                    created_at_ms=now,
                ),
                UpstreamPriceORM(
                    id="upr_cache_read_old",
                    upstream_model_id=seed["upstream_model_id"],
                    item="cache_read",
                    unit_price_micro=1_000_000,
                    currency="CNY",
                    effective_from_ms=0,
                    version=1,
                    created_at_ms=now,
                ),
            ]
        )
        session.commit()
    return engine, factory, seed, now


def _mixed_events(seed: dict, now: int) -> list[UsageEvent]:
    """500 rows covering every branch: priced, failed, unknown, cache, unpriced, ghost alias."""
    events: list[UsageEvent] = []
    idx = 0

    def add(count: int, **kwargs) -> None:
        nonlocal idx
        for _ in range(count):
            event_id = f"evt_{idx:04d}"
            events.append(_event(event_id, now + idx * 1000, seed, **kwargs))
            idx += 1

    add(250)  # priced rows: model-row cost + markup charge
    add(50, http_status=500, upstream_model="glm-fail")  # failed rows: cost 0, no charge
    add(50, upstream_model="ghost-model")  # no model row at all -> unpriced cost
    add(50, cache_read_tokens=500, cache_write_tokens=100)  # cache book channel
    add(50, upstream_model="glm-null")  # model row with NULL costs -> unpriced
    add(50, public_model="ghost-public", provider="ups_unknown")  # unknown public/provider
    assert len(events) == BATCH
    return events


def _digest(factory) -> dict:
    """Deterministic digest of every billing row (ids/timestamps are random: excluded)."""
    with factory() as session:
        cost = [
            (
                row.gateway_event_id,
                row.upstream_model_id,
                row.input_tokens,
                row.output_tokens,
                row.cache_read_tokens,
                row.cache_write_tokens,
                row.amount_micro,
                row.currency,
                row.price_version_id,
                row.status,
            )
            for row in session.scalars(
                select(CostEntryORM).order_by(CostEntryORM.gateway_event_id)
            ).all()
        ]
        charge = [
            (
                row.gateway_event_id,
                row.user_id,
                row.api_key_id,
                row.public_model_id,
                row.input_tokens,
                row.output_tokens,
                row.amount_micro,
                row.currency,
                row.price_version_id,
                row.status,
            )
            for row in session.scalars(
                select(ChargeEntryORM).order_by(ChargeEntryORM.gateway_event_id)
            ).all()
        ]
        ledger = [
            (
                row.kind,
                row.user_id,
                row.delta_micro,
                row.balance_after_micro,
                row.currency,
                row.ref_type,
            )
            for row in session.scalars(select(LedgerEntryORM)).all()
        ]
        daily_cost = [
            (
                row.day,
                row.upstream_model,
                row.requests,
                row.input_tokens,
                row.output_tokens,
                row.amount_micro,
                row.currency,
            )
            for row in session.scalars(select(CostDailyORM)).all()
        ]
        daily_user = [
            (
                row.day,
                row.user_id,
                row.requests,
                row.input_tokens,
                row.output_tokens,
                row.amount_micro,
                row.currency,
            )
            for row in session.scalars(select(UserDailyORM)).all()
        ]
        balances = sorted(
            (row.id, row.balance_micro)
            for row in session.scalars(select(UserORM)).all()
        )
    body = {
        "cost": cost,
        "charge": charge,
        "ledger": sorted(ledger),
        "daily_cost": sorted(daily_cost),
        "daily_user": sorted(daily_user),
        "balances": balances,
    }
    return {
        "digest": hashlib.sha256(
            json.dumps(body, sort_keys=True, default=str).encode()
        ).hexdigest(),
        "cost_rows": len(cost),
        "charge_rows": len(charge),
        "ledger_rows": len(ledger),
        "daily_cost_rows": len(daily_cost),
        "daily_user_rows": len(daily_user),
        "balances": balances,
    }


def test_500_row_batch_resolves_in_a_constant_number_of_selects(
    engine_and_sessionmaker,
) -> None:
    engine, factory, seed, now = _billed_channel(engine_and_sessionmaker)
    events = _mixed_events(seed, now)
    counter = _SelectCounter()
    event.listen(engine, "before_cursor_execute", counter)
    recompute_ids = [f"evt_{idx:04d}" for idx in range(0, BATCH, 10)]
    try:
        counter.reset()
        with factory() as session:
            assert usage_ingest.ingest_usage_events(session, events) == BATCH
            session.commit()
        ingest_selects = counter.selects

        counter.reset()
        with factory() as session:
            first = usage_ingest.process_billing(session)
            session.commit()
        billing_selects = counter.selects

        counter.reset()
        with factory() as session:
            second = usage_ingest.process_billing(session, recompute_event_ids=recompute_ids)
            session.commit()
        recompute_selects = counter.selects
    finally:
        event.remove(engine, "before_cursor_execute", counter)

    digest = _digest(factory)
    detail = (
        f"ingest SELECTs={ingest_selects} (max {MAX_INGEST_SELECTS}); "
        f"billing SELECTs={billing_selects} (max {MAX_BILLING_SELECTS}); "
        f"recompute SELECTs={recompute_selects} (max {MAX_RECOMPUTE_SELECTS}); "
        f"digest={digest}"
    )
    assert ingest_selects <= MAX_INGEST_SELECTS, detail
    assert billing_selects <= MAX_BILLING_SELECTS, detail
    assert recompute_selects <= MAX_RECOMPUTE_SELECTS, detail

    # Entry counts per pass are part of the contract (recompute replaces, never stacks).
    assert first == {"cost_entries": BATCH, "charge_entries": 450, "recomputed": 0}
    assert second == {"cost_entries": 50, "charge_entries": 45, "recomputed": 95}
    assert digest["cost_rows"] == BATCH
    assert digest["charge_rows"] == 450
    assert digest["digest"] == EXPECTED_DIGEST, detail


def test_ingest_deduplicates_ids_within_one_batch(engine_and_sessionmaker) -> None:
    """A page holding the same event_id twice adds it once instead of failing the flush."""
    _, factory = engine_and_sessionmaker
    seed = seed_channel(engine_and_sessionmaker[0], factory)
    started = 1_800_000_000_000
    events = [_event("evt_dup", started, seed) for _ in range(3)]
    events.append(_event("evt_uniq", started + 1, seed))
    with factory() as session:
        assert usage_ingest.ingest_usage_events(session, events) == 2
        session.commit()
        count = session.scalar(select(func.count()).select_from(GatewayUsageEventORM))
        assert count == 2
        # Replays still add nothing (idempotent ingest).
        assert usage_ingest.ingest_usage_events(session, events) == 0
        session.commit()
