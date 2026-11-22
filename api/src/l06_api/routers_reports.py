"""Dashboard report routes (v2): overview, latency, timeseries, heatmap, flow.

Contract highlights (all require reports:read; money fields pass through the
money-visibility middleware, so a caller without billing:cost/billing:spend
gets responses with the keys absent rather than null):

* GET /admin/reports/overview   - legacy flat summary + latency block + error/active minutes
* GET /admin/reports/latency    - paired p50/p75/p95/p99 + W4-F all-sample p50/p75/p95
* GET /admin/reports/timeseries - range/bucket/dimension/metric(s)/topN + members
* GET /admin/reports/heatmap    - 7d weekday×hour or 30d/365d date×hour matrix
* GET /admin/reports/flow       - five stages user→key→model→upstream model→upstream

Every aggregate is computed in SQL (ADR-022): GROUP BY over the usage-event
window, percentiles via ORDER BY + OFFSET position reads - no route loads the
window's event rows into Python. Range keys are today/24h/7d/30d/365d; bucket
boundaries follow app_settings timezone (default Asia/Shanghai). Money is
integer micro in the report currency.

latency/timeseries/heatmap/flow also accept an explicit millisecond window via
the optional from_ms/to_ms query pair (dashboard 本周/本月/自定义): both given
overrides the range enum and one alone or an invalid pair is a 422. For
timeseries/heatmap/flow neither param keeps the enum behaviour byte-identical;
latency since W4-F reports the all-time calibre instead (0=全时段, payload
"range" reads "all") so the log page can omit the window and stay aligned with
/admin/logs. See _window_override.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.timeutil import now_ms
from l05_service import aggregates, auth, rbac
from l05_service.prices import margin_report
from l06_api.deps import raise_span_over_cap, require, session_of, validate_window_pair
from l06_api.report_schemas import (
    FlowReportOut,
    HeatmapReportOut,
    LatencyReportOut,
    ReportsOverviewOut,
    TimeseriesReportOut,
)

router = APIRouter(tags=["reports"])

_METRICS = ("requests", "input_tokens", "output_tokens", "cost_micro", "charge_micro")
_RANGES_MS = {"7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000}
_ESTIMATE_NOTE = aggregates.ESTIMATE_NOTE
_HEATMAP_RANGES = ("7d", "30d", "365d")


def _window(range_key: str, to_ms: int) -> tuple[int, int]:
    """Legacy fixed-width window for /trend (kept byte-compatible with v1)."""
    span = _RANGES_MS.get(range_key)
    if span is None:
        span = _RANGES_MS["30d"]
    return to_ms - span, to_ms


def _range_window(range_key: str, to_ms: int, tz) -> tuple[int, int, str]:
    return aggregates.resolve_range(range_key, tz, at_ms=to_ms)


_AUTO_HOUR_SPAN_MS = 48 * 3_600_000


def _window_override(from_ms: int | None, to_ms: int | None) -> tuple[int, int] | None:
    """Explicit from_ms/to_ms millisecond window for latency/timeseries/heatmap/flow.

    Both params given -> a validated (from_ms, to_ms) pair that overrides the
    range enum (payload "range" reads "custom"); neither given -> None so the
    range enum keeps control and legacy behaviour stays byte-identical;
    exactly one -> 422 because a half window is ambiguous. Non-integer input
    is rejected by FastAPI into the shared 422 envelope. A negative timestamp,
    from_ms >= to_ms, or a span over 366 days (aligned with the 365d tier's
    full-table-abuse guard) are all 422 too.
    """
    if from_ms is None and to_ms is None:
        return None
    if from_ms is None or to_ms is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "from_ms and to_ms must be provided together",
            details={"from_ms": from_ms, "to_ms": to_ms},
        )
    if from_ms < 0 or to_ms < 0:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "from_ms and to_ms must be non-negative epoch milliseconds",
            details={"from_ms": from_ms, "to_ms": to_ms},
        )
    if from_ms >= to_ms:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "from_ms must be less than to_ms",
            details={"from_ms": from_ms, "to_ms": to_ms},
        )
    raise_span_over_cap(from_ms, to_ms)
    return from_ms, to_ms


def _echo_range(range_key: str) -> str:
    """Normalise an enum range key for the response model's Literal echo.

    resolve_range accepts the key case-insensitively; the payload echo (and the
    generated TS contract) uses the canonical lower-case form.
    """
    return (range_key or "").strip().lower()


def _timezone(session: Session, tz: str):
    """Explicit tz wins and is validated; omitted tz follows app_settings."""
    if tz:
        return aggregates.resolve_timezone(tz)
    return aggregates.report_timezone(session)


def _require_metric_permission(principal: auth.Principal, metric: str) -> None:
    """An explicit money metric is a 403 without its field permission."""
    canonical = aggregates.canonical_metric(metric)
    if canonical == "cost_micro":
        rbac.require_permission(principal.permissions, "billing:cost")
    elif canonical == "charge_micro":
        rbac.require_permission(principal.permissions, "billing:spend")


def _validate_metric(metric: str) -> None:
    if (metric or "").strip().lower() not in aggregates.METRIC_ALIASES:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "metric must be requests/tokens/input_tokens/output_tokens/cost/spend",
            details={"metric": metric},
        )


def _parse_metrics(metrics: str, metric: str) -> list[str]:
    """Series list for /timeseries: `metrics=a,b` wins, else the singular `metric`.

    Unknown names are 422 with the offending input; duplicates collapse while
    preserving order so cost_micro,charge_micro,cost_micro stays two series.
    """
    raw = (metrics or "").strip()
    if not raw:
        _validate_metric(metric)
        return [aggregates.canonical_metric(metric)]
    series: list[str] = []
    for token in raw.split(","):
        name = token.strip()
        if not name:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                "metric must be requests/tokens/input_tokens/output_tokens/cost/spend",
                details={"metric": token},
            )
        _validate_metric(name)
        canonical = aggregates.canonical_metric(name)
        if canonical not in series:
            series.append(canonical)
    return series


@router.get("/admin/reports/overview", response_model=ReportsOverviewOut)
def overview(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    from_ms: int = 0,
    to_ms: int = 0,
) -> dict:
    """Top-line numbers: requests, errors, active minutes, tokens, money, latency.

    Token口径: input_tokens is the cache-folded figure (input = net + cache),
    so net input derives as input_tokens - cache_read_tokens - cache_write_tokens
    (GLOSSARY §5); cache_read_tokens/cache_write_tokens share the same window
    and filters as input_tokens/output_tokens.

    W6 ticket 16: an explicit positive from_ms/to_ms pair obeys the same shared
    366-day cap as the other report routes; the 0 = beginning/now defaults are
    not a custom window and stay untouched.
    """
    validate_window_pair(from_ms, to_ms)
    stats = aggregates.overview_stats(session, from_ms=from_ms, to_ms=to_ms)
    flat = aggregates.overview_flat_latency(session, from_ms=from_ms, to_ms=to_ms)

    # Money must follow the SAME window as the request counters (the dashboard
    # labels this card "today"); the books also own currency normalisation, so
    # delegate instead of summing raw rows in mixed currencies.
    money = margin_report(session, from_ms, to_ms)
    report_currency = money["report_currency"]
    native = money["by_currency"].get(report_currency, {"charge_micro": 0, "cost_micro": 0})
    charge = money["report_currency_charge_micro"]
    cost = money["report_currency_cost_micro"]
    money_scope = "converted"
    if charge is None or cost is None:
        # Some currency has no fx snapshot yet: show the report-currency books only,
        # and say so, so the card does not pass itself off as a full total.
        charge, cost = native["charge_micro"], native["cost_micro"]
        money_scope = "report_currency_only"
    payload = {
        "requests": stats["requests"],
        "error_count": stats["error_count"],
        "active_minutes": stats["active_minutes"],
        # input_tokens folds cache into input (input = net + cache); the cache
        # sums below let the frontend derive net input = input_tokens
        # - cache_read_tokens - cache_write_tokens (GLOSSARY §5).
        "input_tokens": stats["input_tokens"],
        "output_tokens": stats["output_tokens"],
        "cache_read_tokens": stats["cache_read_tokens"],
        "cache_write_tokens": stats["cache_write_tokens"],
        "charge_micro": charge,
        "cost_micro": cost,
        "margin_micro": charge - cost,
        "currency": report_currency,
        "money_scope": money_scope,
        "fx_missing": money["fx_missing"],
        "latency_p50_ms": flat["latency_p50_ms"],
        "latency_p95_ms": flat["latency_p95_ms"],
        "ttft_p50_ms": flat["ttft_p50_ms"],
        "latency": stats["latency"],
        "estimate_note": _ESTIMATE_NOTE,
    }
    return payload


@router.get("/admin/reports/trend")
def trend(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    metric: str = "requests",
    range: str = "30d",
) -> dict:
    """Legacy daily buckets (kept for the v1 client); v2 clients use /timeseries."""
    if metric not in _METRICS:
        metric = "requests"
    if metric == "cost_micro":
        rbac.require_permission(principal.permissions, "billing:cost")
    if metric == "charge_micro":
        rbac.require_permission(principal.permissions, "billing:spend")
    to_ms = int(time.time() * 1000)
    from_ms, _ = _window(range, to_ms)
    day_buckets = aggregates.trend_daily(session, from_ms=from_ms)
    points = [
        {"day": day, "metric": metric, "value": values[metric]}
        for day, values in sorted(day_buckets.items())
    ]
    return {"metric": metric, "range": range, "points": points, "estimate_note": _ESTIMATE_NOTE}


@router.get("/admin/reports/latency", response_model=LatencyReportOut)
def latency(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    range: str = "",
    from_ms: int | None = None,
    to_ms: int | None = None,
    tz: str = "",
) -> dict:
    """TTFT/TOTAL quantiles over one window in two calibres (W4-F).

    ``ttft``/``total`` stay the legacy paired blocks (ttft > 0 AND duration > 0,
    p50/p75/p95/p99; non-streaming requests never enter); ``all`` is the W4-F
    addition - the same window with no pairing filter, p50/p75/p95 - which the
    log page uses to anchor its latency semantic colour (DESIGN-AUDIT §11).
    Below five samples each calibre nulls its own quantiles independently.

    Window resolution: an explicit from_ms/to_ms pair overrides the range enum
    with payload "range" reading "custom"; exactly one of the pair is still a
    422; giving neither is now the all-time calibre (0=全时段, payload "range"
    reads "all") instead of the old 7d enum default, so the log page can omit
    the window and stay aligned with /admin/logs. An explicit range=... keeps
    the enum behaviour. See _window_override.
    """
    zone = _timezone(session, tz)
    override = _window_override(from_ms, to_ms)
    if override is not None:
        window_from, window_to, range_key = override[0], override[1], "custom"
    elif range:
        range_key = _echo_range(range)
        window_from, window_to, _bucket = _range_window(range_key, now_ms(), zone)
    else:
        window_from, window_to, range_key = 0, 0, "all"
    payload = {
        "range": range_key,
        "from_ms": window_from,
        "to_ms": window_to,
        "timezone": str(zone),
        **aggregates.latency_report(session, from_ms=window_from, to_ms=window_to),
        "estimate_note": _ESTIMATE_NOTE,
    }
    return payload


@router.get(
    "/admin/reports/timeseries",
    response_model=TimeseriesReportOut,
    response_model_exclude_none=True,
)
def timeseries(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    range: str = "7d",
    bucket: str = "auto",
    dimension: str = "combo",
    metric: str = "requests",
    metrics: str = "",
    top_n: int = 10,
    from_ms: int | None = None,
    to_ms: int | None = None,
    tz: str = "",
) -> dict:
    """Bucketed series split by 综合模型/上游模型/上游渠道, with member totals.

    `metrics=cost_micro,charge_micro` returns both series in one payload
    (points[].values maps each member to {metric: value}, members carry
    totals per series); the singular `metric` keeps the flat legacy shape.

    An explicit from_ms/to_ms pair (epoch ms) overrides the range enum; with
    bucket=auto a span <= 48h picks hour buckets and anything longer picks
    day buckets, while an explicit bucket parameter keeps winning over both.
    Payload "range" reads "custom" for an explicit window. See _window_override.

    totals always carries every key (shape stable across metric combinations);
    token口径: input_tokens is the cache-folded figure (input = net + cache), so
    net input derives as input_tokens - cache_read_tokens - cache_write_tokens
    (GLOSSARY §5); the cache sums share the same window and filters. totals also
    carries the single-minute peaks peak_rpm/peak_tpm (GLOSSARY §5 「最高峰」).
    """
    series = _parse_metrics(metrics, metric)
    for name in series:
        _require_metric_permission(principal, name)
    zone = _timezone(session, tz)
    bucket_param = (bucket or "").strip().lower()
    override = _window_override(from_ms, to_ms)
    if override is not None:
        window_from, window_to = override
        range_key = "custom"
        auto_bucket = "hour" if window_to - window_from <= _AUTO_HOUR_SPAN_MS else "day"
    else:
        range_key = _echo_range(range)
        window_from, window_to, auto_bucket = _range_window(range_key, now_ms(), zone)
    bucket_key = auto_bucket if bucket_param in ("", "auto") else bucket
    if bucket_key not in aggregates.BUCKET_KEYS:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "bucket must be auto, hour or day",
            details={"bucket": bucket},
        )
    if override is None and bucket_key == "hour" and range_key == "365d":
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "bucket=hour is not supported for range=365d",
            details={"range": range, "bucket": bucket_key},
        )
    payload = aggregates.build_timeseries(
        session,
        range_key=range_key,
        from_ms=window_from,
        to_ms=window_to,
        bucket=bucket_key,
        dimension=dimension,
        metric=metric,
        top_n=top_n,
        tz=zone,
        metrics=series if len(series) > 1 else None,
    )
    return payload


@router.get("/admin/reports/heatmap", response_model=HeatmapReportOut)
def heatmap(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    range: str = "7d",
    metric: str = "tokens",
    from_ms: int | None = None,
    to_ms: int | None = None,
    tz: str = "",
) -> dict:
    """7d weekday×hour or 30d/365d date×hour matrix for tokens/cost/spend.

    An explicit from_ms/to_ms pair (epoch ms) overrides the range enum: a span
    <= 7 days keeps the 7-row weekday×hour layout, longer spans use date×hour
    with one row per covered local day (the 30d/365d shape); max/total and the
    metric rules are unchanged. Payload "range" reads "custom" then.
    See _window_override.
    """
    _validate_metric(metric)
    _require_metric_permission(principal, metric)
    zone = _timezone(session, tz)
    override = _window_override(from_ms, to_ms)
    if override is not None:
        window_from, window_to = override
        range_key = "custom"
    else:
        if range not in _HEATMAP_RANGES:
            raise AppError(
                ErrorCode.VALIDATION_ERROR,
                f"heatmap range must be one of {_HEATMAP_RANGES}",
                details={"range": range},
            )
        window_from, window_to, _bucket = _range_window(range, now_ms(), zone)
        range_key = range
    payload = aggregates.build_heatmap(
        session,
        from_ms=window_from,
        to_ms=window_to,
        range_key=range_key,
        metric=metric,
        tz=zone,
    )
    return payload


@router.get("/admin/reports/flow", response_model=FlowReportOut)
def flow(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("reports:read")),
    range: str = "",
    metric: str = "requests",
    from_ms: int | None = None,
    to_ms: int | None = None,
    tz: str = "",
    collapse: str = "",
    focus: str = "",
    q: str = "",
    top_n: int = 0,
) -> dict:
    """Five-stage Sankey: 用户 → 连接密钥 → 公开模型 → 上游模型 → 上游.

    Omitting range keeps the v1 all-time behaviour; passing one of the five range
    keys restricts it. Requests/tokens are conserved on every edge; spend is on
    the user edge and cost on the channel edge so totals appear once.

    An explicit from_ms/to_ms pair (epoch ms) overrides the range enum and
    restricts the link aggregation to that window; the all-time default only
    survives when neither param is given. Payload "range" reads "custom" for
    an explicit window. See _window_override.

    W6 ticket 17 adds optional narrowing for production-scale graphs; all three
    default to blank/0 and keep the payload byte-identical (collapse golden):

    * focus=<node id> - keep that node's ancestor+descendant chain;
    * q=<text> - keep every label (case-insensitive) match's chain;
    * top_n=<n> - per stage keep the top-n nodes by metric value and fold the
      tail into other:<stage> aggregate nodes (0=off, negative is a 422).
    """
    if metric not in ("requests", "tokens"):
        metric = "requests"
    hidden = [part.strip() for part in collapse.split(",") if part.strip()]
    unknown = [stage for stage in hidden if stage not in aggregates.FLOW_STAGE_IDS]
    if unknown:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "collapse 含未知阶段",
            details={"collapse": unknown, "allowed": list(aggregates.FLOW_STAGE_IDS)},
        )
    hidden = list(dict.fromkeys(hidden))
    if len(hidden) > len(aggregates.FLOW_STAGE_IDS) - 2:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "collapse 后至少保留 2 个阶段",
            details={"collapse": hidden},
        )
    if top_n < 0:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "top_n 必须为不小于 0 的整数",
            details={"top_n": top_n},
        )
    zone = _timezone(session, tz)
    override = _window_override(from_ms, to_ms)
    if override is not None:
        window_from, window_to = override
        range_key = "custom"
    elif range:
        range_key = _echo_range(range)
        window_from, window_to, _bucket = _range_window(range_key, now_ms(), zone)
    else:
        window_from, window_to, range_key = 0, now_ms() + 1, ""
    payload = aggregates.build_flow(
        session,
        from_ms=window_from,
        to_ms=window_to,
        metric=metric,
        collapse=hidden or None,
        focus=focus,
        q=q,
        top_n=top_n,
    )
    payload["range"] = range_key or "all"
    payload["from_ms"] = window_from
    payload["to_ms"] = window_to
    payload["timezone"] = str(zone)
    return payload
