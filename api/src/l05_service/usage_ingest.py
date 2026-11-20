"""Usage ingestion and the billing pipeline (ADR-005/010/011/020, billing.md §3).

Flow: AG request_logs -> gateway_usage_events (immutable facts, idempotent by
event_id) -> cost_entries (model-row cost book, ADR-020) + charge_entries (cost
x model-row markup) -> ledger charge deduction + user balance ->
cost_daily / user_daily. Cache tokens fold into input for BOTH books (lead's
conservative rule until stage B verifies the AG cache columns); every report
must carry the estimate note. Failed requests (http_status != 200) get a cost
entry with amount 0 - token counts preserved (the vendor may still bill;
month-end reconciliation decides) - and NO charge entry: only successful
requests bill the user. Unpriced rows keep amount NULL (never a silent 0) and
surface in /admin/unpriced.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l02_domain.models import UsageEvent
from l02_domain.validation import provider_base_id
from l04_repo.orm import (
    ApiKeyORM,
    ChargeEntryORM,
    CostDailyORM,
    CostEntryORM,
    GatewayUsageEventORM,
    LedgerEntryORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UpstreamPriceORM,
    UserDailyORM,
    UserORM,
)
from l05_service import pricing
from l05_service.balances import deduct_for_charge

_DAY_MS = 86_400_000
_MISSING = object()
#: Upper bound on an IN (...) id list; one ingestion page / billing batch resolves
#: in a single query per reference table instead of one query per event.
_IN_CHUNK = 500


def _batched_ids(ids: Iterable[str]) -> Iterable[list[str]]:
    """Split an id stream into chunks small enough for one IN (...) statement."""
    batch: list[str] = []
    for item in ids:
        batch.append(item)
        if len(batch) >= _IN_CHUNK:
            yield batch
            batch = []
    if batch:
        yield batch


def _users_by_id(session: Session, user_ids: Iterable[str]) -> dict[str, UserORM]:
    """Preload the user rows referenced by ledger rows (one IN query per chunk)."""
    users: dict[str, UserORM] = {}
    for chunk in _batched_ids(sorted({user_id for user_id in user_ids if user_id})):
        rows = session.scalars(select(UserORM).where(UserORM.id.in_(chunk))).all()
        for user in rows:
            users[user.id] = user
    return users


class _BillingCache:
    """Reference rows + cache prices for one billing pass; the event loop runs no SQL.

    Every lookup the per-event code used to send to the database (session.get or
    select) is answered from these maps. Each map keeps the query order of the SQL
    it replaces - models grouped by name in table order, price groups ordered by
    (effective_from_ms desc, version desc) - so candidate selection is unchanged.
    """

    def __init__(self, session: Session, events: Sequence[GatewayUsageEventORM]) -> None:
        self.upstreams: dict[str, UpstreamORM] = {
            upstream.id: upstream for upstream in session.scalars(select(UpstreamORM)).all()
        }
        self.models_by_id: dict[str, UpstreamModelORM] = {}
        self.models_by_name: dict[str, list[UpstreamModelORM]] = {}
        for model in session.scalars(select(UpstreamModelORM)).all():
            self.models_by_id[model.id] = model
            self.models_by_name.setdefault(model.name, []).append(model)
        self.publics_by_name: dict[str, list[PublicModelORM]] = {}
        for public in session.scalars(select(PublicModelORM)).all():
            self.publics_by_name.setdefault(public.name, []).append(public)
        self.prices: dict[tuple[str, str, str], list[UpstreamPriceORM]] = {}
        for price in session.scalars(select(UpstreamPriceORM)).all():
            key = (price.vendor_id, price.upstream_model, price.item)
            self.prices.setdefault(key, []).append(price)
        for group in self.prices.values():
            # effective_upstream_price: newest effective_from wins, then version.
            group.sort(
                key=lambda price: (price.effective_from_ms, price.version), reverse=True
            )
        key_ids = sorted({row.api_key_id for row in events if row.api_key_id})
        self.keys: dict[str, ApiKeyORM] = {}
        for chunk in _batched_ids(key_ids):
            rows = session.scalars(select(ApiKeyORM).where(ApiKeyORM.id.in_(chunk))).all()
            for key in rows:
                self.keys[key.id] = key
        user_ids = sorted({key.user_id for key in self.keys.values()})
        self.users: dict[str, UserORM] = {}
        for chunk in _batched_ids(user_ids):
            rows = session.scalars(select(UserORM).where(UserORM.id.in_(chunk))).all()
            for user in rows:
                self.users[user.id] = user

    def effective_price(
        self, vendor_id: str, upstream_model: str, item: str, at_ms: int
    ) -> UpstreamPriceORM | None:
        """effective_upstream_price from memory: newest row effective at at_ms."""
        for price in self.prices.get((vendor_id, upstream_model, item), ()):
            if price.effective_from_ms <= at_ms:
                return price
        return None

    def public_model(self, name: str) -> PublicModelORM | None:
        """The first public-model row with this name (the per-event .first() lookup)."""
        matches = self.publics_by_name.get(name)
        return matches[0] if matches else None

    def api_key(self, key_id: str) -> ApiKeyORM | None:
        return self.keys.get(key_id)

    def user(self, user_id: str) -> UserORM | None:
        return self.users.get(user_id)


def ingest_usage_events(session: Session, events: Iterable[UsageEvent]) -> int:
    """Insert unseen event_ids only; returns how many rows were actually added.

    The three AG latency fields (completed_at_ms / duration_ms /
    time_to_first_token_ms) ride the same request_logs row into the event so
    latency quantiles and latency>/ttft> log filters work on ingested data.
    """
    added = 0
    added_keys: dict[str, int] = {}
    seen: set[str] = set()
    batch: list[UsageEvent] = []
    for event in events:
        batch.append(event)
        if len(batch) >= _IN_CHUNK:
            added += _ingest_batch(session, batch, seen, added_keys)
            batch = []
    if batch:
        added += _ingest_batch(session, batch, seen, added_keys)
    session.flush()
    _touch_api_keys_last_used(session, added_keys)
    return added


def _ingest_batch(
    session: Session,
    batch: list[UsageEvent],
    seen: set[str],
    added_keys: dict[str, int],
) -> int:
    """Add the unseen events of one IN-sized chunk; returns how many were added.

    The chunk resolves its existing ids with one IN query. The seen set also
    carries the ids added by this call, so an event_id repeated inside one page
    counts once instead of failing the later flush on the primary key.
    """
    existing = session.scalars(
        select(GatewayUsageEventORM.event_id).where(
            GatewayUsageEventORM.event_id.in_([event.event_id for event in batch])
        )
    ).all()
    seen.update(existing)
    added = 0
    for event in batch:
        if event.event_id in seen:
            continue
        seen.add(event.event_id)
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
                trace_id=event.trace_id,
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
    # Only the ids are needed to decide skip/build; loading whole entries here
    # was the cheapest part of the old N+1 and stays a constant two queries.
    priced = {
        event_id
        for event_id in session.scalars(select(CostEntryORM.gateway_event_id)).all()
    }
    charged = {
        event_id
        for event_id in session.scalars(select(ChargeEntryORM.gateway_event_id)).all()
    }
    events = session.scalars(select(GatewayUsageEventORM)).all()
    # One preload outside both loops: every reference the per-event builders need
    # (model rows, upstreams, public models, cache prices, keys/users) is resolved
    # from this cache, so a pass costs a constant number of SELECTs per batch.
    cache = _BillingCache(session, events)
    cost_added = 0
    charge_added = 0
    touched_days: set[str] = set()
    recompute = set(recompute_event_ids or [])
    numerators: dict[str, int | None] = {}
    for row in events:
        if row.event_id in priced and row.event_id not in recompute:
            continue
        _entry, numerator = _build_cost_entry(session, cache, row)
        numerators[row.event_id] = numerator
        cost_added += 1
        touched_days.add(_day_of(row.started_at_ms or now_ms()))
    for row in events:
        if row.event_id in charged and row.event_id not in (recompute_event_ids or []):
            continue
        # A freshly built cost entry hands its exact numerator over so the markup
        # book does not recompute the same cost arithmetic a second time.
        numerator = numerators.get(row.event_id, _MISSING)
        if _build_charge_entry(session, cache, row, cost_numerator=numerator):
            charge_added += 1
    for day in touched_days:
        refresh_cost_daily(session, day)
        refresh_user_daily(session, day)
    return {
        "cost_entries": cost_added,
        "charge_entries": charge_added,
        "recomputed": recomputed,
    }


def _entries_by_event(
    session: Session,
    model: type[CostEntryORM] | type[ChargeEntryORM],
    event_ids: list[str],
) -> dict[str, CostEntryORM | ChargeEntryORM]:
    """First cost/charge entry per gateway_event_id (that column is unique)."""
    found: dict[str, CostEntryORM | ChargeEntryORM] = {}
    for chunk in _batched_ids(event_ids):
        rows = session.scalars(
            select(model).where(model.gateway_event_id.in_(chunk))
        ).all()
        for row in rows:
            found.setdefault(row.gateway_event_id, row)
    return found


def _drop_entries(session: Session, event_ids: list[str]) -> int:
    """Remove entries and the ledger rows they own; returns how many entries went.

    Re-pricing replaces an entry, so the charge ledger row that moved the user
    balance must go with it - otherwise the new entry deducts a second time and
    the ledger keeps a movement whose entry no longer exists. Deleting the row
    (rather than writing a reversing one) keeps the book to exactly one movement
    per entry and leaves no offsetting pair to reconcile.
    """
    costs = _entries_by_event(session, CostEntryORM, event_ids)
    charges = _entries_by_event(session, ChargeEntryORM, event_ids)
    ledgers: dict[str, list[LedgerEntryORM]] = {}
    for chunk in _batched_ids([charge.id for charge in charges.values()]):
        rows = session.scalars(
            select(LedgerEntryORM).where(
                LedgerEntryORM.kind == "charge",
                LedgerEntryORM.ref_id.in_(chunk),
            )
        ).all()
        for ledger in rows:
            if ledger.ref_id is not None:
                ledgers.setdefault(ledger.ref_id, []).append(ledger)
    users = _users_by_id(
        session, [ledger.user_id for group in ledgers.values() for ledger in group]
    )
    dropped = 0
    # The preloaded maps are looked up per occurrence, exactly like the old
    # per-event queries: a recompute list repeating an event_id keeps its
    # historical counting/balance effect.
    for event_id in event_ids:
        cost = costs.get(event_id)
        if cost is not None:
            session.delete(cost)
            dropped += 1
        charge = charges.get(event_id)
        if charge is not None:
            for ledger in ledgers.get(charge.id, ()):
                # Give the balance back before the row disappears; the rebuilt
                # charge deducts its own (new) amount below.
                user = users.get(ledger.user_id)
                if user is not None:
                    user.balance_micro -= ledger.delta_micro
                session.delete(ledger)
            session.delete(charge)
            dropped += 1
    session.flush()
    return dropped


def _resolve_cost_target(
    cache: _BillingCache, row: GatewayUsageEventORM
) -> tuple[str | None, str | None, str | None]:
    """(vendor_id, our upstream model row id, upstream model name) for one event.

    gen_ai_response_model names the actual upstream model; when several of our
    upstreams expose the same model name the event's provider is preferred,
    else the first enabled match wins (documented v1 approximation).

    ADR-026 expands each upstream key into its own provider and AG records that
    expanded name ("{upstream_id}#{seq}") in gen_ai_provider_name, so the raw
    value never equals an upstream id - compare the base id (ticket 15).
    """
    name = row.upstream_model
    if not name:
        return None, None, None
    provider_base = provider_base_id(row.provider)
    candidates = cache.models_by_name.get(name, [])
    upstreams = cache.upstreams
    chosen = None
    for candidate in candidates:
        upstream = upstreams.get(candidate.upstream_id)
        # Only an existing, enabled upstream counts. vendor_id may be NULL (ADR-023
        # upstreams without a vendor): the model row still prices the event, the
        # empty vendor_id only means no cache-price lookup can match.
        if upstream is None or not upstream.enabled:
            continue
        if provider_base and provider_base == candidate.upstream_id:
            chosen = candidate
            break
        if chosen is None:
            chosen = candidate
    if chosen is None:
        return None, None, name
    vendor_id = upstreams[chosen.upstream_id].vendor_id
    return vendor_id, chosen.id, name


def _price_version_ref(cache: _BillingCache, vendor_id: str | None, model_name: str) -> str:
    """price_version snapshot for the ledger: the model row id (ADR-020 authority).

    Falls back to the newest cache-price row id, which is the only channel left
    on the legacy book, so a cost entry always carries a traceable snapshot.
    """
    if vendor_id and model_name:
        price = cache.effective_price(vendor_id, model_name, "cache_read", 0)
        if price is None:
            price = cache.effective_price(vendor_id, model_name, "cache_write", 0)
        if price is not None:
            return price.id
    return ""


def _cache_numerator(
    cache: _BillingCache,
    vendor_id: str | None,
    model_name: str,
    row: GatewayUsageEventORM,
    at_ms: int,
) -> int:
    """Micro-per-1M x tokens for the two cache items, or 0 when unpriced.

    ADR-020 exception: cache prices are NOT columns of the model row, so they
    are the one item still read from the upstream_prices book (item cache_read
    / cache_write). A missing cache price is "unpriced cache" - those tokens
    cost nothing here, exactly as the old book behaved for a cache item with no
    row, while input/output are still billed.
    """
    numerator = 0
    for item, tokens in (
        ("cache_read", row.cache_read_tokens),
        ("cache_write", row.cache_write_tokens),
    ):
        if not tokens:
            continue
        price = cache.effective_price(vendor_id or "", model_name, item, at_ms)
        if price is not None:
            # micro-per-1M x tokens; rounded half-up at the micro boundary (the
            # same rule the model-row path uses) so the caller can add it to that
            # micro amount without a second rounding (billing.md 5.5).
            numerator += pricing.round_half_up_micro(int(tokens) * int(price.unit_price_micro))
    return numerator


def _build_cost_entry(
    session: Session, cache: _BillingCache, row: GatewayUsageEventORM
) -> tuple[CostEntryORM, int | None]:
    """One cost entry per event plus its exact numerator (None when unpriced).

    Priced from the model row (ADR-020): cost_input_per_1m / cost_output_per_1m,
    rounded once at the micro boundary. Cache tokens add their book price on top
    (the cache-price exception; see _cache_numerator).
    """
    vendor_id, model_id, model_name = _resolve_cost_target(cache, row)
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
    if model_name is None or model_id is None:
        entry = CostEntryORM(
            amount_micro=None, currency="", price_version_id="", status="unpriced", **base
        )
        session.add(entry)
        session.flush()
        return entry, None
    model = cache.models_by_id.get(model_id)
    if model is None:
        entry = CostEntryORM(
            amount_micro=None, currency="", price_version_id="", status="unpriced", **base
        )
        session.add(entry)
        session.flush()
        return entry, None
    numerator = pricing.cost_micro(
        row.input_tokens,
        row.output_tokens,
        model.cost_input_per_1m,
        model.cost_output_per_1m,
    )
    if numerator is None:
        entry = CostEntryORM(
            amount_micro=None, currency="", price_version_id="", status="unpriced", **base
        )
        session.add(entry)
        session.flush()
        return entry, None
    numerator += _cache_numerator(cache, vendor_id, model_name, row, at_ms)
    version = _price_version_ref(cache, vendor_id, model_name)
    entry = CostEntryORM(
        # pricing.cost_micro already rounds to the integer micro boundary; the
        # cache term is micro-per-1M x tokens, so the sum needs no second rounding.
        amount_micro=numerator,
        currency="CNY",
        price_version_id=version,
        status="ok",
        **base,
    )
    session.add(entry)
    session.flush()
    return entry, numerator


def _build_charge_entry(
    session: Session,
    cache: _BillingCache,
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
    public = cache.public_model(row.public_model)
    user: UserORM | None = None
    if row.api_key_id:
        key = cache.api_key(row.api_key_id)
        if key is not None:
            user = cache.user(key.user_id)
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
    numerator = (
        _cost_numerator(cache, row)
        if cost_numerator is _MISSING
        else cost_numerator
    )
    model = _cost_model(cache, row)
    if numerator is not None and model is not None:
        # ADR-020: spend = cost x the model row's own markup; there is no
        # separately maintained charge price (charge_prices is retired).
        amount = pricing.spend_micro(int(numerator), model.markup)
        if amount is not None:
            entry.amount_micro = amount
            entry.currency = "CNY"
            entry.price_version_id = model.id
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


def _cost_model(cache: _BillingCache, row: GatewayUsageEventORM) -> UpstreamModelORM | None:
    """The upstream model row that prices this event (ADR-020 single source)."""
    _vendor_id, model_id, _name = _resolve_cost_target(cache, row)
    return cache.models_by_id.get(model_id) if model_id else None


def _cost_numerator(cache: _BillingCache, row: GatewayUsageEventORM) -> int | None:
    """Exact pre-rounding cost numerator (tokens x micro-per-1M), or None if unpriced.

    Mirrors _build_cost_entry's arithmetic so a charge rebuilt without its cost
    entry in the same pass prices identically (cache items included).
    """
    vendor_id, model_id, model_name = _resolve_cost_target(cache, row)
    if model_name is None or model_id is None:
        return None
    model = cache.models_by_id.get(model_id)
    if model is None:
        return None
    at_ms = row.started_at_ms or now_ms()
    numerator = pricing.cost_micro(
        row.input_tokens, row.output_tokens, model.cost_input_per_1m, model.cost_output_per_1m
    )
    if numerator is None:
        return None
    return numerator + _cache_numerator(cache, vendor_id, model_name, row, at_ms)


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
