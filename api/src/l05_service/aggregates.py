"""Dashboard v2 aggregation helpers (ticket 12; SQL aggregation per ADR-022).

Every aggregate the dashboard shows is computed in SQL: GROUP BY over the
gateway_usage_events window joined to the two entry books. Percentile values
are repeated ORDER BY <col> LIMIT 1 OFFSET <rank-1> position queries - never a
whole result set sorted into Python, and no route loads the window's event rows
into a Python loop. The parity suite (test_reports_sql_parity.py) replays the
pre-ADR Python algorithm over the same fixtures to pin the semantics:

* latency quantiles are nearest-rank (ceil(p/100*n)) over *paired* samples
  (TTFT > 0 and TOTAL > 0), and below MIN_PERCENTILE_SAMPLES every value is
  None rather than a misleading 0; the W4-F ``all`` block replays the same
  nearest-rank read over every window event with no pairing filter (p50/p75/p95
  only) so the log page can anchor semantic colour on the full calibre;
* ranges are today/24h/7d/30d/365d and bucket boundaries follow the report
  timezone from app_settings.timezone (default Asia/Shanghai). SQLite strftime
  cannot apply IANA rules, so the SQL groups on integer keys of LOCAL wall
  time: started_at_ms plus a per-segment UTC-offset CASE (segments exact to the
  minute via bisection), then integer-divides - hour key = local_ms/3600000,
  day key = local_ms/86400000. Within a constant-offset zone (Asia/Shanghai
  included) the grouping is exact; a DST transition inside one hour bucket is
  the documented approximation;
* money is integer micro converted into the report currency through the latest
  fx snapshot with the shared round-half-up rule; a currency without a rate is
  excluded from the sum (contributes 0) and listed in fx_missing;
* error_count counts http_status != 200 (the billing definition of a failed
  request, billing.md §6); active_minutes counts distinct LOCAL minutes that
  contain at least one event, failures included;
* peak_rpm / peak_tpm are the busiest single LOCAL minute's request count and
  token sum (GLOSSARY §5 「最高峰」): MAX over the per-minute GROUP BY, collapsed
  inside one SQL statement on the same minute key as active_minutes.

Cost/spend fields are never gated here - the routes run the finished payload
through the money-visibility middleware so a caller without billing:cost gets
responses with no cost keys at all (absence, not null).
"""

from __future__ import annotations

import json
import math
from bisect import bisect_right
from collections.abc import Sequence
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import ApiKeyORM, FxSnapshotORM, UserORM
from l04_repo.repository import get_setting
from l05_service import money

MIN_PERCENTILE_SAMPLES = 5
DEFAULT_TIMEZONE = "Asia/Shanghai"
RANGE_KEYS: tuple[str, ...] = ("today", "24h", "7d", "30d", "365d")
DIMENSION_KEYS: tuple[str, ...] = ("combo", "upstream", "channel")
BUCKET_KEYS: tuple[str, ...] = ("hour", "day")
METRIC_ALIASES = {
    "requests": "requests",
    "tokens": "tokens",
    "token": "tokens",
    "input_tokens": "input_tokens",
    "output_tokens": "output_tokens",
    "cost": "cost_micro",
    "cost_micro": "cost_micro",
    "spend": "charge_micro",
    "charge": "charge_micro",
    "charge_micro": "charge_micro",
}
_MONEY_METRICS = frozenset({"cost_micro", "charge_micro"})
_RANGE_DAYS = {"7d": 7, "30d": 30, "365d": 365}
_MICRO = money.MICRO
_OTHER_PREFIX = "other:"
_FLOW_STAGES: tuple[tuple[str, str], ...] = (
    ("user", "用户"),
    ("key", "连接密钥"),
    ("model", "公开模型"),
    ("upstream", "上游模型"),
    ("channel", "上游"),
)
_STAGE_INDEX = {stage: index for index, (stage, _label) in enumerate(_FLOW_STAGES)}
FLOW_STAGE_IDS: tuple[str, ...] = tuple(stage for stage, _label in _FLOW_STAGES)
ESTIMATE_NOTE = "token amounts fold cache into input (stage B pending)"

_UNIT_MS = {"hour": 3_600_000, "day": 86_400_000}
_MINUTE_MS = 60_000

# Event table alias plus the entry/model joins every money/name aggregate needs.
# One cost entry and at most one charge entry exist per event (idempotent
# billing), so the LEFT JOINs never fan a row out.
_JOINS = """
LEFT JOIN cost_entries c ON c.gateway_event_id = e.event_id
LEFT JOIN charge_entries ch ON ch.gateway_event_id = e.event_id
LEFT JOIN public_models pm ON pm.id = ch.public_model_id
LEFT JOIN upstream_models um ON um.id = c.upstream_model_id
LEFT JOIN upstreams us ON us.id = um.upstream_id
"""

# Dimension member labels, exactly the legacy _member_identity resolution:
# the event column wins, then the book's model row name, then the placeholder.
_MEMBER_EXPR = {
    "combo": "COALESCE(NULLIF(e.public_model, ''), NULLIF(pm.name, ''), '未命名')",
    "upstream": "COALESCE(NULLIF(e.upstream_model, ''), NULLIF(um.name, ''), '未命名')",
    "channel": "COALESCE(NULLIF(us.name, ''), NULLIF(e.provider, ''), '未知上游')",
}
_MEMBER_PREFIX = {"combo": "model:", "upstream": "upstream:", "channel": "channel:"}

_ERROR_COUNT_SQL = "COALESCE(SUM(CASE WHEN e.http_status <> 200 THEN 1 ELSE 0 END), 0)"
_AGG_FIELDS: tuple[str, ...] = (
    "requests",
    "input_tokens",
    "output_tokens",
    "tokens",
    "cost_micro",
    "charge_micro",
)
_METRIC_FIELDS = frozenset(_AGG_FIELDS)

_QUANTILE_COLUMNS = frozenset({"duration_ms", "time_to_first_token_ms"})


def canonical_metric(metric: str) -> str:
    """Map a UI metric name (cost/spend/tokens) to its wire field."""
    return METRIC_ALIASES.get((metric or "").strip().lower(), "requests")


def is_money_metric(metric: str) -> bool:
    return canonical_metric(metric) in _MONEY_METRICS


def resolve_timezone(name: str | None) -> ZoneInfo:
    """Validate an IANA zone; a bad explicit tz is a 422, not a silent UTC fallback."""
    try:
        return ZoneInfo((name or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"unknown timezone: {name}",
            details={"timezone": name},
        ) from None


def report_timezone(session: Session) -> ZoneInfo:
    """Report timezone from app_settings, falling back to the default when unset/bad."""
    raw = get_setting(session, "timezone")
    name = DEFAULT_TIMEZONE
    if raw:
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            parsed = raw
        if isinstance(parsed, str) and parsed.strip():
            name = parsed.strip()
    try:
        return resolve_timezone(name)
    except AppError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def _local(ms: int, tz: ZoneInfo) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=tz)


def _bucket_start(ms: int, bucket: str, tz: ZoneInfo) -> int:
    local = _local(ms, tz)
    if bucket == "hour":
        local = local.replace(minute=0, second=0, microsecond=0)
    else:
        local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(local.timestamp() * 1000)


def resolve_range(
    range_key: str, tz: ZoneInfo, *, at_ms: int | None = None
) -> tuple[int, int, str]:
    """Resolve a UI range into (from_ms, to_ms, bucket).

    today starts at local midnight; 24h is a rolling 24 hourly buckets
    (first bucket floor-aligned); day ranges cover N local days *including today*
    so a 7d chart always has seven day buckets, not six and two half days.
    """
    key = (range_key or "").strip().lower()
    if key not in RANGE_KEYS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"range must be one of {RANGE_KEYS}",
            details={"range": range_key},
        )
    now = int(at_ms if at_ms is not None else now_ms())
    local_now = _local(now, tz)
    if key == "today":
        start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        return int(start.timestamp() * 1000), now, "hour"
    if key == "24h":
        end_hour = local_now.replace(minute=0, second=0, microsecond=0)
        start = end_hour - timedelta(hours=23)
        return int(start.timestamp() * 1000), now, "hour"
    days = _RANGE_DAYS[key]
    start_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days - 1
    )
    return int(start_day.timestamp() * 1000), now, "day"


def bucket_starts(from_ms: int, to_ms: int, bucket: str, tz: ZoneInfo) -> list[int]:
    """Every bucket start overlapping [from_ms, to_ms], local-time aligned."""
    if bucket not in BUCKET_KEYS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"bucket must be one of {BUCKET_KEYS}",
            details={"bucket": bucket},
        )
    cursor = _bucket_start(from_ms, bucket, tz)
    starts: list[int] = []
    while cursor <= to_ms and len(starts) < 10_000:
        starts.append(cursor)
        local = _local(cursor, tz)
        advance = timedelta(hours=1) if bucket == "hour" else timedelta(days=1)
        cursor = int((local + advance).timestamp() * 1000)
    return starts


def bucket_label(start_ms: int, bucket: str, tz: ZoneInfo) -> str:
    local = _local(start_ms, tz)
    return local.strftime("%Y-%m-%d %H:00" if bucket == "hour" else "%Y-%m-%d")


# ---------------------------------------------------------------- SQL helpers

_INDEXED_ENGINES: set[int] = set()


def ensure_report_indexes(session: Session) -> None:
    """ADR-022 consequence: the window filter needs started_at_ms indexed.

    The ORM already declares the column with index=True; this IF NOT EXISTS is a
    belt-and-braces no-op for databases created before that. Runs once per
    engine (memoised) on the session's own connection, never a second one.
    """
    bind = session.get_bind()
    key = id(bind)
    if key in _INDEXED_ENGINES:
        return
    session.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_gateway_usage_events_started_at_ms "
            "ON gateway_usage_events (started_at_ms)"
        )
    )
    _INDEXED_ENGINES.add(key)


def _offset_at(ms: int, tz: ZoneInfo) -> int:
    return int(_local(ms, tz).utcoffset().total_seconds() * 1000)


def _offset_segments(
    tz: ZoneInfo, from_ms: int, to_ms: int
) -> list[tuple[int, int, int]]:
    """UTC-offset runs [start, end) covering [from_ms, to_ms], exact to the minute.

    Zones change offset at DST transitions; probing hourly and bisecting the
    hour down to the minute pins each segment boundary (tzdb transitions are
    minute-aligned). A constant-offset zone yields a single segment.
    """
    if to_ms <= from_ms:
        return [(from_ms, from_ms + 1, _offset_at(from_ms, tz))]
    segments: list[tuple[int, int, int]] = []
    start = from_ms
    current = _offset_at(from_ms, tz)
    cursor = from_ms
    while cursor < to_ms:
        nxt = min(cursor + 3_600_000, to_ms)
        if _offset_at(nxt, tz) != current:
            lo, hi = cursor, nxt
            while hi - lo > _MINUTE_MS:
                mid = (lo + hi) // 2 // _MINUTE_MS * _MINUTE_MS
                if _offset_at(mid, tz) == current:
                    lo = mid
                else:
                    hi = mid
            segments.append((start, hi, current))
            start, current = hi, _offset_at(hi, tz)
        cursor = nxt
    segments.append((start, to_ms + 1, current))
    return segments


def _local_ms_expr(segments: list[tuple[int, int, int]], column: str = "e.started_at_ms") -> str:
    """SQL for local wall-clock ms: started_at_ms plus a per-segment offset CASE.

    Segments are contiguous and ascending, so a >= chain picks the right offset;
    the offsets/boundaries are Python ints, safe to interpolate.
    """
    if len(segments) == 1:
        return f"({column} + {segments[0][2]})"
    whens = " ".join(f"WHEN {column} >= {end} THEN {offset}" for _s, end, offset in segments[:-1])
    return f"({column} + CASE {whens} ELSE {segments[-1][2]} END)"


def _fx_rates(session: Session) -> tuple[str, dict[str, int]]:
    """Report currency plus the latest rate per currency (MICRO-scaled)."""
    settings = get_settings()
    report_currency = ((settings.report_currency or "").strip() or "CNY").upper()
    rates = {report_currency: _MICRO}
    for snapshot in session.scalars(
        select(FxSnapshotORM).order_by(FxSnapshotORM.as_of_ms.desc())
    ).all():
        code = (snapshot.currency or "").strip().upper()
        if code:
            rates.setdefault(code, int(snapshot.rate_micro))
    return report_currency, rates


def _active_currencies(session: Session, from_ms: int, to_ms: int) -> set[str]:
    """Currencies of in-window entries that carry a non-zero amount.

    Legacy fx_missing only fired for non-zero amounts (data.money returned 0
    before ever consulting the rate table), so zero/NULL amounts never flag.
    """
    rows = session.execute(
        text(
            "SELECT DISTINCT UPPER(TRIM(c.currency)) FROM cost_entries c"
            " JOIN gateway_usage_events e ON e.event_id = c.gateway_event_id"
            " WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            " AND c.amount_micro IS NOT NULL AND c.amount_micro != 0"
            " AND TRIM(COALESCE(c.currency, '')) != ''"
            " UNION"
            " SELECT DISTINCT UPPER(TRIM(ch.currency)) FROM charge_entries ch"
            " JOIN gateway_usage_events e ON e.event_id = ch.gateway_event_id"
            " WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            " AND ch.amount_micro IS NOT NULL AND ch.amount_micro != 0"
            " AND TRIM(COALESCE(ch.currency, '')) != ''"
        ),
        {"from_ms": from_ms, "to_ms": to_ms},
    ).all()
    return {row[0] for row in rows}


def _money_case(
    amount_column: str, currency_column: str, params: dict, rates: dict[str, int]
) -> str:
    """SQL converting one entry's amount into report-currency micro.

    Mirrors money.convert + round_micro exactly for non-negative amounts:
    (amount * rate + MICRO/2) // MICRO with SQLite integer division. An empty
    or unknown currency yields 0 - the legacy `converted or 0` behaviour - and
    the caller surfaces it through fx_missing instead of guessing.
    """
    branches = []
    for index, code in enumerate(sorted(rates)):
        rate_key = f"fx_rate_{index}"
        cur_key = f"fx_cur_{index}"
        params[rate_key] = int(rates[code])
        params[cur_key] = code
        branches.append(
            f"WHEN UPPER(TRIM({currency_column})) = :{cur_key} "
            f"THEN (COALESCE({amount_column}, 0) * :{rate_key} + 500000) / 1000000"
        )
    return "CASE " + " ".join(branches) + " ELSE 0 END"


def _fx_missing(session: Session, from_ms: int, to_ms: int, rates: dict[str, int]) -> list[str]:
    return sorted(code for code in _active_currencies(session, from_ms, to_ms) if code not in rates)


def _window_params(from_ms: int, to_ms: int) -> dict:
    return {"from_ms": int(from_ms), "to_ms": int(to_ms)}


def _position_value(
    session: Session,
    column: str,
    where: str,
    params: dict,
    offset: int,
) -> int | None:
    """One ranked value via ORDER BY <col> LIMIT 1 OFFSET <k> (ADR-022 取位查询)."""
    if column not in _QUANTILE_COLUMNS:
        raise ValueError(f"column not allowed in quantile queries: {column}")
    row = session.execute(
        text(
            f"SELECT e.{column} FROM gateway_usage_events e WHERE {where} "
            f"ORDER BY e.{column} LIMIT 1 OFFSET :rank"
        ),
        {**params, "rank": int(offset)},
    ).first()
    return None if row is None else int(row[0])


def _nearest_rank_offset(fraction: float, count: int) -> int | None:
    """OFFSET for the nearest-rank percentile; None when there are no samples."""
    if count <= 0:
        return None
    rank = max(1, math.ceil(fraction * count))
    return min(rank, count) - 1


def _rounded_index(fraction: float, count: int) -> int | None:
    """OFFSET for the legacy overview quantile (index = round(f * (n - 1)))."""
    if count <= 0:
        return None
    return min(count - 1, round(fraction * (count - 1)))


# ------------------------------------------------------------------ overview


def overview_stats(session: Session, *, from_ms: int, to_ms: int) -> dict:
    """Overview counters, all in SQL.

    The legacy route only filtered rows when to_ms was set (an argument-less
    call reports all time); money keeps flowing through prices.margin_report.
    active_minutes dedups epoch minutes - the overview route has no timezone
    parameter, and for fixed-offset report zones (Asia/Shanghai) the epoch and
    wall minute agree.
    """
    ensure_report_indexes(session)
    params: dict = {}
    if int(to_ms or 0) > 0:
        params = {"from_ms": max(int(from_ms or 0), 0), "to_ms": int(to_ms)}
        where = "e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
    else:
        where = "1=1"
    requests, input_tokens, output_tokens, cache_read, cache_write, error_count, active_minutes = (
        session.execute(
            text(
                f"SELECT COUNT(*),"
                f" COALESCE(SUM(e.input_tokens), 0), COALESCE(SUM(e.output_tokens), 0),"
                f" COALESCE(SUM(e.cache_read_tokens), 0), COALESCE(SUM(e.cache_write_tokens), 0),"
                f" {_ERROR_COUNT_SQL},"
                f" COUNT(DISTINCT (e.started_at_ms) / {_MINUTE_MS})"
                f" FROM gateway_usage_events e WHERE {where}"
            ),
            params,
        ).one()
    )
    return {
        "requests": int(requests),
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        # Same window/filter as input/output_tokens; the report input_tokens is
        # the cache-folded figure (input = net + cache), so the dashboard derives
        # net input as input_tokens - cache_read_tokens - cache_write_tokens
        # (GLOSSARY §5).
        "cache_read_tokens": int(cache_read),
        "cache_write_tokens": int(cache_write),
        "error_count": int(error_count),
        "active_minutes": int(active_minutes),
        "latency": latency_report(session, from_ms=from_ms, to_ms=to_ms),
    }


# Nearest-rank quantile sets per block kind: the paired blocks keep the legacy
# p99 read, while the W4-F all-sample block only carries the p50/p75/p95 anchors
# the semantic colour needs (DESIGN-AUDIT §11).
_PAIRED_FRACTIONS: tuple[tuple[str, float], ...] = (
    ("p50_ms", 0.50),
    ("p75_ms", 0.75),
    ("p95_ms", 0.95),
    ("p99_ms", 0.99),
)
_ALL_FRACTIONS: tuple[tuple[str, float], ...] = (
    ("p50_ms", 0.50),
    ("p75_ms", 0.75),
    ("p95_ms", 0.95),
)


def _latency_block_sql(
    session: Session,
    where: str,
    params: dict,
    column: str,
    *,
    min_samples: int,
    fractions: tuple[tuple[str, float], ...] = _PAIRED_FRACTIONS,
) -> dict:
    """Nearest-rank quantiles over the ranked column via OFFSET position reads."""
    count = session.execute(
        text(f"SELECT COUNT(*) FROM gateway_usage_events e WHERE {where}"), params
    ).scalar_one()
    sufficient = count >= min_samples
    block: dict = {"samples": int(count)}
    for name, fraction in fractions:
        offset = _nearest_rank_offset(fraction, count) if sufficient else None
        value = (
            _position_value(session, column, where, params, offset) if offset is not None else None
        )
        block[name] = value
    return block


def latency_report(
    session: Session, *, from_ms: int, to_ms: int, min_samples: int = MIN_PERCENTILE_SAMPLES
) -> dict:
    """TTFT/TOTAL quantiles in two calibres: the legacy paired set and W4-F all.

    ``ttft``/``total`` are the paired blocks: a sample enters only when
    ttft > 0 AND duration > 0, so non-streaming requests (ttft = 0) never
    contaminate them; p50/p75/p95/p99 nearest-rank. ``all`` is the same window
    with NO pairing filter - every event feeds both columns, which is the
    calibre the log page's semantic colour anchors on (a non-streaming row has
    a real total duration even though its ttft is 0, so excluding it would
    skew the tone anchors); it carries p50/p75/p95 only. Each block applies the
    min_samples rule independently, and below it every quantile of that block
    is None rather than a misleading 0.
    """
    ensure_report_indexes(session)
    params: dict = {}
    if int(to_ms or 0) > 0:
        params = {"from_ms": max(int(from_ms or 0), 0), "to_ms": int(to_ms)}
        window = "e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
        paired_where = window + " AND e.time_to_first_token_ms > 0 AND e.duration_ms > 0"
    else:
        # to_ms=0 keeps the legacy all-time calibre (0=全时段): no started_at
        # clause at all, only the pairing filter on the paired block.
        window = "1=1"
        paired_where = "e.time_to_first_token_ms > 0 AND e.duration_ms > 0"
    paired_samples = int(
        session.execute(
            text(f"SELECT COUNT(*) FROM gateway_usage_events e WHERE {paired_where}"), params
        ).scalar_one()
    )
    all_samples = int(
        session.execute(
            text(f"SELECT COUNT(*) FROM gateway_usage_events e WHERE {window}"), params
        ).scalar_one()
    )
    return {
        "paired_samples": paired_samples,
        "min_samples": min_samples,
        "ttft": _latency_block_sql(
            session, paired_where, params, "time_to_first_token_ms", min_samples=min_samples
        ),
        "total": _latency_block_sql(
            session, paired_where, params, "duration_ms", min_samples=min_samples
        ),
        "all": {
            "samples": all_samples,
            "ttft": _latency_block_sql(
                session,
                window,
                params,
                "time_to_first_token_ms",
                min_samples=min_samples,
                fractions=_ALL_FRACTIONS,
            ),
            "total": _latency_block_sql(
                session,
                window,
                params,
                "duration_ms",
                min_samples=min_samples,
                fractions=_ALL_FRACTIONS,
            ),
        },
    }


def _legacy_flat_quantile(
    session: Session, column: str, where: str, params: dict, fraction: float
) -> int:
    """The old overview quantile: index round(f*(n-1)) over the ranked column, 0 when empty."""
    count = session.execute(
        text(f"SELECT COUNT(*) FROM gateway_usage_events e WHERE {where}"), params
    ).scalar_one()
    index = _rounded_index(fraction, int(count))
    if index is None:
        return 0
    value = _position_value(session, column, where, params, index)
    return int(value) if value is not None else 0


def overview_flat_latency(session: Session, *, from_ms: int, to_ms: int) -> dict:
    """latency_p50_ms / latency_p95_ms / ttft_p50_ms exactly as the legacy route."""
    params: dict = {}
    if int(to_ms or 0) > 0:
        params = {"from_ms": max(int(from_ms or 0), 0), "to_ms": int(to_ms)}
        window = "e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
    else:
        window = "1=1"
    return {
        "latency_p50_ms": _legacy_flat_quantile(
            session, "duration_ms", f"{window} AND e.duration_ms > 0", params, 0.5
        ),
        "latency_p95_ms": _legacy_flat_quantile(
            session, "duration_ms", f"{window} AND e.duration_ms > 0", params, 0.95
        ),
        "ttft_p50_ms": _legacy_flat_quantile(
            session,
            "time_to_first_token_ms",
            f"{window} AND e.time_to_first_token_ms > 0",
            params,
            0.5,
        ),
    }


# --------------------------------------------------------------------- trend


def trend_daily(session: Session, *, from_ms: int) -> dict[str, dict[str, int]]:
    """Legacy UTC-day buckets for /admin/reports/trend, aggregated in SQL.

    Same semantics as the Python loop it replaces: events count from their
    started day, cost entries from created day when priced, charge entries only
    in ok/free status; no upper bound (the caller owns the window).
    """
    ensure_report_indexes(session)
    params = {"from_ms": int(from_ms)}

    def day_of(day_key: int) -> str:
        return (datetime(1970, 1, 1) + timedelta(days=int(day_key))).strftime("%Y-%m-%d")

    buckets: dict[str, dict[str, int]] = {}

    def _bucket_of(day_key: int) -> dict[str, int]:
        return buckets.setdefault(
            day_of(day_key),
            {
                "requests": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_micro": 0,
                "charge_micro": 0,
            },
        )

    for day_key, requests, input_tokens, output_tokens in session.execute(
        text(
            "SELECT e.started_at_ms/86400000 AS day_key, COUNT(*),"
            " COALESCE(SUM(e.input_tokens), 0), COALESCE(SUM(e.output_tokens), 0)"
            " FROM gateway_usage_events e WHERE e.started_at_ms >= :from_ms"
            " GROUP BY day_key"
        ),
        params,
    ).all():
        entry = _bucket_of(day_key)
        entry["requests"] += int(requests)
        entry["input_tokens"] += int(input_tokens)
        entry["output_tokens"] += int(output_tokens)
    for day_key, amount in session.execute(
        text(
            "SELECT c.created_at_ms/86400000 AS day_key, COALESCE(SUM(c.amount_micro), 0)"
            " FROM cost_entries c"
            " WHERE c.amount_micro IS NOT NULL AND c.created_at_ms >= :from_ms"
            " GROUP BY day_key"
        ),
        params,
    ).all():
        _bucket_of(day_key)["cost_micro"] += int(amount)
    for day_key, amount in session.execute(
        text(
            "SELECT ch.created_at_ms/86400000 AS day_key, COALESCE(SUM(ch.amount_micro), 0)"
            " FROM charge_entries ch"
            " WHERE ch.amount_micro IS NOT NULL AND ch.status IN ('ok', 'free')"
            " AND ch.created_at_ms >= :from_ms"
            " GROUP BY day_key"
        ),
        params,
    ).all():
        _bucket_of(day_key)["charge_micro"] += int(amount)
    return buckets


# ---------------------------------------------------------------- timeseries


def _key_of_position(starts: list[int], bucket: str, tz: ZoneInfo) -> list[int]:
    """SQL group key of every bucket start (local wall units since epoch)."""
    return [(_offset_at(start, tz) + start) // _UNIT_MS[bucket] for start in starts]


def _position_of_key(keys: list[int], key: int) -> int:
    """Bucket position for a SQL group key; exact when zones are constant-offset.

    A DST transition inside one bucket can shift an event's key off its bucket's
    own key; clamping to the nearest lower bucket start keeps such events (the
    documented approximation) instead of dropping them.
    """
    index = bisect_right(keys, key) - 1
    return index if index >= 0 else 0


def build_timeseries(
    session: Session,
    *,
    range_key: str,
    from_ms: int,
    to_ms: int,
    bucket: str,
    dimension: str,
    metric: str,
    top_n: int,
    tz: ZoneInfo,
    metrics: list[str] | None = None,
) -> dict:
    """Bucketed series split by one dimension, aggregated in SQL (ADR-022).

    `metrics` extends the single `metric` with a comma list (cost_micro +
    charge_micro in one round trip); the first entry drives ranking, share and
    the legacy scalar fields so single-metric responses stay byte-compatible.
    """
    series = list(dict.fromkeys(metrics)) if metrics else [canonical_metric(metric)]
    # The first requested series drives ranking/share and the legacy scalar
    # fields; with the singular `metric` the canonical form stays the driver.
    primary = series[0]
    if not series or any(item not in _METRIC_FIELDS for item in series):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "metric must be requests/tokens/input_tokens/output_tokens/cost/spend",
            details={"metric": metrics or metric},
        )
    if dimension not in DIMENSION_KEYS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            f"dimension must be one of {DIMENSION_KEYS}",
            details={"dimension": dimension},
        )
    if top_n < 1 or top_n > 50:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "top_n must be between 1 and 50",
            details={"top_n": top_n},
        )
    ensure_report_indexes(session)
    starts = bucket_starts(from_ms, to_ms, bucket, tz)
    params = _window_params(from_ms, to_ms)
    _report_currency, rates = _fx_rates(session)
    cost_case = _money_case("c.amount_micro", "c.currency", params, rates)
    charge_case = _money_case("ch.amount_micro", "ch.currency", params, rates)
    member_expr = _MEMBER_EXPR[dimension]
    local_expr = _local_ms_expr(_offset_segments(tz, from_ms, to_ms))
    bucket_key_sql = f"({local_expr}) / {_UNIT_MS[bucket]}"
    grouped = session.execute(
        text(
            f"SELECT {bucket_key_sql} AS bucket_key, {member_expr} AS member,"
            f" COUNT(*) AS requests,"
            f" COALESCE(SUM(e.input_tokens), 0) AS input_tokens,"
            f" COALESCE(SUM(e.output_tokens), 0) AS output_tokens,"
            f" COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,"
            f" COALESCE(SUM({cost_case}), 0) AS cost_micro,"
            f" COALESCE(SUM({charge_case}), 0) AS charge_micro"
            f" FROM gateway_usage_events e {_JOINS}"
            f" WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            f" GROUP BY {bucket_key_sql}, {member_expr}"
        ),
        params,
    ).all()
    totals_row = session.execute(
        text(
            f"SELECT COUNT(*) AS requests,"
            f" COALESCE(SUM(e.input_tokens), 0) AS input_tokens,"
            f" COALESCE(SUM(e.output_tokens), 0) AS output_tokens,"
            f" COALESCE(SUM(e.cache_read_tokens), 0) AS cache_read_tokens,"
            f" COALESCE(SUM(e.cache_write_tokens), 0) AS cache_write_tokens,"
            f" COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,"
            f" COALESCE(SUM({cost_case}), 0) AS cost_micro,"
            f" COALESCE(SUM({charge_case}), 0) AS charge_micro,"
            f" {_ERROR_COUNT_SQL} AS error_count,"
            f" COUNT(DISTINCT ({local_expr}) / {_MINUTE_MS}) AS active_minutes"
            f" FROM gateway_usage_events e {_JOINS}"
            f" WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
        ),
        params,
    ).one()
    # Single-minute peaks (GLOSSARY §5 「最高峰」): MAX over the per-minute GROUP
    # BY collapsed inside SQL (ADR-022 - no minute rows reach Python), on the
    # same LOCAL minute key as active_minutes. peak_tpm sums the same token
    # figure as the totals.tokens column (folded input + output).
    peak_row = session.execute(
        text(
            f"SELECT COALESCE(("
            f" SELECT MAX(per_minute.minute_requests) FROM ("
            f"  SELECT COUNT(*) AS minute_requests FROM gateway_usage_events e"
            f"  WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            f"  GROUP BY ({local_expr}) / {_MINUTE_MS}"
            f" ) AS per_minute), 0),"
            f" COALESCE(("
            f" SELECT MAX(per_minute.minute_tokens) FROM ("
            f"  SELECT COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS minute_tokens"
            f"  FROM gateway_usage_events e"
            f"  WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            f"  GROUP BY ({local_expr}) / {_MINUTE_MS}"
            f" ) AS per_minute), 0)"
        ),
        params,
    ).one()

    # bucket_groups[bucket_position][member] = per-field sums; member_agg folds across buckets.
    position_keys = _key_of_position(starts, bucket, tz)
    bucket_groups: dict[int, dict[str, dict[str, int]]] = {}
    member_agg: dict[str, dict[str, int]] = {}
    for row in grouped:
        position = _position_of_key(position_keys, int(row[0]))
        member = _MEMBER_PREFIX[dimension] + str(row[1])
        values = {
            "requests": int(row[2]),
            "input_tokens": int(row[3]),
            "output_tokens": int(row[4]),
            "tokens": int(row[5]),
            "cost_micro": int(row[6]),
            "charge_micro": int(row[7]),
        }
        row_group = bucket_groups.setdefault(position, {}).setdefault(member, {})
        for field, value in values.items():
            row_group[field] = row_group.get(field, 0) + value
            agg = member_agg.setdefault(member, {})
            agg[field] = agg.get(field, 0) + value

    ranked = sorted(
        member_agg.items(),
        key=lambda item: (-item[1].get(primary, 0), item[0]),
    )
    selected = ranked[:top_n]
    folded = ranked[top_n:]
    other_id = _OTHER_PREFIX + dimension
    if folded:
        selected.append((other_id, {}))
        _fields = _AGG_FIELDS
        folded_ids = [member for member, _agg in folded]
        for field in _fields:
            member_agg[other_id] = member_agg.get(other_id, {})
            member_agg[other_id][field] = sum(agg.get(field, 0) for member, agg in folded)
        # The "other" series keeps its own per-bucket members (legacy folded the
        # per-bucket metric values, not the across-bucket totals).
        for position in list(bucket_groups):
            bucket_members = bucket_groups[position]
            entry = bucket_members.setdefault(other_id, {})
            for field in _fields:
                entry[field] = sum(
                    bucket_members.get(member, {}).get(field, 0) for member in folded_ids
                )
    total_metric = sum(agg.get(primary, 0) for _member, agg in ranked)

    members = []
    for member_id, _agg in selected:
        label = (
            f"其他（{len(folded)}）" if member_id == other_id else member_id.split(":", 1)[1]
        )
        entry = {
            "id": member_id,
            "label": label,
            "total": member_agg.get(member_id, {}).get(primary, 0),
            "share": (
                round(member_agg.get(member_id, {}).get(primary, 0) / total_metric, 6)
                if total_metric
                else 0.0
            ),
            "requests": member_agg.get(member_id, {}).get("requests", 0),
            "tokens": member_agg.get(member_id, {}).get("tokens", 0),
            "cost_micro": member_agg.get(member_id, {}).get("cost_micro", 0),
            "charge_micro": member_agg.get(member_id, {}).get("charge_micro", 0),
        }
        if len(series) > 1:
            entry["totals"] = {name: member_agg.get(member_id, {}).get(name, 0) for name in series}
        members.append(entry)

    member_ids = [member["id"] for member in members]
    multi = len(series) > 1
    points = []
    for position, start in enumerate(starts):
        bucket_members = bucket_groups.get(position, {})
        if multi:
            values = {
                member_id: {name: bucket_members.get(member_id, {}).get(name, 0) for name in series}
                for member_id in member_ids
            }
            total = sum(v[primary] for v in values.values())
        else:
            values = {
                member_id: bucket_members.get(member_id, {}).get(primary, 0)
                for member_id in member_ids
            }
            total = sum(values.values())
        points.append(
            {
                "bucket_start_ms": start,
                "label": bucket_label(start, bucket, tz),
                "total": total,
                "values": values,
            }
        )
    payload = {
        "range": range_key,
        "bucket": bucket,
        "dimension": dimension,
        "metric": primary,
        "metrics": series,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "timezone": str(tz),
        "currency": _report_currency,
        "points": points,
        "members": members,
        # totals always carries every key regardless of the requested series so
        # the payload shape stays stable; cache sums share the window/filter of
        # input_tokens, which is the cache-folded figure (input = net + cache,
        # net input = input_tokens - cache_read_tokens - cache_write_tokens,
        # GLOSSARY §5). peak_rpm/peak_tpm are the busiest LOCAL minute's
        # request/token totals (GLOSSARY §5 「最高峰」), 0 on an empty window.
        "totals": {
            "requests": int(totals_row[0]),
            "input_tokens": int(totals_row[1]),
            "output_tokens": int(totals_row[2]),
            "cache_read_tokens": int(totals_row[3]),
            "cache_write_tokens": int(totals_row[4]),
            "tokens": int(totals_row[5]),
            "cost_micro": int(totals_row[6]),
            "charge_micro": int(totals_row[7]),
            "error_count": int(totals_row[8]),
            "active_minutes": int(totals_row[9]),
            "peak_rpm": int(peak_row[0]),
            "peak_tpm": int(peak_row[1]),
        },
        "metric_total": total_metric,
        "folded_members": len(folded),
        "fx_missing": _fx_missing(session, from_ms, to_ms, rates),
        "estimate_note": ESTIMATE_NOTE,
    }
    return payload


# ------------------------------------------------------------------- heatmap


def build_heatmap(
    session: Session,
    *,
    from_ms: int,
    to_ms: int,
    range_key: str,
    metric: str,
    tz: ZoneInfo,
) -> dict:
    """Weekday×hour (7d) or date×hour (30d/365d) matrix in the report timezone.

    Arbitrary-window rule for range_key="custom" (dashboard 自定义区间): a span
    <= 7 days keeps the compact 7-row weekday×hour layout, longer spans use
    date×hour with one row per LOCAL calendar day covered by [from_ms, to_ms)
    (the 30d/365d shape, so a window from 03-01 12:00 to 03-10 12:00 has the
    ten rows 03-01..03-10); the "%m-%d" vs ISO label split still keys off the
    row count (<= 30 rows get short labels). max/total stay plain cell sums,
    independent of the mode. Weekday/date mapping and the SQL GROUP BY are
    shared with the enum branches - only the row inventory differs.
    """
    canonical = canonical_metric(metric)
    if canonical not in ("tokens", "cost_micro", "charge_micro"):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "heatmap metric must be tokens, cost or spend",
            details={"metric": metric},
        )
    if range_key == "7d":
        mode = "weekday_hour"
    elif range_key in ("30d", "365d"):
        mode = "date_hour"
        days = _RANGE_DAYS[range_key]
    elif range_key == "custom":
        span = to_ms - from_ms
        if span <= 7 * _UNIT_MS["day"]:
            mode = "weekday_hour"
        else:
            mode = "date_hour"
            days = (_local(to_ms - 1, tz).date() - _local(from_ms, tz).date()).days + 1
    else:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "heatmap range must be 7d, 30d, 365d or custom",
            details={"range": range_key},
        )
    if mode == "weekday_hour":
        row_keys = [str(day) for day in range(1, 8)]
        row_labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    else:
        start_local = _local(from_ms, tz).replace(hour=0, minute=0, second=0, microsecond=0)
        row_keys, row_labels = [], []
        for offset in range(days):
            day = (start_local + timedelta(days=offset)).date()
            row_keys.append(day.isoformat())
            row_labels.append(day.strftime("%m-%d") if days <= 30 else day.isoformat())
    row_index = {key: index for index, key in enumerate(row_keys)}
    ensure_report_indexes(session)
    params = _window_params(from_ms, to_ms)
    _report_currency, rates = _fx_rates(session)
    joins = ""
    if canonical == "tokens":
        value_sql = "(e.input_tokens + e.output_tokens)"
    else:
        joins = _JOINS
        if canonical == "cost_micro":
            amount, currency = "c.amount_micro", "c.currency"
        else:
            amount, currency = "ch.amount_micro", "ch.currency"
        value_sql = _money_case(amount, currency, params, rates)
    local_expr = _local_ms_expr(_offset_segments(tz, from_ms, to_ms))
    rows = session.execute(
        text(
            f"SELECT ({local_expr}) / 86400000 AS day_key,"
            f" (({local_expr}) / 3600000) % 24 AS hour_of_day,"
            f" COALESCE(SUM({value_sql}), 0) AS value"
            f" FROM gateway_usage_events e {joins}"
            f" WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            f" GROUP BY day_key, hour_of_day"
        ),
        params,
    ).all()
    matrix = [[0 for _hour in range(24)] for _row in row_keys]
    for day_key, hour_of_day, value in rows:
        row = _heatmap_row(mode, int(day_key), row_index)
        if row is not None:
            matrix[row][int(hour_of_day)] += int(value)
    return {
        "range": range_key,
        "mode": mode,
        "metric": canonical,
        "from_ms": from_ms,
        "to_ms": to_ms,
        "timezone": str(tz),
        "currency": _report_currency,
        "columns": [{"key": str(hour), "label": f"{hour:02d}"} for hour in range(24)],
        "rows": [
            {"key": key, "label": label, "values": matrix[index]}
            for index, (key, label) in enumerate(zip(row_keys, row_labels, strict=False))
        ],
        "max": max((value for row in matrix for value in row), default=0),
        "total": sum(sum(row) for row in matrix),
        "fx_missing": _fx_missing(session, from_ms, to_ms, rates) if canonical != "tokens" else [],
        "estimate_note": ESTIMATE_NOTE,
    }


def _heatmap_row(mode: str, day_key: int, row_index: dict) -> int | None:
    """Matrix row for a local-epoch-day key: weekday (7d) or date (30d/365d)."""
    if mode == "weekday_hour":
        weekday = ((day_key + 3) % 7) + 1  # epoch day 0 was a Thursday
        return row_index.get(str(weekday))
    date = (datetime(1970, 1, 1) + timedelta(days=day_key)).date().isoformat()
    return row_index.get(date)


# ---------------------------------------------------------------------- flow


def build_flow(
    session: Session,
    *,
    from_ms: int,
    to_ms: int,
    metric: str = "requests",
    collapse: Sequence[str] | None = None,
) -> dict:
    """Five-stage Sankey: 用户 -> 连接密钥 -> 公开模型 -> 上游模型 -> 上游.

    nodes stays a list of stable ids for chart wiring; readable labels and the
    stage live in node_meta. Requests and tokens ride every edge (conserved);
    spend is attached to the user edge and cost to the channel edge so each
    money total appears exactly once. The GROUP BY returns one row per distinct
    five-stage path; the four edges per path are folded in Python over that
    small aggregated set.

    A 'collapse' set hides stages by projecting every aggregated five-tuple
    path onto the visible stages: hidden stages are removed from the path and
    the remaining neighbours are linked in order, so nodes/edges stay
    conserved, charge anchors on the first visible edge, cost on the last, and
    totals fold the full path once. With no collapse the payload is the legacy
    five-stage output unchanged.
    """
    canonical = canonical_metric(metric)
    if canonical not in ("requests", "tokens"):
        canonical = "requests"
    hidden = set(collapse or ())
    unknown = hidden - set(_STAGE_INDEX)
    if unknown:
        raise ValueError(f"未知的 flow 阶段：{', '.join(sorted(unknown))}")
    visible = [index for index in range(len(_FLOW_STAGES)) if _FLOW_STAGES[index][0] not in hidden]
    if len(visible) < 2:
        raise ValueError("collapse 后至少保留 2 个阶段")
    ensure_report_indexes(session)
    params = _window_params(from_ms, to_ms)
    _report_currency, rates = _fx_rates(session)
    cost_case = _money_case("c.amount_micro", "c.currency", params, rates)
    charge_case = _money_case("ch.amount_micro", "ch.currency", params, rates)
    model_expr = _MEMBER_EXPR["combo"]
    upstream_expr = _MEMBER_EXPR["upstream"]
    channel_expr = _MEMBER_EXPR["channel"]
    paths = session.execute(
        text(
            f"SELECT ch.user_id AS user_id,"
            f" COALESCE(ch.api_key_id, e.api_key_id) AS key_id,"
            f" {model_expr} AS model_label,"
            f" {upstream_expr} AS upstream_label,"
            f" {channel_expr} AS channel_label,"
            f" COUNT(*) AS requests,"
            f" COALESCE(SUM(e.input_tokens + e.output_tokens), 0) AS tokens,"
            f" COALESCE(SUM({cost_case}), 0) AS cost_micro,"
            f" COALESCE(SUM({charge_case}), 0) AS charge_micro"
            f" FROM gateway_usage_events e {_JOINS}"
            f" WHERE e.started_at_ms >= :from_ms AND e.started_at_ms < :to_ms"
            f" GROUP BY user_id, key_id, model_label, upstream_label, channel_label"
        ),
        params,
    ).all()
    users = {row.id: row.name for row in session.scalars(select(UserORM)).all()}
    keys: dict[str, str] = {}
    for row in session.scalars(select(ApiKeyORM)).all():
        suffix = row.key_suffix or ""
        prefix = row.prefix or "sk-"
        keys[row.id] = (prefix + "…" + suffix) if suffix else row.id

    links: dict[tuple[str, str], dict[str, int]] = {}
    node_meta: dict[str, dict] = {}
    node_values: dict[str, int] = {}
    totals = {"requests": 0, "tokens": 0, "cost_micro": 0, "charge_micro": 0}

    def node(node_id: str, label: str, stage: str) -> None:
        node_meta.setdefault(node_id, {"id": node_id, "label": label, "stage": stage})

    for row in paths:
        user_id = row[0]
        key_id = row[1]
        public_name = row[2]
        upstream_name = row[3]
        channel_name = row[4]
        requests = int(row[5])
        tokens = int(row[6])
        cost_micro = int(row[7])
        charge_micro = int(row[8])
        user_node = f"user:{user_id or 'anonymous'}"
        key_node = f"key:{key_id or 'none'}"
        model_node = f"model:{public_name}"
        upstream_node = f"umodel:{upstream_name}"
        channel_node = f"channel:{channel_name}"
        all_nodes = (user_node, key_node, model_node, upstream_node, channel_node)
        all_labels = (
            users.get(user_id, "未登录") if user_id else "未登录",
            keys.get(key_id, "无密钥") if key_id else "无密钥",
            public_name,
            upstream_name,
            channel_name,
        )
        # Path projection: hiding a stage reconnects the remaining stages; it
        # never drops or invents an edge. The aggregated five-tuple row is the
        # smallest unit a path has, so projection is exact and conserved.
        visible_pairs = [(index, all_nodes[index], all_labels[index]) for index in visible]
        for index, visible_id, label in visible_pairs:
            node(visible_id, label, _FLOW_STAGES[index][0])
        visible_nodes = [item[1] for item in visible_pairs]
        edges = tuple(zip(visible_nodes, visible_nodes[1:], strict=False))
        for position, (source, target) in enumerate(edges):
            slot = links.setdefault(
                (source, target),
                {"requests": 0, "tokens": 0, "cost_micro": 0, "charge_micro": 0},
            )
            slot["requests"] += requests
            slot["tokens"] += tokens
            if position == 0:
                slot["charge_micro"] += charge_micro
            if position == len(edges) - 1:
                slot["cost_micro"] += cost_micro
        totals["requests"] += requests
        totals["tokens"] += tokens
        totals["cost_micro"] += cost_micro
        totals["charge_micro"] += charge_micro
        step = requests if canonical == "requests" else tokens
        for visible_id in visible_nodes:
            node_values[visible_id] = node_values.get(visible_id, 0) + step

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
            _STAGE_INDEX[node_meta[node_id]["stage"]],
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
        "stages": [
            {"id": _FLOW_STAGES[index][0], "label": _FLOW_STAGES[index][1]} for index in visible
        ],
        "totals": totals,
        "currency": _report_currency,
        "fx_missing": _fx_missing(session, from_ms, to_ms, rates),
        "estimate_note": ESTIMATE_NOTE,
    }
