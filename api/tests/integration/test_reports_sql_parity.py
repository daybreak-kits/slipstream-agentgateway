"""W1a ADR-022 parity: SQL aggregation vs the retired Python algorithm.

The legacy build_timeseries/build_heatmap/build_flow/overview loops are kept
below as an inline copy (they were removed from aggregates.py); every case
runs BOTH implementations over the same fixture and asserts identical
payloads. New fields the legacy algorithm never produced (metrics list,
error_count, active_minutes, p75) are stripped before the comparison and
asserted separately against direct Python expectations.
"""

from __future__ import annotations

import copy
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.settings import get_settings
from l04_repo.orm import (
    ApiKeyORM,
    ChargeEntryORM,
    CostEntryORM,
    FxSnapshotORM,
    GatewayUsageEventORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UserORM,
)
from l05_service import aggregates, money, prices
from l05_service.prices import margin_report

TZ = ZoneInfo("Asia/Shanghai")
AT = int(datetime(2026, 3, 10, 12, 0, tzinfo=TZ).timestamp() * 1000)
MICRO = money.MICRO


def _local_ms(
    year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0
) -> int:
    return int(datetime(year, month, day, hour, minute, second, tzinfo=TZ).timestamp() * 1000)


# --------------------------------------------------------------- legacy copy
# Verbatim transcription of the pre-ADR-022 Python algorithm (aggregates.py
# before the SQL rewrite), kept ONLY for this parity suite.


def _now_ms() -> int:
    """Frozen clock for the legacy copies; the seeded fixture pins now to AT."""
    return aggregates.now_ms()


def _legacy_tokens(event: GatewayUsageEventORM) -> int:
    return int(event.input_tokens or 0) + int(event.output_tokens or 0)


@dataclass
class _LegacyReportData:
    events: list[GatewayUsageEventORM]
    costs: dict[str, CostEntryORM]
    charges: dict[str, ChargeEntryORM]
    users: dict[str, str]
    keys: dict[str, str]
    public_models: dict[str, str]
    upstream_models: dict[str, str]
    upstream_names: dict[str, str]
    channel_of_model: dict[str, str]
    report_currency: str
    fx_rates: dict[str, int]
    fx_missing: set[str] = field(default_factory=set)

    def money(self, amount_micro: int | None, currency: str | None) -> int | None:
        if not amount_micro:
            return 0
        code = (currency or "").strip().upper()
        if not code:
            return 0
        if code == self.report_currency.upper():
            return int(amount_micro)
        converted = money.convert(int(amount_micro), code, self.fx_rates)
        if converted is None:
            self.fx_missing.add(code)
        return converted


def _legacy_entries_for_events(
    session: Session,
    orm: type[CostEntryORM] | type[ChargeEntryORM],
    event_ids: list[str],
    from_ms: int,
    to_ms: int,
) -> dict:
    rows: dict = {}
    for row in session.scalars(
        select(orm).where(orm.created_at_ms >= from_ms, orm.created_at_ms < to_ms)
    ).all():
        rows[row.gateway_event_id] = row
    for offset in range(0, len(event_ids), 400):
        chunk = event_ids[offset : offset + 400]
        for row in session.scalars(select(orm).where(orm.gateway_event_id.in_(chunk))).all():
            rows[row.gateway_event_id] = row
    return rows


def _legacy_load_report_data(session: Session, from_ms: int, to_ms: int) -> _LegacyReportData:
    events = list(
        session.scalars(
            select(GatewayUsageEventORM)
            .where(
                GatewayUsageEventORM.started_at_ms >= from_ms,
                GatewayUsageEventORM.started_at_ms < to_ms,
            )
            .order_by(GatewayUsageEventORM.started_at_ms, GatewayUsageEventORM.event_id)
        ).all()
    )
    event_ids = [event.event_id for event in events]
    settings = get_settings()
    report_currency = ((settings.report_currency or "").strip() or "CNY").upper()
    fx_rates = {report_currency: MICRO}
    for snapshot in session.scalars(
        select(FxSnapshotORM).order_by(FxSnapshotORM.as_of_ms.desc())
    ).all():
        code = (snapshot.currency or "").strip().upper()
        if code:
            fx_rates.setdefault(code, snapshot.rate_micro)
    key_labels: dict[str, str] = {}
    for row in session.scalars(select(ApiKeyORM)).all():
        suffix = row.key_suffix or ""
        prefix = row.prefix or "sk-"
        key_labels[row.id] = (prefix + "…" + suffix) if suffix else row.id
    upstream_names = {row.id: row.name for row in session.scalars(select(UpstreamORM)).all()}
    upstream_rows = list(session.scalars(select(UpstreamModelORM)).all())
    return _LegacyReportData(
        events=events,
        costs=_legacy_entries_for_events(session, CostEntryORM, event_ids, from_ms, to_ms),
        charges=_legacy_entries_for_events(session, ChargeEntryORM, event_ids, from_ms, to_ms),
        users={row.id: row.name for row in session.scalars(select(UserORM)).all()},
        keys=key_labels,
        public_models={row.id: row.name for row in session.scalars(select(PublicModelORM)).all()},
        upstream_models={row.id: row.name for row in upstream_rows},
        upstream_names=upstream_names,
        channel_of_model={row.id: upstream_names.get(row.upstream_id, "") for row in upstream_rows},
        report_currency=report_currency,
        fx_rates=fx_rates,
    )


def _legacy_charge_of(data: _LegacyReportData, event_id: str) -> ChargeEntryORM | None:
    return data.charges.get(event_id)


def _legacy_cost_of(data: _LegacyReportData, event_id: str) -> CostEntryORM | None:
    return data.costs.get(event_id)


def _legacy_member_identity(data: _LegacyReportData, event: GatewayUsageEventORM, dimension: str):
    charge = _legacy_charge_of(data, event.event_id)
    cost = _legacy_cost_of(data, event.event_id)
    if dimension == "upstream":
        label = event.upstream_model or (
            data.upstream_models.get(cost.upstream_model_id)
            if cost and cost.upstream_model_id
            else ""
        )
        label = label or "未命名"
        return f"upstream:{label}", label
    if dimension == "channel":
        label = (
            data.channel_of_model.get(cost.upstream_model_id, "")
            if cost and cost.upstream_model_id
            else ""
        )
        label = label or event.provider or "未知上游"
        return f"channel:{label}", label
    label = event.public_model or (
        data.public_models.get(charge.public_model_id) if charge and charge.public_model_id else ""
    )
    label = label or "未命名"
    return f"model:{label}", label


def _legacy_event_metric(data: _LegacyReportData, event: GatewayUsageEventORM, metric: str):
    if metric == "requests":
        return 1
    if metric == "input_tokens":
        return int(event.input_tokens or 0)
    if metric == "output_tokens":
        return int(event.output_tokens or 0)
    if metric == "tokens":
        return _legacy_tokens(event)
    if metric == "cost_micro":
        cost = _legacy_cost_of(data, event.event_id)
        return data.money(cost.amount_micro, cost.currency) if cost else 0
    if metric == "charge_micro":
        charge = _legacy_charge_of(data, event.event_id)
        return data.money(charge.amount_micro, charge.currency) if charge else 0
    return 1


def _legacy_build_timeseries(
    data: _LegacyReportData,
    *,
    range_key: str,
    from_ms: int,
    to_ms: int,
    bucket: str,
    dimension: str,
    metric: str,
    top_n: int,
    tz: ZoneInfo,
) -> dict:
    canonical = aggregates.canonical_metric(metric)
    starts = aggregates.bucket_starts(from_ms, to_ms, bucket, tz)
    index = {start: position for position, start in enumerate(starts)}
    buckets: dict[int, dict[str, int]] = {position: {} for position in range(len(starts))}
    metric_totals: dict[str, int] = defaultdict(int)
    member_requests: dict[str, int] = defaultdict(int)
    member_tokens: dict[str, int] = defaultdict(int)
    member_cost: dict[str, int] = defaultdict(int)
    member_spend: dict[str, int] = defaultdict(int)
    totals = {
        "requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "tokens": 0,
        "cost_micro": 0,
        "charge_micro": 0,
    }
    for event in data.events:
        start = aggregates._bucket_start(event.started_at_ms, bucket, tz)
        position = index.get(start)
        if position is None:
            continue
        member_id, _label = _legacy_member_identity(data, event, dimension)
        value = _legacy_event_metric(data, event, canonical)
        if value is not None:
            metric_totals[member_id] += value
            buckets[position][member_id] = buckets[position].get(member_id, 0) + value
        tokens = _legacy_tokens(event)
        member_requests[member_id] += 1
        member_tokens[member_id] += tokens
        totals["requests"] += 1
        totals["input_tokens"] += int(event.input_tokens or 0)
        totals["output_tokens"] += int(event.output_tokens or 0)
        totals["tokens"] += tokens
        cost = _legacy_cost_of(data, event.event_id)
        charge = _legacy_charge_of(data, event.event_id)
        cost_micro = (data.money(cost.amount_micro, cost.currency) if cost else 0) or 0
        charge_micro = (data.money(charge.amount_micro, charge.currency) if charge else 0) or 0
        member_cost[member_id] += cost_micro
        member_spend[member_id] += charge_micro
        totals["cost_micro"] += cost_micro
        totals["charge_micro"] += charge_micro

    ranked = sorted(metric_totals.items(), key=lambda item: (-item[1], item[0]))
    selected = ranked[:top_n]
    folded = ranked[top_n:]
    other_id = aggregates._OTHER_PREFIX + dimension
    if folded:
        selected.append((other_id, sum(total for _member, total in folded)))
        for position in buckets:
            buckets[position][other_id] = sum(
                buckets[position].get(member, 0) for member, _total in folded
            )
        member_requests[other_id] = sum(member_requests[member] for member, _t in folded)
        member_tokens[other_id] = sum(member_tokens[member] for member, _t in folded)
        member_cost[other_id] = sum(member_cost[member] for member, _t in folded)
        member_spend[other_id] = sum(member_spend[member] for member, _t in folded)
    total_metric = sum(metric_totals.values())
    members = []
    for member_id, total in selected:
        label = f"其他（{len(folded)}）" if member_id == other_id else member_id.split(":", 1)[1]
        members.append(
            {
                "id": member_id,
                "label": label,
                "total": total,
                "share": round(total / total_metric, 6) if total_metric else 0.0,
                "requests": member_requests.get(member_id, 0),
                "tokens": member_tokens.get(member_id, 0),
                "cost_micro": member_cost.get(member_id, 0),
                "charge_micro": member_spend.get(member_id, 0),
            }
        )
    member_ids = [member["id"] for member in members]
    points = []
    for position, start in enumerate(starts):
        row = {member_id: buckets[position].get(member_id, 0) for member_id in member_ids}
        points.append(
            {
                "bucket_start_ms": start,
                "label": aggregates.bucket_label(start, bucket, tz),
                "total": sum(row.values()),
                "values": row,
            }
        )
    return {
        "range": range_key,
        "bucket": bucket,
        "dimension": dimension,
        "metric": canonical,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "timezone": str(tz),
        "currency": data.report_currency,
        "points": points,
        "members": members,
        "totals": totals,
        "metric_total": total_metric,
        "folded_members": len(folded),
        "fx_missing": sorted(data.fx_missing),
        "estimate_note": aggregates.ESTIMATE_NOTE,
    }


def _legacy_build_heatmap(
    data: _LegacyReportData, *, from_ms: int, to_ms: int, range_key: str, metric: str, tz: ZoneInfo
) -> dict:
    canonical = aggregates.canonical_metric(metric)
    if range_key == "7d":
        mode = "weekday_hour"
        row_keys = [str(day) for day in range(1, 8)]
        row_labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        row_index = {day: index for index, day in enumerate(range(1, 8))}
    elif range_key in ("30d", "365d"):
        mode = "date_hour"
        days = {"30d": 30, "365d": 365}[range_key]
        start_local = aggregates._local(from_ms, tz).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        row_keys, row_labels, row_index = [], [], {}
        for offset in range(days):
            day = (start_local + timedelta(days=offset)).date()
            row_keys.append(day.isoformat())
            row_labels.append(day.strftime("%m-%d") if days <= 30 else day.isoformat())
            row_index[day] = offset
    else:
        raise AssertionError(range_key)
    matrix = [[0 for _hour in range(24)] for _row in row_keys]
    for event in data.events:
        local = aggregates._local(event.started_at_ms, tz)
        if mode == "weekday_hour":
            row = row_index.get(local.isoweekday())
        else:
            row = row_index.get(local.date())
        if row is None:
            continue
        value = _legacy_event_metric(data, event, canonical)
        if value:
            matrix[row][local.hour] += value
    return {
        "range": range_key,
        "mode": mode,
        "metric": canonical,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "timezone": str(tz),
        "currency": data.report_currency,
        "columns": [{"key": str(hour), "label": f"{hour:02d}"} for hour in range(24)],
        "rows": [
            {"key": key, "label": label, "values": matrix[index]}
            for index, (key, label) in enumerate(zip(row_keys, row_labels, strict=False))
        ],
        "max": max((value for row in matrix for value in row), default=0),
        "total": sum(sum(row) for row in matrix),
        "fx_missing": sorted(data.fx_missing),
        "estimate_note": aggregates.ESTIMATE_NOTE,
    }


def _legacy_build_flow(data: _LegacyReportData, *, metric: str = "requests") -> dict:
    canonical = aggregates.canonical_metric(metric)
    if canonical not in ("requests", "tokens"):
        canonical = "requests"
    links: dict[tuple[str, str], dict[str, int]] = {}
    node_meta: dict[str, dict] = {}
    node_values: dict[str, int] = defaultdict(int)
    totals = {"requests": 0, "tokens": 0, "cost_micro": 0, "charge_micro": 0}

    def node(node_id: str, label: str, stage: str) -> None:
        node_meta.setdefault(node_id, {"id": node_id, "label": label, "stage": stage})

    for event in data.events:
        charge = _legacy_charge_of(data, event.event_id)
        cost = _legacy_cost_of(data, event.event_id)
        user_id = charge.user_id if charge else None
        key_id = (charge.api_key_id if charge else None) or event.api_key_id
        public_name = (
            event.public_model
            or (
                data.public_models.get(charge.public_model_id)
                if charge and charge.public_model_id
                else ""
            )
            or "未命名"
        )
        upstream_name = (
            event.upstream_model
            or (
                data.upstream_models.get(cost.upstream_model_id)
                if cost and cost.upstream_model_id
                else ""
            )
            or "未命名"
        )
        channel_name = ""
        if cost and cost.upstream_model_id:
            channel_name = data.channel_of_model.get(cost.upstream_model_id, "")
        channel_name = channel_name or event.provider or "未知上游"
        user_node = f"user:{user_id or 'anonymous'}"
        key_node = f"key:{key_id or 'none'}"
        model_node = f"model:{public_name}"
        upstream_node = f"umodel:{upstream_name}"
        channel_node = f"channel:{channel_name}"
        node(user_node, data.users.get(user_id, "未登录") if user_id else "未登录", "user")
        node(key_node, data.keys.get(key_id, "无密钥") if key_id else "无密钥", "key")
        node(model_node, public_name, "model")
        node(upstream_node, upstream_name, "upstream")
        node(channel_node, channel_name, "channel")
        tokens = _legacy_tokens(event)
        cost_micro = (data.money(cost.amount_micro, cost.currency) if cost else 0) or 0
        charge_micro = (data.money(charge.amount_micro, charge.currency) if charge else 0) or 0
        edges = (
            (user_node, key_node),
            (key_node, model_node),
            (model_node, upstream_node),
            (upstream_node, channel_node),
        )
        for position, (source, target) in enumerate(edges):
            slot = links.setdefault(
                (source, target),
                {"requests": 0, "tokens": 0, "cost_micro": 0, "charge_micro": 0},
            )
            slot["requests"] += 1
            slot["tokens"] += tokens
            if position == 0:
                slot["charge_micro"] += charge_micro
            if position == len(edges) - 1:
                slot["cost_micro"] += cost_micro
        totals["requests"] += 1
        totals["tokens"] += tokens
        totals["cost_micro"] += cost_micro
        totals["charge_micro"] += charge_micro
        step = 1 if canonical == "requests" else tokens
        for node_id in (user_node, key_node, model_node, upstream_node, channel_node):
            node_values[node_id] += step

    link_rows = []
    for (source, target), slot in links.items():
        link_rows.append(
            {
                "source": source,
                "target": target,
                "requests": slot["requests"],
                "tokens": slot["tokens"],
                "cost_micro": slot["cost_micro"],
                "charge_micro": slot["charge_micro"],
                "value": slot["requests"] if canonical == "requests" else slot["tokens"],
            }
        )
    link_rows.sort(key=lambda row: (row["source"], row["target"]))
    nodes = sorted(
        node_meta,
        key=lambda node_id: (
            aggregates._STAGE_INDEX[node_meta[node_id]["stage"]],
            node_meta[node_id]["label"],
            node_id,
        ),
    )
    for node_id, meta in node_meta.items():
        meta["value"] = node_values.get(node_id, 0)
    return {
        "metric": canonical,
        "nodes": nodes,
        "node_meta": node_meta,
        "links": link_rows,
        "stages": [{"id": stage, "label": label} for stage, label in aggregates._FLOW_STAGES],
        "totals": totals,
        "currency": data.report_currency,
        "fx_missing": sorted(data.fx_missing),
        "estimate_note": aggregates.ESTIMATE_NOTE,
    }


def _legacy_latency_report(
    events: list[GatewayUsageEventORM], *, min_samples: int = aggregates.MIN_PERCENTILE_SAMPLES
) -> dict:
    paired = [
        (event.time_to_first_token_ms, event.duration_ms)
        for event in events
        if (event.time_to_first_token_ms or 0) > 0 and (event.duration_ms or 0) > 0
    ]
    ttft = [first for first, _total in paired]
    totals = [total for _first, total in paired]

    def percentile(values: list[int], fraction: float) -> int | None:
        if not values:
            return None
        ordered = sorted(values)
        rank = max(1, math.ceil(fraction * len(ordered)))
        return int(ordered[min(rank, len(ordered)) - 1])

    def block(values: list[int]) -> dict:
        sufficient = len(values) >= min_samples
        return {
            "samples": len(values),
            "p50_ms": percentile(values, 0.50) if sufficient else None,
            "p95_ms": percentile(values, 0.95) if sufficient else None,
            "p99_ms": percentile(values, 0.99) if sufficient else None,
        }

    return {
        "paired_samples": len(paired),
        "min_samples": min_samples,
        "ttft": block(ttft),
        "total": block(totals),
    }


def _legacy_margin_report(session: Session, from_ms: int = 0, to_ms: int = 0) -> dict:
    """Verbatim transcription of prices.margin_report before the W6 SQL rewrite
    (per-row Python summation over charged/成本 rows), kept only for parity."""
    settings = get_settings()
    report_currency = (settings.report_currency or "").strip() or "CNY"
    effective_from = max(int(from_ms or 0), 0)
    effective_to = int(to_ms or 0) if int(to_ms or 0) > 0 else _now_ms() + 1

    def _currency_of(value: str | None) -> str:
        return (value or "").strip()

    charges: dict[str, int] = {}
    for row in session.scalars(
        select(ChargeEntryORM).where(
            ChargeEntryORM.status.in_(("ok", "free")),
            ChargeEntryORM.created_at_ms >= effective_from,
            ChargeEntryORM.created_at_ms < effective_to,
        )
    ).all():
        currency = _currency_of(row.currency)
        if row.amount_micro is not None and currency:
            charges[currency] = charges.get(currency, 0) + row.amount_micro
    costs: dict[str, int] = {}
    for row in session.scalars(
        select(CostEntryORM).where(
            CostEntryORM.status == "ok",
            CostEntryORM.created_at_ms >= effective_from,
            CostEntryORM.created_at_ms < effective_to,
        )
    ).all():
        currency = _currency_of(row.currency)
        if row.amount_micro is not None and currency:
            costs[currency] = costs.get(currency, 0) + row.amount_micro
    currencies = sorted(set(charges) | set(costs))
    fx: dict[str, int | None] = {}
    converted_charges = 0
    converted_costs = 0
    for currency in currencies:
        rate: int | None
        if currency.upper() == report_currency.upper():
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


def _legacy_overview(session: Session, from_ms: int, to_ms: int) -> dict:
    rows = list(session.scalars(select(GatewayUsageEventORM)).all())
    if to_ms:
        rows = [r for r in rows if (from_ms or 0) <= r.started_at_ms < to_ms]
    durations = sorted(r.duration_ms for r in rows if r.duration_ms)

    def quantile(values: list[int], fraction: float) -> int:
        if not values:
            return 0
        index = min(len(values) - 1, int(round(fraction * (len(values) - 1))))
        return values[index]

    money_block = _legacy_margin_report(session, from_ms, to_ms)
    report_currency = money_block["report_currency"]
    native = money_block["by_currency"].get(report_currency, {"charge_micro": 0, "cost_micro": 0})
    charge = money_block["report_currency_charge_micro"]
    cost = money_block["report_currency_cost_micro"]
    money_scope = "converted"
    if charge is None or cost is None:
        charge, cost = native["charge_micro"], native["cost_micro"]
        money_scope = "report_currency_only"
    return {
        "requests": len(rows),
        "input_tokens": sum(r.input_tokens for r in rows),
        "output_tokens": sum(r.output_tokens for r in rows),
        "charge_micro": charge,
        "cost_micro": cost,
        "margin_micro": charge - cost,
        "currency": report_currency,
        "money_scope": money_scope,
        "fx_missing": money_block["fx_missing"],
        "latency_p50_ms": quantile(durations, 0.5),
        "latency_p95_ms": quantile(durations, 0.95),
        "ttft_p50_ms": quantile(
            sorted(r.time_to_first_token_ms for r in rows if r.time_to_first_token_ms), 0.5
        ),
        "latency": _legacy_latency_report(rows),
        "estimate_note": aggregates.ESTIMATE_NOTE,
    }


# ------------------------------------------------------------------ fixture


@pytest.fixture()
def seeded(engine_and_sessionmaker, monkeypatch):
    """A rich mixed dataset: names via books, fx hits and misses, failures."""
    monkeypatch.setattr(aggregates, "now_ms", lambda: AT)
    engine, factory = engine_and_sessionmaker
    with factory() as session:
        session.add(UserORM(id="usr_a", name="晓岚", created_at_ms=AT))
        session.add(UserORM(id="usr_b", name="Bob", created_at_ms=AT))
        session.add(
            UpstreamORM(
                id="ups_a", vendor_id="v", name="青岚云", base_url="https://a", created_at_ms=AT
            )
        )
        session.add(
            UpstreamORM(
                id="ups_b", vendor_id="v", name="星环", base_url="https://b", created_at_ms=AT
            )
        )
        session.add(
            UpstreamModelORM(id="um_a", upstream_id="ups_a", name="nebula-01", created_at_ms=AT)
        )
        session.add(
            UpstreamModelORM(id="um_b", upstream_id="ups_b", name="nebula-02", created_at_ms=AT)
        )
        session.add(
            UpstreamModelORM(id="um_ghost", upstream_id="ups_b", name="orphan-um", created_at_ms=AT)
        )
        session.add(PublicModelORM(id="pm_a", name="nebula-chat-1", created_at_ms=AT))
        session.add(PublicModelORM(id="pm_b", name="nebula-chat-2", created_at_ms=AT))
        session.add(
            ApiKeyORM(
                id="key_a",
                user_id="usr_a",
                prefix="sk-aa",
                key_hash="h1",
                key_suffix="AAAA",
                created_at_ms=AT,
            )
        )
        session.add(
            ApiKeyORM(
                id="key_b",
                user_id="usr_b",
                prefix="sk-bb",
                key_hash="h2",
                key_suffix="BBBB",
                created_at_ms=AT,
            )
        )
        session.add(
            FxSnapshotORM(currency="USD", rate_micro=1_500_000, as_of_ms=AT - 1000, source="t")
        )

        def event(
            event_id,
            at_ms,
            *,
            public="nebula-chat-1",
            upstream="nebula-01",
            provider="青岚云",
            key_id="key_a",
            status=200,
            ttft=100,
            duration=1000,
            inp=10,
            outp=5,
            cache_read=0,
            cache_write=0,
        ):
            session.add(
                GatewayUsageEventORM(
                    event_id=event_id,
                    started_at_ms=at_ms,
                    completed_at_ms=at_ms + duration,
                    duration_ms=duration,
                    time_to_first_token_ms=ttft,
                    http_status=status,
                    public_model=public,
                    upstream_model=upstream,
                    provider=provider,
                    api_key_id=key_id,
                    input_tokens=inp,
                    output_tokens=outp,
                    total_tokens=inp + outp,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=cache_write,
                    raw_json=json.dumps({"event_id": event_id}),
                )
            )

        def cost(event_id, amount, currency="CNY", umodel_id="um_a", created=None):
            session.add(
                CostEntryORM(
                    id="co_" + event_id,
                    gateway_event_id=event_id,
                    upstream_model_id=umodel_id,
                    amount_micro=amount,
                    currency=currency,
                    status="ok" if amount is not None else "unpriced",
                    created_at_ms=created if created is not None else _created_of(event_id),
                )
            )

        def charge(
            event_id,
            amount,
            currency="CNY",
            user_id="usr_a",
            key_id="key_a",
            public_id="pm_a",
            status="ok",
            created=None,
        ):
            session.add(
                ChargeEntryORM(
                    id="ce_" + event_id,
                    gateway_event_id=event_id,
                    user_id=user_id,
                    api_key_id=key_id,
                    public_model_id=public_id,
                    amount_micro=amount,
                    currency=currency,
                    status=status,
                    created_at_ms=created if created is not None else _created_of(event_id),
                )
            )

        def _created_of(event_id):
            # entries are created at their event's instant (event ids carry no time,
            # so the seed table below passes created explicitly when it matters)
            return CREATED.pop(event_id, AT)

        CREATED = {}

        # --- in-window events for the 7d/30d day buckets
        spec = [
            # (id, at, public, upstream, provider, key, status, ttft, dur, inp, outp)
            (
                "e_ok_a1",
                _local_ms(2026, 3, 10, 11, 59, 59),
                "nebula-chat-1",
                "nebula-01",
                "青岚云",
                "key_a",
                200,
                100,
                1000,
                10,
                5,
            ),
            (
                "e_ok_b1",
                _local_ms(2026, 3, 10, 0, 0, 0),
                "nebula-chat-2",
                "nebula-02",
                "星环",
                "key_b",
                200,
                200,
                2000,
                100,
                50,
            ),
            (
                "e_ok_a2",
                _local_ms(2026, 3, 9, 23, 59, 59),
                "nebula-chat-1",
                "nebula-01",
                "青岚云",
                "key_a",
                200,
                300,
                3000,
                20,
                8,
            ),
            (
                "e_ok_b2",
                _local_ms(2026, 3, 8, 12, 30, 0),
                "nebula-chat-2",
                "nebula-02",
                "星环",
                "key_b",
                200,
                150,
                1500,
                30,
                12,
            ),
            (
                "e_ok_a3",
                _local_ms(2026, 3, 5, 8, 0, 0),
                "ghost-model",
                "orphan-um",
                "",
                "key_a",
                200,
                250,
                2500,
                7,
                3,
            ),
            (
                "e_err_429",
                _local_ms(2026, 3, 9, 10, 0, 0),
                "nebula-chat-1",
                "nebula-01",
                "青岚云",
                "key_b",
                429,
                0,
                800,
                5,
                0,
            ),
            (
                "e_err_500",
                _local_ms(2026, 3, 7, 18, 0, 0),
                "nebula-chat-2",
                "nebula-02",
                "星环",
                "key_a",
                500,
                40,
                900,
                3,
                1,
            ),
        ]
        created_map = {}
        for row in spec:
            created_map[row[0]] = row[1]
        CREATED.update(created_map)
        for event_id, at, public, upstream, provider, key_id, status, ttft, dur, inp, outp in spec:
            event(
                event_id,
                at,
                public=public,
                upstream=upstream,
                provider=provider,
                key_id=key_id,
                status=status,
                ttft=ttft,
                duration=dur,
                inp=inp,
                outp=outp,
            )
        # entries: ok events priced (one in USD, one EUR without fx, one unpriced)
        cost("e_ok_a1", 800)
        charge("e_ok_a1", 1000)
        cost("e_ok_b1", 2000, currency="USD", umodel_id="um_b")
        charge("e_ok_b1", 3000, currency="USD", user_id="usr_b", key_id="key_b", public_id="pm_b")
        cost("e_ok_a2", 600)
        charge("e_ok_a2", 900, status="free")
        cost("e_ok_b2", 400)
        charge(
            "e_ok_b2", None, status="unpriced", user_id="usr_b", key_id="key_b", public_id="pm_b"
        )
        cost("e_ok_a3", None)  # unpriced
        cost("e_err_429", 0, currency="", umodel_id="um_a")  # failed: 0 cost, no currency
        cost("e_err_500", 0, currency="", umodel_id="um_b")
        # a charge whose public model row is gone (dangling) and one with no charge at all
        charge("e_ok_a3", 700, public_id="pm_gone")
        # an entry created the NEXT day for an in-window event (billing after midnight)
        cost("e_ok_b2_alt", 123, umodel_id="um_b", created=_local_ms(2026, 3, 11, 0, 5))
        CREATED["e_ok_b2_alt"] = _local_ms(2026, 3, 8, 12, 30, 0)
        event(
            "e_ok_b2_alt",
            _local_ms(2026, 3, 8, 12, 30, 0),
            public="nebula-chat-2",
            upstream="nebula-02",
            provider="星环",
            key_id="key_b",
            ttft=90,
            duration=900,
            inp=11,
            outp=4,
        )

        # --- 45 paired latency samples spread over the last 3 local days
        values = [(i * 7 + (i % 3) * 11, 400 + i * 13) for i in range(45)]
        for index, (ttft, dur) in enumerate(values):
            at = _local_ms(2026, 3, 10 - index // 20, 9 + (index % 3), 15)
            event(
                f"e_lat_{index:02d}",
                at,
                key_id="key_a" if index % 2 else "key_b",
                ttft=ttft,
                duration=dur,
                inp=3,
                outp=2,
            )
        # unpaired: ttft only / duration only / both zero
        event("e_unp_ttft", _local_ms(2026, 3, 9, 7, 0), ttft=50, duration=0)
        event("e_unp_dur", _local_ms(2026, 3, 9, 7, 1), ttft=0, duration=500)
        event("e_zeroed", _local_ms(2026, 3, 9, 7, 2), ttft=0, duration=0)

        # --- far out of every window
        event("e_old", _local_ms(2025, 2, 1, 5, 0), ttft=10, duration=100)
        event("e_future", AT + 3_600_000, ttft=10, duration=100)

        # --- cache tokens + an event without a key (anonymous flow node)
        event(
            "e_cache",
            _local_ms(2026, 3, 10, 10, 0),
            inp=1000,
            outp=50,
            cache_read=250,
            cache_write=10,
        )
        cost("e_cache", 55)
        charge("e_cache", 66)
        event(
            "e_anon",
            _local_ms(2026, 3, 10, 10, 5),
            key_id=None,
            public="ghost-model",
            upstream="orphan-um",
            provider="",
        )
        session.commit()

    yield engine, factory


# ------------------------------------------------------------------- helpers


def _strip_new_fields(payload: dict) -> dict:
    payload = copy.deepcopy(payload)
    payload.pop("metrics", None)
    payload["totals"].pop("error_count", None)
    payload["totals"].pop("active_minutes", None)
    # cache token sums and the single-minute peaks postdate the legacy replay;
    # the SQL path pins them in test_reports_v2 and
    # test_new_fields_match_direct_computation instead (hand-computed seed values).
    payload["totals"].pop("cache_read_tokens", None)
    payload["totals"].pop("cache_write_tokens", None)
    payload["totals"].pop("peak_rpm", None)
    payload["totals"].pop("peak_tpm", None)
    return payload


WINDOWS = [
    ("today", "hour"),
    ("24h", "hour"),
    ("7d", "day"),
    ("30d", "day"),
    ("365d", "day"),
]
DIMENSIONS = ("combo", "upstream", "channel")
METRICS = ("requests", "tokens", "input_tokens", "output_tokens", "cost_micro", "charge_micro")


def _window(range_key: str) -> tuple[int, int]:
    from_ms, to_ms, _bucket = aggregates.resolve_range(range_key, TZ, at_ms=AT)
    return from_ms, to_ms


@pytest.mark.parametrize("range_key,bucket", WINDOWS)
@pytest.mark.parametrize("dimension", DIMENSIONS)
@pytest.mark.parametrize("metric", METRICS)
def test_timeseries_matches_legacy(seeded, range_key, bucket, dimension, metric):
    _engine, factory = seeded
    from_ms, to_ms = _window(range_key)
    with factory() as session:
        legacy = _legacy_build_timeseries(
            _legacy_load_report_data(session, from_ms, to_ms),
            range_key=range_key,
            from_ms=from_ms,
            to_ms=to_ms,
            bucket=bucket,
            dimension=dimension,
            metric=metric,
            top_n=10,
            tz=TZ,
        )
        sql = aggregates.build_timeseries(
            session,
            range_key=range_key,
            from_ms=from_ms,
            to_ms=to_ms,
            bucket=bucket,
            dimension=dimension,
            metric=metric,
            top_n=10,
            tz=TZ,
        )
    assert _strip_new_fields(sql) == legacy


def test_timeseries_topn_folding_matches_legacy(seeded):
    _engine, factory = seeded
    from_ms, to_ms = _window("7d")
    with factory() as session:
        legacy = _legacy_build_timeseries(
            _legacy_load_report_data(session, from_ms, to_ms),
            range_key="7d",
            from_ms=from_ms,
            to_ms=to_ms,
            bucket="day",
            dimension="combo",
            metric="tokens",
            top_n=1,
            tz=TZ,
        )
        sql = aggregates.build_timeseries(
            session,
            range_key="7d",
            from_ms=from_ms,
            to_ms=to_ms,
            bucket="day",
            dimension="combo",
            metric="tokens",
            top_n=1,
            tz=TZ,
        )
    assert _strip_new_fields(sql) == legacy
    assert sql["folded_members"] == legacy["folded_members"] > 0


@pytest.mark.parametrize("range_key", ["7d", "30d", "365d"])
@pytest.mark.parametrize("metric", ["tokens", "cost", "spend"])
def test_heatmap_matches_legacy(seeded, range_key, metric):
    _engine, factory = seeded
    from_ms, to_ms = _window(range_key)
    with factory() as session:
        legacy = _legacy_build_heatmap(
            _legacy_load_report_data(session, from_ms, to_ms),
            from_ms=from_ms,
            to_ms=to_ms,
            range_key=range_key,
            metric=metric,
            tz=TZ,
        )
        sql = aggregates.build_heatmap(
            session,
            from_ms=from_ms,
            to_ms=to_ms,
            range_key=range_key,
            metric=metric,
            tz=TZ,
        )
    assert sql == legacy


@pytest.mark.parametrize("range_key", ["", "7d", "30d"])
@pytest.mark.parametrize("metric", ["requests", "tokens"])
def test_flow_matches_legacy(seeded, range_key, metric):
    _engine, factory = seeded
    if range_key:
        from_ms, to_ms = _window(range_key)
    else:
        from_ms, to_ms = 0, AT + 1
    with factory() as session:
        legacy = _legacy_build_flow(
            _legacy_load_report_data(session, from_ms, to_ms),
            metric=metric,
        )
        sql = aggregates.build_flow(session, from_ms=from_ms, to_ms=to_ms, metric=metric)
    assert sql == legacy


def test_latency_matches_legacy_and_p75(seeded):
    _engine, factory = seeded
    from_ms, to_ms = _window("7d")
    with factory() as session:
        rows = list(
            session.scalars(
                select(GatewayUsageEventORM).where(
                    GatewayUsageEventORM.started_at_ms >= from_ms,
                    GatewayUsageEventORM.started_at_ms < to_ms,
                )
            ).all()
        )
        legacy = _legacy_latency_report(rows)
        sql = aggregates.latency_report(session, from_ms=from_ms, to_ms=to_ms)
    paired_ttft = sorted(
        r.time_to_first_token_ms
        for r in rows
        if (r.time_to_first_token_ms or 0) > 0 and (r.duration_ms or 0) > 0
    )
    paired_total = sorted(
        r.duration_ms
        for r in rows
        if (r.time_to_first_token_ms or 0) > 0 and (r.duration_ms or 0) > 0
    )
    assert sql["paired_samples"] == legacy["paired_samples"] == len(paired_ttft) > 0
    assert sql["ttft"].pop("p75_ms") == paired_ttft[math.ceil(0.75 * len(paired_ttft)) - 1]
    assert sql["total"].pop("p75_ms") == paired_total[math.ceil(0.75 * len(paired_total)) - 1]
    assert sql["ttft"] == legacy["ttft"]
    assert sql["total"] == legacy["total"]


def test_overview_matches_legacy(seeded):
    _engine, factory = seeded
    for from_ms, to_ms in ((0, 0), (_window("7d")[0], AT), (AT - 3_600_000, AT)):
        with factory() as session:
            legacy = _legacy_overview(session, from_ms, to_ms)
            stats = aggregates.overview_stats(session, from_ms=from_ms, to_ms=to_ms)
            flat = aggregates.overview_flat_latency(session, from_ms=from_ms, to_ms=to_ms)
            sql = {**stats, **flat, "estimate_note": aggregates.ESTIMATE_NOTE}
        for key in (
            "requests",
            "input_tokens",
            "output_tokens",
            "latency_p50_ms",
            "latency_p95_ms",
            "ttft_p50_ms",
            "latency",
            "estimate_note",
        ):
            actual = sql[key]
            if key == "latency":
                actual = copy.deepcopy(actual)
                actual["ttft"].pop("p75_ms", None)
                actual["total"].pop("p75_ms", None)
            assert actual == legacy[key], (from_ms, to_ms, key)


def test_new_fields_match_direct_computation(seeded):
    """error_count / active_minutes / minute peaks pinned against plain Python."""
    _engine, factory = seeded
    from_ms, to_ms = _window("7d")
    with factory() as session:
        rows = list(
            session.scalars(
                select(GatewayUsageEventORM).where(
                    GatewayUsageEventORM.started_at_ms >= from_ms,
                    GatewayUsageEventORM.started_at_ms < to_ms,
                )
            ).all()
        )
        sql = aggregates.build_timeseries(
            session,
            range_key="7d",
            from_ms=from_ms,
            to_ms=to_ms,
            bucket="day",
            dimension="combo",
            metric="requests",
            top_n=10,
            tz=TZ,
        )
        stats = aggregates.overview_stats(session, from_ms=from_ms, to_ms=to_ms)
    expected_errors = sum(1 for r in rows if r.http_status != 200)
    expected_minutes = len({r.started_at_ms // 60_000 for r in rows})
    # per-LOCAL-minute sums; Asia/Shanghai has a whole-minute offset so the
    # epoch-minute key equals the SQL local-minute key (same shortcut the
    # active_minutes check below has always used)
    minute_requests: dict[int, int] = {}
    minute_tokens: dict[int, int] = {}
    for row in rows:
        key = row.started_at_ms // 60_000
        minute_requests[key] = minute_requests.get(key, 0) + 1
        minute_tokens[key] = minute_tokens.get(key, 0) + (row.input_tokens or 0) + (
            row.output_tokens or 0
        )
    expected_peak_rpm = max(minute_requests.values(), default=0)
    expected_peak_tpm = max(minute_tokens.values(), default=0)
    assert sql["totals"]["error_count"] == expected_errors > 0
    assert sql["totals"]["active_minutes"] == expected_minutes
    assert sql["totals"]["peak_rpm"] == expected_peak_rpm > 0
    assert sql["totals"]["peak_tpm"] == expected_peak_tpm > 0
    assert stats["error_count"] == expected_errors
    assert stats["active_minutes"] == expected_minutes


def test_multi_metric_series(seeded):
    _engine, factory = seeded
    from_ms, to_ms = _window("7d")
    with factory() as session:
        single_cost = aggregates.build_timeseries(
            session,
            range_key="7d",
            from_ms=from_ms,
            to_ms=to_ms,
            bucket="day",
            dimension="combo",
            metric="cost_micro",
            top_n=10,
            tz=TZ,
        )
        both = aggregates.build_timeseries(
            session,
            range_key="7d",
            from_ms=from_ms,
            to_ms=to_ms,
            bucket="day",
            dimension="combo",
            metric="cost_micro",
            metrics=["cost_micro", "charge_micro"],
            top_n=10,
            tz=TZ,
        )
    assert both["metrics"] == ["cost_micro", "charge_micro"]
    assert both["metric"] == "cost_micro"
    # members carry per-series totals on top of the legacy side stats
    by_id = {member["id"]: member for member in both["members"]}
    for member in by_id.values():
        assert member["totals"]["cost_micro"] == member["cost_micro"]
        assert member["totals"]["charge_micro"] == member["charge_micro"]
    assert sum(member["totals"]["charge_micro"] for member in both["members"]) > 0
    # points carry both series per member; single stays flat
    assert isinstance(both["points"][-1]["values"][list(both["points"][-1]["values"])[0]], dict)
    assert isinstance(
        single_cost["points"][-1]["values"][list(single_cost["points"][-1]["values"])[0]], int
    )
    # totals for both series are present; totals.cost_micro equals the single run
    assert both["totals"]["cost_micro"] == single_cost["totals"]["cost_micro"]
    assert both["totals"]["charge_micro"] > 0


# ------------------------------------------------------------------ margin
# W6: prices.margin_report sums moved into SQL (GROUP BY currency). The
# per-row Python loop above (_legacy_margin_report) is the retired algorithm;
# both run over the same fixture and must agree byte for byte. The default
# window (from_ms=0/to_ms=0 -> "all time up to now") is pinned with a frozen
# clock on both sides so the echoed to_ms matches.


@pytest.mark.parametrize(
    "from_ms,to_ms",
    [
        (0, 0),  # default window = all time (both sides now() -> AT via patch)
        (_window("7d")[0], _window("7d")[1]),
        (AT - 3_600_000, AT),
        (AT - 86_400_000, AT + 3_600_000),  # includes the billing-after-midnight entry
    ],
)
def test_margin_report_matches_legacy(seeded, monkeypatch, from_ms, to_ms):
    monkeypatch.setattr(prices, "now_ms", lambda: AT)
    _engine, factory = seeded
    with factory() as session:
        legacy = _legacy_margin_report(session, from_ms, to_ms)
        sql = margin_report(session, from_ms, to_ms)
    assert sql == legacy


def test_margin_report_default_window_covers_everything(seeded, monkeypatch):
    """from_ms<=0/to_ms<=0 means "all time", never the empty [0, 0) window."""
    monkeypatch.setattr(prices, "now_ms", lambda: AT)
    _engine, factory = seeded
    with factory() as session:
        report = margin_report(session)
    assert report["from_ms"] == 0
    assert report["to_ms"] == AT + 1
    assert report["by_currency"]["CNY"]["charge_micro"] > 0
