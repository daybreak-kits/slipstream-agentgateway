"""Usage ingestion and the billing pipeline (ADR-005/010/011, billing.md §3).

Flow: AG request_logs -> gateway_usage_events (immutable facts, idempotent by
event_id) -> cost_entries (vendor price book) + charge_entries (downstream price
book) -> ledger charge deduction + user balance -> cost_daily / user_daily.
Cache tokens fold into input for BOTH books (lead's conservative rule until
stage B verifies the AG cache columns); every report must carry the estimate
note. Failed requests (http_status != 200) get a cost entry with amount 0 -
token counts preserved (the vendor may still bill; month-end reconciliation
decides) - and NO charge entry: only successful requests bill the user.
Unpriced rows keep amount NULL (never a silent 0) and surface in /admin/unpriced.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l02_domain.models import UsageEvent
from l04_repo.orm import (
    ChargeEntryORM,
    ChargePriceORM,
    CostDailyORM,
    CostEntryORM,
    GatewayUsageEventORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UpstreamPriceORM,
    UserDailyORM,
    UserORM,
)
from l05_service import money
from l05_service.balances import deduct_for_charge
from l05_service.prices import effective_charge_price, effective_upstream_price

_DAY_MS = 86_400_000
_MISSING = object()


def ingest_usage_events(session: Session, events: Iterable[UsageEvent]) -> int:
    """Insert unseen event_ids only; returns how many rows were actually added.

    The three AG latency fields (completed_at_ms / duration_ms /
    time_to_first_token_ms) ride the same request_logs row into the event so
    latency quantiles and latency>/ttft> log filters work on ingested data.
    """
    added = 0
    added_keys: dict[str, int] = {}
    for event in events:
        if session.get(GatewayUsageEventORM, event.event_id) is not None:
            continue
        session.add(
            GatewayUsageEventORM(
                event_id=event.event_id,
                started_at_ms=event.started_at_ms,
                completed_at_ms=event.completed_at_ms,
                duration_ms=event.duration_ms,
                time_to_first_token_ms=event.time_to_first_token_ms,
                http_status=event.http_status,
                public_model=event.public_model,
                upstream_model=event.upstream_model,
                provider=event.provider,
                api_key_id=event.api_key_id,
                input_tokens=event.input_tokens,
                output_tokens=event.output_tokens,
                total_tokens=event.total_tokens,
                cache_read_tokens=event.cache_read_tokens,
                cache_write_tokens=event.cache_write_tokens,
                raw_json=event.raw_json,
                ingested_at_ms=now_ms(),
            )
        )
        added += 1
        if event.api_key_id:
            # last_used_at follows started_at_ms (the usage instant), matching the
            # created_at_ms convention the billing entries use for the same events.
            added_keys[event.api_key_id] = max(
                added_keys.get(event.api_key_id, 0), event.started_at_ms
            )
    session.flush()
    _touch_api_keys_last_used(session, added_keys)
    return added


def _touch_api_keys_last_used(session: Session, stamps: dict[str, int]) -> None:
    """Batch-update the api_keys last-used stamp to the latest event instant per key.

    The column belongs to W1b (user/auth workstream) and landed as
    `last_used_at_ms`; while that was pending, ingestion had to keep working on
    databases without it, so the column is detected via PRAGMA and the update
    is skipped when neither spelling exists. Replays never reach here (only
    new events do), and the stamp only moves forward.
    """
    if not stamps:
        return
    existing = {
        row[0]
        for row in session.execute(
            text(
                "SELECT name FROM pragma_table_info('api_keys') "
                "WHERE name IN ('last_used_at_ms', 'last_used_at')"
            )
        ).all()
    }
    column = "last_used_at_ms" if "last_used_at_ms" in existing else None
    if column is None and existing:
        column = "last_used_at"
    if column is None:
        return  # W1b 列尚未合入：跳过更新，不阻塞采集
    for key_id, stamp in stamps.items():
        session.execute(
            text(
                f"UPDATE api_keys SET {column} = :stamp "
                f"WHERE id = :key_id AND COALESCE({column}, 0) < :stamp"
            ),
            {"stamp": stamp, "key_id": key_id},
        )


def _day_of(ms: int) -> str:
    """UTC calendar day string for one epoch-ms instant."""
    return datetime.fromtimestamp(ms / 1000, tz=UTC).strftime("%Y-%m-%d")


def _day_bounds(day: str) -> tuple[int, int]:
    start = int(
        datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000
    )
    return start, start + _DAY_MS


def process_billing(session: Session, *, recompute_event_ids: list[str] | None = None) -> dict:
    """Build cost+charge entries for events that lack them; idempotent per event.

    When recompute_event_ids is given, those events' existing entries (and their
    ledger rows) are dropped first - the re-price path after filling missing
    prices; usage events themselves are never duplicated (billing.md §7).
    """
    recomputed = 0
    if recompute_event_ids:
        recomputed = _drop_entries(session, recompute_event_ids)
    priced = {
        row.gateway_event_id
        for row in session.scalars(select(CostEntryORM)).all()
    }
    charged = {
        row.gateway_event_id
        for row in session.scalars(select(ChargeEntryORM)).all()
    }
    events = session.scalars(select(GatewayUsageEventORM)).all()
    cost_added = 0
    charge_added = 0
    touched_days: set[str] = set()
    recompute = set(recompute_event_ids or [])
    numerators: dict[str, int | None] = {}
    for row in events:
        if row.event_id in priced and row.event_id not in recompute:
            continue
        _entry, numerator = _build_cost_entry(session, row)
        numerators[row.event_id] = numerator
        cost_added += 1
        touched_days.add(_day_of(row.started_at_ms or now_ms()))
    for row in events:
        if row.event_id in charged and row.event_id not in (recompute_event_ids or []):
            continue
        # A freshly built cost entry hands its exact numerator over so the markup
        # book does not recompute the same cost arithmetic a second time.
        numerator = numerators.get(row.event_id, _MISSING)
        if _build_charge_entry(session, row, cost_numerator=numerator):
            charge_added += 1
    for day in touched_days:
        refresh_cost_daily(session, day)
        refresh_user_daily(session, day)
    return {
        "cost_entries": cost_added,
        "charge_entries": charge_added,
        "recomputed": recomputed,
    }


def _drop_entries(session: Session, event_ids: list[str]) -> int:
    """Remove entries (and charge ledger rows) for re-pricing; returns count."""
    dropped = 0
    for event_id in event_ids:
        cost = session.scalars(
            select(CostEntryORM).where(CostEntryORM.gateway_event_id == event_id)
        ).first()
        if cost is not None:
            session.delete(cost)
            dropped += 1
        charge = session.scalars(
            select(ChargeEntryORM).where(ChargeEntryORM.gateway_event_id == event_id)
        ).first()
        if charge is not None:
            session.delete(charge)
            dropped += 1
    session.flush()
    return dropped


def _resolve_cost_target(
    session: Session, row: GatewayUsageEventORM
) -> tuple[str | None, str | None, str | None]:
    """(vendor_id, our upstream model id, upstream model name) for one event.

    gen_ai_response_model names the actual upstream model; when several of our
    upstreams expose the same model name the event's provider is preferred,
    else the first enabled match wins (documented v1 approximation).
    """
    name = row.upstream_model
    if not name:
        return None, None, None
    candidates = session.scalars(
        select(UpstreamModelORM).where(UpstreamModelORM.name == name)
    ).all()
    upstreams = {
        u.id: u for u in session.scalars(select(UpstreamORM)).all()
    }
    chosen = None
    for candidate in candidates:
        upstream = upstreams.get(candidate.upstream_id)
        if upstream is None or not upstream.enabled:
            continue
        if row.provider and row.provider == candidate.upstream_id:
            chosen = candidate
            break
        if chosen is None:
            chosen = candidate
    if chosen is None:
        return None, None, name
    vendor_id = upstreams[chosen.upstream_id].vendor_id
    return vendor_id, chosen.id, name


def _build_cost_entry(
    session: Session, row: GatewayUsageEventORM
) -> tuple[CostEntryORM, int | None]:
    """One cost entry per event plus its exact numerator (None when unpriced)."""
    vendor_id, model_id, model_name = _resolve_cost_target(session, row)
    input_tokens = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens
    base = dict(
        id=new_id("cost"),
        gateway_event_id=row.event_id,
        vendor_id=vendor_id,
        upstream_model_id=model_id,
        input_tokens=input_tokens,
        output_tokens=row.output_tokens,
        cache_read_tokens=row.cache_read_tokens,
        cache_write_tokens=row.cache_write_tokens,
        created_at_ms=row.started_at_ms or now_ms(),
    )
    if row.http_status != 200:
        # billing.md §6: failed requests cost 0 with tokens preserved (may be
        # corrected at month-end when the vendor invoice arrives).
        entry = CostEntryORM(
            amount_micro=0,
            currency="",
            price_version_id="",
            status="ok",
            **base,
        )
        session.add(entry)
        session.flush()
        return entry, 0
    at_ms = row.started_at_ms or now_ms()
    if vendor_id is None or model_name is None:
        entry = CostEntryORM(
            amount_micro=None, currency="", price_version_id="", status="unpriced", **base
        )
        session.add(entry)
        session.flush()
        return entry, None
    prices: dict[str, UpstreamPriceORM] = {}
    for item in ("input", "output", "cache_read", "cache_write", "request"):
        price = effective_upstream_price(session, vendor_id, model_name, item, at_ms)
        if price is not None:
            prices[item] = price
    numerator = money.cost_numerator(
        {"input": input_tokens, "output": row.output_tokens}, prices, 1
    )
    amount = None if numerator is None else money.round_micro(numerator, money.MICRO)
    if amount is None:
        entry = CostEntryORM(
            amount_micro=None,
            currency=prices.get("input").currency if prices else "",
            price_version_id="",
            status="unpriced",
            **base,
        )
    else:
        version = prices.get("input") or prices.get("output") or next(iter(prices.values()))
        entry = CostEntryORM(
            amount_micro=amount,
            currency=version.currency,
            price_version_id=version.id,
            status="ok",
            **base,
        )
    session.add(entry)
    session.flush()
    return entry, numerator


def _build_charge_entry(
    session: Session,
    row: GatewayUsageEventORM,
    *,
    cost_numerator: int | None | object = _MISSING,
) -> ChargeEntryORM | None:
    """One charge entry per successful event; deducts the user balance when priced.

    cost_numerator is passed in from the cost pass so a markup charge does not
    recompute the same arithmetic; falling back to _cost_numerator only happens
    when a charge is rebuilt without its cost entry in the same pass.
    """
    if row.http_status != 200:
        return None
    public = session.scalars(
        select(PublicModelORM).where(PublicModelORM.name == row.public_model)
    ).first()
    user: UserORM | None = None
    if row.api_key_id:
        from l04_repo.orm import ApiKeyORM

        key = session.get(ApiKeyORM, row.api_key_id)
        if key is not None:
            user = session.get(UserORM, key.user_id)
    input_tokens = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens
    base = dict(
        id=new_id("chg"),
        gateway_event_id=row.event_id,
        user_id=user.id if user is not None else None,
        api_key_id=row.api_key_id,
        public_model_id=public.id if public is not None else None,
        input_tokens=input_tokens,
        output_tokens=row.output_tokens,
        created_at_ms=row.started_at_ms or now_ms(),
    )
    entry = ChargeEntryORM(
        amount_micro=None, currency="", price_version_id="", status="unpriced", **base
    )
    at_ms = row.started_at_ms or now_ms()
    if public is not None:
        prices: dict[str, ChargePriceORM] = {}
        for item in ("input", "output", "request"):
            price = effective_charge_price(session, public.id, item, at_ms)
            if price is not None:
                prices[item] = price
        numerator = (
            _cost_numerator(session, row, at_ms)
            if cost_numerator is _MISSING
            else cost_numerator
        )
        if numerator is not None and prices:
            amount = money.charge_from_cost_numerator(
                int(numerator),
                prices,
                {"input": input_tokens, "output": row.output_tokens},
                1,
            )
            if amount is not None:
                version = prices.get("request") or next(iter(prices.values()))
                entry.amount_micro = amount
                entry.currency = version.currency
                entry.price_version_id = version.id
                entry.status = "free" if amount == 0 else "ok"
    session.add(entry)
    session.flush()
    if entry.amount_micro is not None and entry.status == "ok" and user is not None:
        deduct_for_charge(
            session,
            user=user,
            amount_micro=entry.amount_micro,
            currency=entry.currency,
            charge_entry_id=entry.id,
        )
    return entry


def _cost_numerator(session: Session, row: GatewayUsageEventORM, at_ms: int) -> int | None:
    """Exact pre-rounding cost numerator (tokens x micro-per-1M), or None if unpriced."""
    vendor_id, _model_id, model_name = _resolve_cost_target(session, row)
    if vendor_id is None or model_name is None:
        return None
    prices: dict[str, UpstreamPriceORM] = {}
    for item in ("input", "output"):
        price = effective_upstream_price(session, vendor_id, model_name, item, at_ms)
        if price is not None:
            prices[item] = price
    input_tokens = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens
    return money.cost_numerator(
        {"input": input_tokens, "output": row.output_tokens}, prices, 1
    )


def refresh_cost_daily(session: Session, day: str | None = None) -> str:
    """Rebuild cost_daily rows for one day from cost entries (dashboard read model)."""
    if day is None:
        day = _day_of(now_ms())
    start_ms, end_ms = _day_bounds(day)
    for old in session.scalars(select(CostDailyORM).where(CostDailyORM.day == day)).all():
        session.delete(old)
    buckets: dict[tuple[str, str, str], dict[str, int]] = {}
    for entry in session.scalars(
        select(CostEntryORM).where(
            CostEntryORM.created_at_ms >= start_ms, CostEntryORM.created_at_ms < end_ms
        )
    ).all():
        key = (entry.vendor_id or "?", entry.upstream_model_id or "?", entry.currency or "")
        bucket = buckets.setdefault(
            key, {"requests": 0, "input": 0, "output": 0, "amount": 0}
        )
        bucket["requests"] += 1
        bucket["input"] += entry.input_tokens
        bucket["output"] += entry.output_tokens
        if entry.amount_micro is not None:
            bucket["amount"] += entry.amount_micro
    for (vendor_id, model_id, currency), bucket in buckets.items():
        session.add(
            CostDailyORM(
                day=day,
                vendor_id=vendor_id,
                upstream_model=model_id,
                requests=bucket["requests"],
                input_tokens=bucket["input"],
                output_tokens=bucket["output"],
                amount_micro=bucket["amount"],
                currency=currency,
            )
        )
    session.flush()
    return day


def refresh_user_daily(session: Session, day: str | None = None) -> str:
    """Rebuild user_daily rows for one day from charge entries."""
    if day is None:
        day = _day_of(now_ms())
    start_ms, end_ms = _day_bounds(day)
    for old in session.scalars(select(UserDailyORM).where(UserDailyORM.day == day)).all():
        session.delete(old)
    buckets: dict[tuple[str, str], dict[str, int]] = {}
    for entry in session.scalars(
        select(ChargeEntryORM).where(
            ChargeEntryORM.created_at_ms >= start_ms,
            ChargeEntryORM.created_at_ms < end_ms,
            ChargeEntryORM.status.in_(("ok", "free")),
        )
    ).all():
        key = (entry.user_id or "?", entry.currency or "")
        bucket = buckets.setdefault(
            key, {"requests": 0, "input": 0, "output": 0, "amount": 0}
        )
        bucket["requests"] += 1
        bucket["input"] += entry.input_tokens
        bucket["output"] += entry.output_tokens
        if entry.amount_micro is not None:
            bucket["amount"] += entry.amount_micro
    for (user_id, currency), bucket in buckets.items():
        session.add(
            UserDailyORM(
                day=day,
                user_id=user_id,
                requests=bucket["requests"],
                input_tokens=bucket["input"],
                output_tokens=bucket["output"],
                amount_micro=bucket["amount"],
                currency=currency,
            )
        )
    session.flush()
    return day
