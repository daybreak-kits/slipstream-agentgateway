"""User-level bill aggregation (ticket 17): my spend and subtree rollups.

This module is the single implementation behind 我的花费, so the page, the
settings tile and the API agree on the scope rule from `l05_service.user_tree`:
every account sees its own node; a role with `billing:subtree` sees its whole
descendant tree; an unrestricted 管理用户 sees every user.

Money is summed per native currency and converted into `report_currency` with
the latest manual fx snapshot (the same rule as `prices.margin_report`). A
missing rate keeps the converted total unknown instead of guessing; the caller
never sees a made-up number.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l04_repo.orm import ChargeEntryORM, CostEntryORM, FxSnapshotORM, PublicModelORM, UserORM
from l05_service import aggregates, money, user_tree
from l05_service.auth import Principal

MICRO = money.MICRO
SCOPE_KEYS = ("self", "subtree")


@dataclass
class _Bucket:
    """One summary / series point / dimension row: counters plus native money."""

    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    unpriced: int = 0
    charges: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    costs: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def _currency(value: str | None) -> str:
    return (value or "").strip().upper()


def _rates(session: Session) -> tuple[str, dict[str, int]]:
    """Report currency plus the latest fx rate per currency (report currency = 1)."""
    report_currency = _currency(get_settings().report_currency) or "CNY"
    rates: dict[str, int] = {report_currency: MICRO}
    for snapshot in session.scalars(
        select(FxSnapshotORM).order_by(FxSnapshotORM.as_of_ms.desc())
    ).all():
        code = _currency(snapshot.currency)
        if code:
            rates.setdefault(code, snapshot.rate_micro)
    return report_currency, rates


def _money(bucket: _Bucket, rates: dict[str, int], report_currency: str) -> dict:
    codes = sorted(set(bucket.charges) | set(bucket.costs))
    by_currency = {
        code: {
            "charge_micro": bucket.charges.get(code, 0),
            "cost_micro": bucket.costs.get(code, 0),
        }
        for code in codes
    }
    missing = [code for code in codes if code not in rates]
    if missing:
        return {
            "currency": report_currency,
            "charge_micro": None,
            "cost_micro": None,
            "margin_micro": None,
            "by_currency": by_currency,
            "fx_missing": missing,
        }
    charge_micro = sum(
        money.convert(bucket.charges.get(code, 0), code, rates) or 0 for code in codes
    )
    cost_micro = sum(
        money.convert(bucket.costs.get(code, 0), code, rates) or 0 for code in codes
    )
    return {
        "currency": report_currency,
        "charge_micro": charge_micro,
        "cost_micro": cost_micro,
        "margin_micro": charge_micro - cost_micro,
        "by_currency": by_currency,
        "fx_missing": [],
    }


def _body(bucket: _Bucket, rates: dict[str, int], report_currency: str, **extra) -> dict:
    payload = dict(extra)
    payload.update(
        {
            "requests": bucket.requests,
            "input_tokens": bucket.input_tokens,
            "output_tokens": bucket.output_tokens,
            "unpriced": bucket.unpriced,
        }
    )
    payload.update(_money(bucket, rates, report_currency))
    return payload


def _add(bucket: _Bucket, charge: ChargeEntryORM, cost: CostEntryORM | None) -> None:
    bucket.requests += 1
    bucket.input_tokens += int(charge.input_tokens or 0)
    bucket.output_tokens += int(charge.output_tokens or 0)
    charge_currency = _currency(charge.currency)
    if (
        charge.amount_micro is not None
        and charge_currency
        and charge.status in ("ok", "free")
    ):
        bucket.charges[charge_currency] += int(charge.amount_micro)
    if cost is not None and cost.status == "ok" and cost.amount_micro is not None:
        cost_currency = _currency(cost.currency)
        if cost_currency:
            bucket.costs[cost_currency] += int(cost.amount_micro)
    if charge.status == "unpriced" or cost is None or cost.status == "unpriced":
        bucket.unpriced += 1


def _costs_for_events(session: Session, event_ids: set[str]) -> dict[str, CostEntryORM]:
    """Cost rows for the given events; chunked to stay under SQLite's bind limit."""
    found: dict[str, CostEntryORM] = {}
    ids = sorted(event_ids)
    for start in range(0, len(ids), 400):
        chunk = ids[start : start + 400]
        for row in session.scalars(
            select(CostEntryORM).where(CostEntryORM.gateway_event_id.in_(chunk))
        ).all():
            found[row.gateway_event_id] = row
    return found


def my_spend(
    session: Session,
    principal: Principal,
    *,
    range_key: str = "30d",
    scope: str = "self",
    user_id: str = "",
    tz_name: str | None = None,
) -> dict:
    """Aggregate spend/cost for the caller's own node or its visible subtree."""
    scope_key = (scope or "self").strip().lower()
    if scope_key not in SCOPE_KEYS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"scope must be one of {SCOPE_KEYS}",
            details={"scope": scope},
        )
    if scope_key == "subtree" and "billing:subtree" not in principal.permissions:
        raise AppError(
            ErrorCode.FORBIDDEN,
            "无权查看下级花费",
            details={"scope": scope_key},
        )

    tz = aggregates.resolve_timezone(tz_name) if tz_name else aggregates.report_timezone(session)
    from_ms, to_ms, bucket = aggregates.resolve_range(range_key, tz)

    node = user_tree.principal_node(session, principal)
    selected = user_tree.get_visible(session, principal, user_id) if user_id else None
    all_users = False
    if selected is not None:
        target = selected
        ids: frozenset[str] | None = (
            frozenset(user_tree.descendant_ids(session, selected.id))
            if scope_key == "subtree"
            else frozenset({selected.id})
        )
    elif scope_key == "subtree":
        # None means "every user" for an unrestricted 管理用户; an agent gets
        # exactly its own subtree, and a plain user never reaches this branch.
        ids = user_tree.visible_ids(session, principal)
        all_users = ids is None
        target = node if ids is not None else None
    else:
        target = node
        ids = frozenset({node.id}) if node is not None else frozenset()

    charges = list(
        session.scalars(
            select(ChargeEntryORM)
            .where(
                ChargeEntryORM.created_at_ms >= from_ms,
                ChargeEntryORM.created_at_ms < to_ms,
            )
            .order_by(ChargeEntryORM.created_at_ms, ChargeEntryORM.id)
        ).all()
    )
    if ids is not None:
        charges = [row for row in charges if row.user_id in ids]

    costs = _costs_for_events(session, {row.gateway_event_id for row in charges})
    starts = aggregates.bucket_starts(from_ms, to_ms, bucket, tz)
    series = [_Bucket() for _ in starts]
    summary = _Bucket()
    by_user: dict[str, _Bucket] = {}
    by_model: dict[str, _Bucket] = {}

    for charge in charges:
        cost = costs.get(charge.gateway_event_id)
        position = bisect_right(starts, charge.created_at_ms) - 1
        targets = [
            summary,
            by_user.setdefault(charge.user_id or "", _Bucket()),
            by_model.setdefault(charge.public_model_id or "", _Bucket()),
        ]
        if 0 <= position < len(series):
            targets.append(series[position])
        for item in targets:
            _add(item, charge, cost)

    user_names = {row.id: row.name for row in session.scalars(select(UserORM)).all()}
    model_names = {row.id: row.name for row in session.scalars(select(PublicModelORM)).all()}
    report_currency, rates = _rates(session)

    by_user_rows = [
        _body(
            item,
            rates,
            report_currency,
            id=user_id_key,
            name=user_names.get(user_id_key, user_id_key or "未绑定用户"),
        )
        for user_id_key, item in sorted(
            by_user.items(),
            key=lambda pair: (-sum(pair[1].charges.values()), pair[0]),
        )
    ]
    by_model_rows = [
        _body(
            item,
            rates,
            report_currency,
            id=model_id,
            name=model_names.get(model_id, model_id or "未指定模型"),
        )
        for model_id, item in sorted(
            by_model.items(),
            key=lambda pair: (-sum(pair[1].charges.values()), pair[0]),
        )
    ]
    series_rows = [
        _body(
            item,
            rates,
            report_currency,
            start_ms=start,
            label=aggregates.bucket_label(start, bucket, tz),
        )
        for start, item in zip(starts, series, strict=True)
    ]

    return {
        "range": range_key,
        "bucket": bucket,
        "timezone": str(tz),
        "from_ms": from_ms,
        "to_ms": to_ms,
        "scope": scope_key,
        "all_users": all_users,
        "user": (
            None
            if target is None or all_users
            else {"id": target.id, "name": target.name, "role": target.role}
        ),
        "summary": _body(summary, rates, report_currency),
        "series": series_rows,
        "by_user": by_user_rows,
        "by_model": by_model_rows,
    }
