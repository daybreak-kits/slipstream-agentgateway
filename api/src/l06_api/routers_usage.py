"""Usage routes: events, event detail, ledger, daily aggregates, manual pull."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l04_repo.orm import (
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
    LedgerEntryORM,
    UserDailyORM,
)
from l05_service import auth, user_tree
from l05_service.usage_pull import pull_once
from l06_api.adapter_factory import make_adapter
from l06_api.deps import page_params, require, session_of

router = APIRouter(tags=["usage"])


def _event_body(row: GatewayUsageEventORM) -> dict:
    """Neutral usage-event facts only (ADR-029): no raw wire row is served."""
    body = {
        "event_id": row.event_id,
        "started_at_ms": row.started_at_ms,
        "completed_at_ms": row.completed_at_ms,
        "duration_ms": row.duration_ms,
        "time_to_first_token_ms": row.time_to_first_token_ms,
        "http_status": row.http_status,
        "public_model": row.public_model,
        "upstream_model": row.upstream_model,
        "provider": row.provider,
        "api_key_id": row.api_key_id,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "total_tokens": row.total_tokens,
        "cache_read_tokens": row.cache_read_tokens,
        "cache_write_tokens": row.cache_write_tokens,
        "estimate_note": "tokens fold cache into input (stage B pending)",
    }
    return body


@router.get("/admin/usage/events", dependencies=[Depends(require("logs:read"))])
def list_events(
    session: Session = Depends(session_of),
    from_ms: int = 0,
    to_ms: int = 0,
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    query = select(GatewayUsageEventORM).order_by(
        GatewayUsageEventORM.started_at_ms.desc(), GatewayUsageEventORM.event_id.desc()
    )
    if from_ms:
        query = query.where(GatewayUsageEventORM.started_at_ms >= from_ms)
    if to_ms:
        query = query.where(GatewayUsageEventORM.started_at_ms < to_ms)
    rows = session.scalars(query.offset(off).limit(limit)).all()
    return [_event_body(row) for row in rows]


@router.get("/admin/usage/events/{event_id}")
def event_detail(
    event_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
) -> dict:
    row = session.get(GatewayUsageEventORM, event_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"usage event not found: {event_id}")
    body = _event_body(row)
    cost = session.scalars(
        select(CostEntryORM).where(CostEntryORM.gateway_event_id == event_id)
    ).first()
    charge = session.scalars(
        select(ChargeEntryORM).where(ChargeEntryORM.gateway_event_id == event_id)
    ).first()
    body["cost"] = (
        {"amount_micro": cost.amount_micro, "currency": cost.currency, "status": cost.status}
        if cost
        else None
    )
    body["charge"] = (
        {"amount_micro": charge.amount_micro, "currency": charge.currency, "status": charge.status}
        if charge
        else None
    )
    return body


@router.get("/admin/usage/ledger")
def list_ledger(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("ledger:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Ledger movements of the users this caller may see (ADR-019 subtree rule).

    `visible_ids` returns None for an unrestricted role (every row), a subtree for
    a branch role and a single id for an ordinary user, so one filter covers all
    three cases. Cross-branch rows are not hidden by omission here but never
    selected in the first place.
    """
    limit, off = page_params(page_size, offset)
    visible = user_tree.visible_ids(session, principal)
    query = select(LedgerEntryORM)
    if visible is not None:
        query = query.where(LedgerEntryORM.user_id.in_(visible))
    rows = session.scalars(
        query.order_by(LedgerEntryORM.created_at_ms.desc()).offset(off).limit(limit)
    ).all()
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "kind": row.kind,
            "delta_micro": row.delta_micro,
            "balance_after_micro": row.balance_after_micro,
            "currency": row.currency,
            "ref_type": row.ref_type,
            "ref_id": row.ref_id,
            "created_at_ms": row.created_at_ms,
        }
        for row in rows
    ]


@router.get("/admin/usage/daily", openapi_extra={"x-money-amount-class": "spend"})
def list_daily(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
    page_size: int = 50,
    offset: int = 0,
) -> list[dict]:
    """User/day charge aggregates for the visible user set (revenue dashboard)."""
    limit, off = page_params(page_size, offset)
    visible = user_tree.visible_ids(session, principal)
    query = select(UserDailyORM)
    if visible is not None:
        query = query.where(UserDailyORM.user_id.in_(visible))
    rows = session.scalars(query.offset(off).limit(limit)).all()
    return [
        {
            "day": row.day,
            "user_id": row.user_id,
            "requests": row.requests,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "amount_micro": row.amount_micro,
            "currency": row.currency,
            "estimate": True,
        }
        for row in rows
    ]


@router.post("/admin/usage/pull", dependencies=[Depends(require("logs:pull"))])
def pull_now(session: Session = Depends(session_of)) -> dict:
    """Manual incremental pull + billing pass (the job does the same on a timer)."""
    adapter = make_adapter(get_settings())
    added = pull_once(session, adapter)
    session.commit()
    return {"added": added}
