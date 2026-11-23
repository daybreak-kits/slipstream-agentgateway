"""Price books and billing reports (ADR-011 / ADR-020 / billing.md).

The model rows own cost and markup (ADR-020). What is left of the upstream price
book is the cache channel: cache_read / cache_write are not columns of a model
row, so those two items are still versioned here - append-only, a price change
creates a new version and never rewrites history. The charge book (charge_prices)
is retired: spend is cost x the model row's markup. Amounts are integer micro
units; missing prices produce status=unpriced with a NULL amount (never a silent 0).

ADR-030: the book has exactly one scope key - the upstream model row
(upstream_model_id). The legacy vendor_id + upstream_model pair left with the
vendor domain (W7 t03).
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
    CostEntryORM,
    FxSnapshotORM,
    UpstreamModelORM,
    UpstreamPriceORM,
)
from l05_service import money
from l05_service.money import MICRO, PRICE_ITEMS


def _price_scope(*, upstream_model_id: str | None) -> tuple[list, dict[str, str]]:
    """WHERE conditions and key columns of one price scope (ADR-030).

    The upstream model row is the only scope: a missing key is a 422 - the
    scope is never guessed, because guessing would price a row under the wrong
    scope.
    """
    if not upstream_model_id:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "缓存价需要一个归属键：upstream_model_id",
            details={"upstream_model_id": upstream_model_id},
        )
    return (
        [UpstreamPriceORM.upstream_model_id == upstream_model_id],
        {"upstream_model_id": upstream_model_id},
    )


def create_upstream_price(
    session: Session,
    *,
    item: str,
    unit_price_micro: int,
    currency: str,
    effective_from_ms: int | None = None,
    upstream_model_id: str | None = None,
) -> UpstreamPriceORM:
    """Append a new upstream price version; version = max(existing) + 1 per scope.

    Only the cache items remain writable (ADR-020); input / output / request
    prices are rejected because billing never reads them again.

    The scope is the upstream model row (upstream_model_id); versions are
    counted per scope.
    """
    if item not in PRICE_ITEMS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown price item: {item}",
            details={"item": item, "known": list(PRICE_ITEMS)},
        )
    if item not in ("cache_read", "cache_write"):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "ADR-020: cost lives on the upstream model row; this book only holds cache prices",
            details={"item": item, "known": ["cache_read", "cache_write"]},
        )
    if unit_price_micro < 0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "unit_price_micro must be >= 0")
    conditions, key = _price_scope(upstream_model_id=upstream_model_id)
    if session.get(UpstreamModelORM, key["upstream_model_id"]) is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream model not found: {key['upstream_model_id']}")
    latest = session.scalars(
        select(UpstreamPriceORM)
        .where(*conditions, UpstreamPriceORM.item == item)
        .order_by(UpstreamPriceORM.version.desc())
    ).first()
    row = UpstreamPriceORM(
        id=new_id("upr"),
        item=item,
        unit_price_micro=unit_price_micro,
        currency=currency,
        effective_from_ms=effective_from_ms if effective_from_ms is not None else now_ms(),
        version=(latest.version + 1) if latest else 1,
        created_at_ms=now_ms(),
        **key,
    )
    session.add(row)
    session.flush()
    return row


def effective_upstream_price(
    session: Session,
    item: str,
    at_ms: int,
    *,
    upstream_model_id: str | None = None,
) -> UpstreamPriceORM | None:
    """Latest price version effective at `at_ms` (max effective_from, then version)."""
    conditions, _key = _price_scope(upstream_model_id=upstream_model_id)
    return session.scalars(
        select(UpstreamPriceORM)
        .where(
            *conditions,
            UpstreamPriceORM.item == item,
            UpstreamPriceORM.effective_from_ms <= at_ms,
        )
        .order_by(UpstreamPriceORM.effective_from_ms.desc(), UpstreamPriceORM.version.desc())
    ).first()


def list_upstream_prices(
    session: Session,
    *,
    upstream_model_id: str = "",
    item: str = "",
    at_ms: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[UpstreamPriceORM]:
    """Price rows of one scope; with `at_ms` only the price in force at that instant.

    Filters are ANDed over the upstream model scope. `at_ms` answers "which price
    applies then": per scope the newest version with effective_from_ms <= at_ms
    wins, exactly like effective_upstream_price.
    """
    conditions = []
    if upstream_model_id:
        conditions.append(UpstreamPriceORM.upstream_model_id == upstream_model_id)
    if item:
        conditions.append(UpstreamPriceORM.item == item)
    if at_ms is not None:
        conditions.append(UpstreamPriceORM.effective_from_ms <= at_ms)
    statement = select(UpstreamPriceORM)
    if conditions:
        statement = statement.where(*conditions)
    if at_ms is None:
        return list(session.scalars(statement.offset(offset).limit(limit)).all())
    rows = session.scalars(
        statement.order_by(
            UpstreamPriceORM.effective_from_ms.desc(), UpstreamPriceORM.version.desc()
        )
    ).all()
    # One row per scope (the effective one). The book holds a few dozen rows,
    # so the window is resolved here instead of in SQL.
    effective: list[UpstreamPriceORM] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        scope = (row.upstream_model_id, row.item)
        if scope in seen:
            continue
        seen.add(scope)
        effective.append(row)
    return effective[offset : offset + limit]


def cost_micro_from_prices(
    tokens_by_item: dict[str, int], prices: dict[str, UpstreamPriceORM], per_request_items: int
) -> int | None:
    """Integer micro cost for the cache items of one request; None when unpriced.

    Per-item numerators (tokens x micro-per-1M) are summed exactly and rounded
    ONCE (billing.md §5.5); this covers only what the book still holds (ADR-020
    cache exception) - input/output come from the model row.
    """
    numerator = money.cost_numerator(tokens_by_item, prices, per_request_items)
    if numerator is None:
        return None
    return money.round_micro(numerator, MICRO)


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
    report_currency = (settings.report_currency or "").strip() or "USD"
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
