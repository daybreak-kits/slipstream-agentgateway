"""Billing routes (ADR-011): price books, pending-price lists, margin, fx.

Price writes require billing:write (admin+owner only); every role can read.
Unpriced rows keep NULL amounts - the recompute endpoint re-prices after the
operator fills missing prices, without ever duplicating usage events.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from l04_repo.orm import (
    ChargeEntryORM,
    ChargePriceORM,
    CostEntryORM,
    FxSnapshotORM,
    UpstreamPriceORM,
)
from l05_service import auth, prices, pricing, usage_ingest
from l06_api.deps import page_params, require, session_of
from l06_api.schemas import ChargePriceCreate, FxPut, RecomputeIn, UpstreamPriceCreate

router = APIRouter(tags=["billing"])


@router.get("/admin/prices/upstream", dependencies=[Depends(require("prices:read"))])
def list_upstream_prices(
    session: Session = Depends(session_of), page_size: int = 50, offset: int = 0
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    rows = session.scalars(select(UpstreamPriceORM).offset(off).limit(limit)).all()
    return [
        {
            "id": row.id,
            "vendor_id": row.vendor_id,
            "upstream_model": row.upstream_model,
            "item": row.item,
            "unit_price_micro": row.unit_price_micro,
            "currency": row.currency,
            "effective_from_ms": row.effective_from_ms,
            "version": row.version,
        }
        for row in rows
    ]


@router.post(
    "/admin/prices/upstream",
    status_code=201,
    dependencies=[Depends(require("prices:write"))],
)
def create_upstream_price(
    payload: UpstreamPriceCreate, session: Session = Depends(session_of)
) -> dict:
    """Append a new price version; history is never rewritten (billing.md §5)."""
    row = prices.create_upstream_price(
        session,
        vendor_id=payload.vendor_id,
        upstream_model=payload.upstream_model,
        item=payload.item,
        unit_price_micro=payload.unit_price_micro,
        currency=payload.currency,
        effective_from_ms=payload.effective_from_ms,
    )
    session.commit()
    return {"id": row.id, "version": row.version}


@router.get("/admin/prices/charge", dependencies=[Depends(require("prices:read"))])
def list_charge_prices(
    session: Session = Depends(session_of), page_size: int = 50, offset: int = 0
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    rows = session.scalars(select(ChargePriceORM).offset(off).limit(limit)).all()
    return [
        {
            "id": row.id,
            "public_model_id": row.public_model_id,
            "item": row.item,
            "mode": row.mode,
            "value": row.value,
            "currency": row.currency,
            "effective_from_ms": row.effective_from_ms,
            "version": row.version,
        }
        for row in rows
    ]


@router.post(
    "/admin/prices/charge",
    status_code=201,
    dependencies=[Depends(require("prices:write"))],
)
def create_charge_price(
    payload: ChargePriceCreate, session: Session = Depends(session_of)
) -> dict:
    """markup: value=万分比 (12000 = 1.2x of cost); fixed: value=micro unit price."""
    row = prices.create_charge_price(
        session,
        public_model_id=payload.public_model_id,
        item=payload.item,
        mode=payload.mode,
        value=payload.value,
        currency=payload.currency,
        effective_from_ms=payload.effective_from_ms,
    )
    session.commit()
    return {"id": row.id, "version": row.version}


@router.get("/admin/unpriced", dependencies=[Depends(require("billing:cost"))])
def unpriced(session: Session = Depends(session_of)) -> dict:
    """The operator's pending-price worklist: cost + charge rows with NULL amounts."""
    return prices.unpriced_lists(session)


@router.post("/admin/unpriced/recompute", dependencies=[Depends(require("prices:write"))])
def recompute(payload: RecomputeIn, session: Session = Depends(session_of)) -> dict:
    """Re-price given events (or all unpriced ones) after filling missing prices."""
    event_ids = payload.event_ids
    if not event_ids:
        lists = prices.unpriced_lists(session)
        event_ids = [row["gateway_event_id"] for row in lists["cost"]] + [
            row["gateway_event_id"] for row in lists["charge"]
        ]
    result = usage_ingest.process_billing(session, recompute_event_ids=event_ids)
    session.commit()
    return result


@router.get("/admin/cost/entries", dependencies=[Depends(require("billing:cost"))])
def list_cost_entries(
    session: Session = Depends(session_of), page_size: int = 50, offset: int = 0
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    rows = session.scalars(select(CostEntryORM).offset(off).limit(limit)).all()
    return [
        {
            "id": row.id,
            "gateway_event_id": row.gateway_event_id,
            "vendor_id": row.vendor_id,
            "upstream_model_id": row.upstream_model_id,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "amount_micro": row.amount_micro,
            "currency": row.currency,
            "price_version_id": row.price_version_id,
            "status": row.status,
        }
        for row in rows
    ]


@router.get("/admin/charge/entries")
def list_charge_entries(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("billing:spend")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Spend rows joined with the matching cost row for the stacked money cell.

    cost_micro is the cost of the same gateway event; field_filter removes it
    for callers without billing:cost, so the merged cell degrades to spend only.
    """
    limit, off = page_params(page_size, offset)
    rows = session.scalars(select(ChargeEntryORM).offset(off).limit(limit)).all()
    event_ids = [row.gateway_event_id for row in rows]
    costs = {
        row.gateway_event_id: row.amount_micro
        for row in session.scalars(
            select(CostEntryORM).where(CostEntryORM.gateway_event_id.in_(event_ids))
        ).all()
    }
    payload = [
        {
            "id": row.id,
            "gateway_event_id": row.gateway_event_id,
            "user_id": row.user_id,
            "public_model_id": row.public_model_id,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "amount_micro": row.amount_micro,
            "cost_micro": costs.get(row.gateway_event_id),
            "currency": row.currency,
            "price_version_id": row.price_version_id,
            "status": row.status,
        }
        for row in rows
    ]
    return payload


@router.get("/admin/reports/margin", dependencies=[Depends(require("billing:cost"))])
def margin(
    session: Session = Depends(session_of), from_ms: int = 0, to_ms: int = 0
) -> dict:
    """Gross margin (charge - cost) per currency plus a report-currency total.

    Omitting the window reports all time: from_ms <= 0 means "since the
    beginning", to_ms <= 0 means "up to now". The response echoes the resolved
    from_ms/to_ms, so a UI can label the range it actually got.
    """
    return prices.margin_report(session, from_ms, to_ms)


@router.get("/admin/fx", dependencies=[Depends(require("prices:read"))])
def list_fx(session: Session = Depends(session_of)) -> list[dict]:
    rows = session.scalars(select(FxSnapshotORM)).all()
    return [
        {
            "currency": row.currency,
            "as_of_ms": row.as_of_ms,
            "rate_micro": row.rate_micro,
            "source": row.source,
        }
        for row in rows
    ]


@router.put("/admin/fx", dependencies=[Depends(require("prices:write"))])
def put_fx(payload: FxPut, session: Session = Depends(session_of)) -> dict:
    """Manual fx snapshot (billing.md §5.3); the latest row per currency wins."""
    row = prices.put_fx_snapshot(
        session, currency=payload.currency, rate_micro=payload.rate_micro, source=payload.source
    )
    session.commit()
    return {"currency": row.currency, "as_of_ms": row.as_of_ms, "rate_micro": row.rate_micro}


@router.get("/admin/prices/public-models", dependencies=[Depends(require("prices:read"))])
def public_model_prices(session: Session = Depends(session_of)) -> list[dict]:
    """Derived, read-only public prices: weighted average of member unit prices.

    Nothing is stored for a public model, so the average recomputes whenever a
    member's cost or markup changes - one truth source, no drift.
    """
    return pricing.public_model_price_rows(session)


@router.get("/admin/billing/ledger")
def billing_ledger(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("ledger:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Per-request money ledger: cost / spend / margin, field-filtered by permission.

    cost comes from cost_entries and spend from charge_entries; margin = spend -
    cost and markup = spend / cost (None when cost is 0 or unpriced, so a zero
    cost never divides). Without billing:cost the cost/margin keys are absent.
    """
    limit, off = page_params(page_size, offset)
    costs = {
        row.gateway_event_id: row for row in session.scalars(select(CostEntryORM)).all()
    }
    charges = {
        row.gateway_event_id: row for row in session.scalars(select(ChargeEntryORM)).all()
    }
    rows: list[dict] = []
    for event_id in set(costs) | set(charges):
        cost = costs.get(event_id)
        charge = charges.get(event_id)
        cost_amount = cost.amount_micro if cost is not None else None
        spend_amount = charge.amount_micro if charge is not None else None
        created = max(
            [row.created_at_ms for row in (cost, charge) if row is not None] or [0]
        )
        rows.append(
            {
                "id": cost.id if cost is not None else charge.id,
                "gateway_event_id": event_id,
                "cost_micro": cost_amount,
                "spend_micro": spend_amount,
                "margin_micro": pricing.margin_micro(spend_amount, cost_amount),
                "markup": pricing.decimal_text(
                    pricing.markup_ratio(spend_amount, cost_amount), Decimal("0.0001")
                ),
                "currency": (
                    (charge.currency if charge is not None else "")
                    or (cost.currency if cost is not None else "")
                ),
                "cost_status": cost.status if cost is not None else "",
                "spend_status": charge.status if charge is not None else "",
                "created_at_ms": created,
            }
        )
    rows.sort(key=lambda item: (item["created_at_ms"], item["gateway_event_id"]), reverse=True)
    return rows[off : off + limit]
