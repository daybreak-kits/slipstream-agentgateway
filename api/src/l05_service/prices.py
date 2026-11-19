"""Price books and billing reports (ADR-011 / docs/contracts/billing.md).

Two independent books - upstream_prices (what we pay vendors) and charge_prices
(what users pay us) - each versioned by append-only rows; a price change creates
a new version and never rewrites history. Amounts are integer micro units;
missing prices produce status=unpriced with a NULL amount (never a silent 0).
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ChargeEntryORM,
    ChargePriceORM,
    CostEntryORM,
    FxSnapshotORM,
    UpstreamPriceORM,
)
from l05_service import money
from l05_service.money import CHARGE_MODES, MICRO, PRICE_ITEMS


def create_upstream_price(
    session: Session,
    *,
    vendor_id: str,
    upstream_model: str,
    item: str,
    unit_price_micro: int,
    currency: str,
    effective_from_ms: int | None = None,
) -> UpstreamPriceORM:
    """Append a new upstream price version; version = max(existing) + 1 per scope."""
    if item not in PRICE_ITEMS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown price item: {item}",
            details={"item": item, "known": list(PRICE_ITEMS)},
        )
    if unit_price_micro < 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "unit_price_micro must be >= 0")
    latest = session.scalars(
        select(UpstreamPriceORM)
        .where(
            UpstreamPriceORM.vendor_id == vendor_id,
            UpstreamPriceORM.upstream_model == upstream_model,
            UpstreamPriceORM.item == item,
        )
        .order_by(UpstreamPriceORM.version.desc())
    ).first()
    row = UpstreamPriceORM(
        id=new_id("upr"),
        vendor_id=vendor_id,
        upstream_model=upstream_model,
        item=item,
        unit_price_micro=unit_price_micro,
        currency=currency,
        effective_from_ms=effective_from_ms if effective_from_ms is not None else now_ms(),
        version=(latest.version + 1) if latest else 1,
        created_at_ms=now_ms(),
    )
    session.add(row)
    session.flush()
    return row


def create_charge_price(
    session: Session,
    *,
    public_model_id: str,
    item: str,
    mode: str,
    value: int,
    currency: str,
    effective_from_ms: int | None = None,
) -> ChargePriceORM:
    """Append a new charge price version (markup ratio or fixed micro unit price)."""
    if item not in PRICE_ITEMS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown price item: {item}",
            details={"item": item, "known": list(PRICE_ITEMS)},
        )
    if mode not in CHARGE_MODES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown charge mode: {mode}",
            details={"mode": mode, "known": list(CHARGE_MODES)},
        )
    if value < 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "charge price value must be >= 0")
    latest = session.scalars(
        select(ChargePriceORM)
        .where(
            ChargePriceORM.public_model_id == public_model_id,
            ChargePriceORM.item == item,
        )
        .order_by(ChargePriceORM.version.desc())
    ).first()
    row = ChargePriceORM(
        id=new_id("cpr"),
        public_model_id=public_model_id,
        item=item,
        mode=mode,
        value=value,
        currency=currency,
        effective_from_ms=effective_from_ms if effective_from_ms is not None else now_ms(),
        version=(latest.version + 1) if latest else 1,
        created_at_ms=now_ms(),
    )
    session.add(row)
    session.flush()
    return row


def effective_upstream_price(
    session: Session, vendor_id: str, upstream_model: str, item: str, at_ms: int
) -> UpstreamPriceORM | None:
    """Latest price version effective at `at_ms` (max effective_from, then version)."""
    return session.scalars(
        select(UpstreamPriceORM)
        .where(
            UpstreamPriceORM.vendor_id == vendor_id,
            UpstreamPriceORM.upstream_model == upstream_model,
            UpstreamPriceORM.item == item,
            UpstreamPriceORM.effective_from_ms <= at_ms,
        )
        .order_by(UpstreamPriceORM.effective_from_ms.desc(), UpstreamPriceORM.version.desc())
    ).first()


def effective_charge_price(
    session: Session, public_model_id: str, item: str, at_ms: int
) -> ChargePriceORM | None:
    """Latest charge version effective at `at_ms`."""
    return session.scalars(
        select(ChargePriceORM)
        .where(
            ChargePriceORM.public_model_id == public_model_id,
            ChargePriceORM.item == item,
            ChargePriceORM.effective_from_ms <= at_ms,
        )
        .order_by(ChargePriceORM.effective_from_ms.desc(), ChargePriceORM.version.desc())
    ).first()


def cost_micro_from_prices(
    tokens_by_item: dict[str, int], prices: dict[str, UpstreamPriceORM], per_request_items: int
) -> int | None:
    """Integer micro cost for one request; None signals an unpriced item.

    Per-item numerators (tokens x micro-per-1M) are summed exactly and rounded
    ONCE per request entry (billing.md §5.5). per_request_items counts request
    fees (item=request scales by call, not by token).
    """
    numerator = money.cost_numerator(tokens_by_item, prices, per_request_items)
    if numerator is None:
        return None
    return money.round_micro(numerator, MICRO)


def charge_micro_from_cost(
    cost_numerator: int,
    charge_prices: dict[str, ChargePriceORM],
    tokens_by_item: dict[str, int],
    per_request_items: int,
) -> int | None:
    """Integer micro charge: markup applies the ratio to cost; fixed mirrors cost math.

    markup: value is a ratio in ten-thousandths over the exact cost numerator,
    rounded once (12000 = 1.2x). fixed: unit prices per item like the cost book.
    Mixing fixed items with a markup request price is a validation error.
    Returns None when any needed price is missing (unpriced).
    """
    return money.charge_from_cost_numerator(
        cost_numerator, charge_prices, tokens_by_item, per_request_items
    )


def unpriced_lists(session: Session) -> dict[str, list[dict]]:
    """The two pending-price lists (billing.md §7): cost + charge, NULL amounts only."""
    cost_rows = session.scalars(
        select(CostEntryORM).where(CostEntryORM.status == "unpriced")
    ).all()
    charge_rows = session.scalars(
        select(ChargeEntryORM).where(ChargeEntryORM.status == "unpriced")
    ).all()
    return {
        "cost": [
            {
                "id": row.id,
                "gateway_event_id": row.gateway_event_id,
                "upstream_model_id": row.upstream_model_id,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "created_at_ms": row.created_at_ms,
            }
            for row in cost_rows
        ],
        "charge": [
            {
                "id": row.id,
                "gateway_event_id": row.gateway_event_id,
                "public_model_id": row.public_model_id,
                "input_tokens": row.input_tokens,
                "output_tokens": row.output_tokens,
                "created_at_ms": row.created_at_ms,
            }
            for row in charge_rows
        ],
    }


def margin_report(session: Session, from_ms: int = 0, to_ms: int = 0) -> dict:
    """Gross margin by currency: charge - cost inside [from_ms, to_ms).

    Window defaults cover everything: from_ms <= 0 means "since the beginning"
    and to_ms <= 0 means "up to now", so an argument-less call reports all time
    instead of the empty [0, 0) window. The response echoes the window used.

    Cross-currency totals convert into report_currency via the latest manual
    fx snapshot (billing.md §5.3); rows keep their native currency sums too.
    The report currency needs no snapshot (it is its own unit, rate 1); when a
    foreign currency has no rate yet, the converted total stays None and the
    missing currencies are listed in fx_missing instead of being guessed.
    Token amounts in this report are estimates (cache folded into input).

    Sums run in SQL (GROUP BY currency over billed rows only); the retired
    Python row loop is kept as a parity copy in
    tests/integration/test_reports_sql_parity.py.
    """
    settings = get_settings()
    report_currency = (settings.report_currency or "").strip() or "CNY"
    effective_from = max(int(from_ms or 0), 0)
    effective_to = int(to_ms or 0) if int(to_ms or 0) > 0 else now_ms() + 1

    def _sums_by_currency(model, *status_conditions) -> dict[str, int]:
        """SUM(amount_micro) per currency; failed rows carry no currency and are skipped."""
        rows = session.execute(
            select(model.currency, func.sum(model.amount_micro))
            .where(
                model.created_at_ms >= effective_from,
                model.created_at_ms < effective_to,
                model.amount_micro.is_not(None),
                *status_conditions,
            )
            .group_by(model.currency)
        ).all()
        return {
            (currency or "").strip(): int(total)
            for currency, total in rows
            if (currency or "").strip() and total is not None
        }

    charges = _sums_by_currency(
        ChargeEntryORM, ChargeEntryORM.status.in_(("ok", "free"))
    )
    costs = _sums_by_currency(CostEntryORM, CostEntryORM.status == "ok")
    currencies = sorted(set(charges) | set(costs))
    fx: dict[str, int | None] = {}
    converted_charges = 0
    converted_costs = 0
    for currency in currencies:
        rate: int | None
        if currency.upper() == report_currency.upper():
            # Report currency is its own unit: rate 1, no fx snapshot required.
            rate = MICRO
        else:
            snapshot = session.scalars(
                select(FxSnapshotORM)
                .where(FxSnapshotORM.currency == currency)
                .order_by(FxSnapshotORM.as_of_ms.desc())
            ).first()
            rate = snapshot.rate_micro if snapshot else None
        fx[currency] = rate
        if rate is not None:
            converted_charges += money.round_micro(charges.get(currency, 0) * rate, MICRO)
            converted_costs += money.round_micro(costs.get(currency, 0) * rate, MICRO)
    fx_missing = sorted(currency for currency, rate in fx.items() if rate is None)
    report_currency_total = None
    report_currency_charge: int | None = 0
    report_currency_cost: int | None = 0
    if currencies and not fx_missing:
        report_currency_total = converted_charges - converted_costs
        report_currency_charge = converted_charges
        report_currency_cost = converted_costs
    elif fx_missing:
        # Partial conversion would understate the margin: report "unknown" instead.
        report_currency_charge = None
        report_currency_cost = None
    return {
        "from_ms": effective_from,
        "to_ms": effective_to,
        "report_currency": report_currency,
        "by_currency": {
            currency: {
                "charge_micro": charges.get(currency, 0),
                "cost_micro": costs.get(currency, 0),
                "margin_micro": charges.get(currency, 0) - costs.get(currency, 0),
                "fx_rate_micro_to_report": fx[currency],
            }
            for currency in currencies
        },
        "report_currency_margin_micro": report_currency_total,
        "report_currency_charge_micro": report_currency_charge,
        "report_currency_cost_micro": report_currency_cost,
        "fx_missing": fx_missing,
        "estimate_note": "token amounts fold cache into input (stage B pending)",
    }


def put_fx_snapshot(
    session: Session, *, currency: str, rate_micro: int, source: str = "manual"
) -> FxSnapshotORM:
    """Manual rate upsert (one row per currency+as_of); never automatic."""
    as_of = now_ms()
    row = FxSnapshotORM(
        currency=currency,
        as_of_ms=as_of,
        rate_micro=rate_micro,
        source=source,
        created_at_ms=as_of,
    )
    session.add(row)
    session.flush()
    return row
