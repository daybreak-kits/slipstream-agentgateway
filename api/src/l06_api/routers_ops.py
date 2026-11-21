"""Operational routes: log search and playground SSE proxy."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from dataclasses import field as dc_field

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import (
    ApiKeyORM,
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UpstreamORM,
    UserORM,
)
from l04_repo.repository import get_setting, put_setting
from l05_service import auth, client_keys
from l05_service.attempts import AttemptChainSummary, attempt_summaries, attempts_for_event
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import LogAttemptOut, LogAttemptsOut, PlaygroundRequest

router = APIRouter(tags=["ops"])


# ---------------------------------------------------------------- logs


def _raw_of(row: GatewayUsageEventORM) -> dict:
    """Parsed raw_json (the collected wire row); {} when absent or malformed.

    Diagnostic attachment only (ADR-029): keyword search rides it, but every
    product fact below is a neutral column the adapter normalized at ingest
    time — the system API never re-derives facts from wire attributes.
    """
    try:
        value = json.loads(row.raw_json or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _stream_verdict(row: GatewayUsageEventORM) -> bool:
    """Adapter verdict wins; without one, a TTFT marks the stream (neutral rule)."""
    if row.is_stream is not None:
        return bool(row.is_stream)
    return (row.time_to_first_token_ms or 0) > 0


def _cache_ratio(row: GatewayUsageEventORM) -> float | None:
    """Cache hit ratio in percent, using the ledger's containment rule.

    Input tokens normally already contain the cached ones; only when a vendor
    reports them in parallel (cached > input) is the denominator the sum, so the
    number matches the billing ledger instead of double-counting the cache.
    """
    cached = row.cache_read_tokens or 0
    if cached <= 0:
        return None
    prompt = row.input_tokens or 0
    denominator = prompt if prompt >= cached else prompt + cached
    if denominator <= 0:
        return None
    return round(cached * 100.0 / denominator, 1)


# Below this generation window the upstream buffered the whole answer and
# flushed it at once; 152 tokens / 5ms would read as a fake 30k t/s. Old UI rule.
_MIN_GENERATION_MS = 100


def _throughput_tps(row: GatewayUsageEventORM, *, is_stream: bool) -> float | None:
    """Output speed (tokens/s) over the generating window, streamed requests only.

    Non-streaming calls carry no first-token mark, so their "generation window"
    cannot be isolated from queueing; the old system leaves them blank and so do we.
    """
    output = row.output_tokens or 0
    duration = row.duration_ms or 0
    ttft = row.time_to_first_token_ms or 0
    if not is_stream or output <= 0 or duration <= 0 or ttft <= 0:
        return None
    window = duration - ttft
    if window < _MIN_GENERATION_MS:
        return None
    return round(output * 1000.0 / window, 2)


_STATUS_TOKEN = re.compile(r"^([1-5])(\d\d|xx)$")
_COUNT_TOKEN = re.compile(r"^\d+$")
_RATIO_TOKEN = re.compile(r"^\d+(?:\.\d+)?$")
_STREAM_TOKENS: dict[str, bool] = {
    "true": True,
    "1": True,
    "yes": True,
    "false": False,
    "0": False,
    "no": False,
}


@dataclass(slots=True)
class _LogQuery:
    """Parsed query string: field tokens are AND-combined, everything else is a keyword."""

    models: list[str] = dc_field(default_factory=list)
    upstreams: list[str] = dc_field(default_factory=list)
    users: list[str] = dc_field(default_factory=list)
    keys: list[str] = dc_field(default_factory=list)
    statuses: list[tuple[int, int]] = dc_field(default_factory=list)
    min_latency: int = 0
    max_latency: int = 0
    min_ttft: int = 0
    min_cache_ratio: float = -1.0
    stream: bool | None = None
    keywords: list[str] = dc_field(default_factory=list)


def _query_bad(token: str, hint: str) -> AppError:
    """A malformed query token is the caller's fault: 422 with the offending token."""
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        f"查询语法错误：{token}；{hint}",
        details={"token": token},
    )


def _count_after(token: str, prefix: str) -> int:
    value = token[len(prefix) :]
    if not _COUNT_TOKEN.match(value):
        raise _query_bad(token, f"{prefix} 后需要非负整数（毫秒）")
    return int(value)


def _ratio_after(token: str, prefix: str) -> float:
    value = token[len(prefix) :]
    if not _RATIO_TOKEN.match(value) or float(value) > 100:
        raise _query_bad(token, f"{prefix} 后需要 0-100 的百分比")
    return float(value)


def _parse_log_query(query: str) -> _LogQuery:
    """Validate the free-text query; bad values return 422 instead of a 500 later."""
    parsed = _LogQuery()
    for token in (query or "").split():
        for prefix, bucket in (
            ("model:", parsed.models),
            ("upstream:", parsed.upstreams),
            ("user:", parsed.users),
            ("key:", parsed.keys),
        ):
            if not token.startswith(prefix):
                continue
            value = token[len(prefix) :].strip().lower()
            if not value:
                raise _query_bad(token, f"{prefix[:-1]} 后需要关键词")
            bucket.append(value)
            break
        else:
            if token.startswith("status:"):
                value = token[len("status:") :]
                match = _STATUS_TOKEN.match(value)
                if match is None:
                    raise _query_bad(token, "状态码需为 200 这类三位码，或 5xx 这类区间")
                if match.group(2) == "xx":
                    floor = int(match.group(1)) * 100
                    parsed.statuses.append((floor, floor + 100))
                else:
                    code = int(value)
                    parsed.statuses.append((code, code + 1))
            elif token.startswith("latency>"):
                parsed.min_latency = _count_after(token, "latency>")
            elif token.startswith("latency<"):
                parsed.max_latency = _count_after(token, "latency<")
            elif token.startswith("ttft>"):
                parsed.min_ttft = _count_after(token, "ttft>")
            elif token.startswith("cache>"):
                parsed.min_cache_ratio = _ratio_after(token, "cache>")
            elif token.startswith("stream:"):
                value = token[len("stream:") :].lower()
                if value not in _STREAM_TOKENS:
                    raise _query_bad(token, "stream: 只接受 true / false")
                parsed.stream = _STREAM_TOKENS[value]
            else:
                parsed.keywords.append(token.lower())
    return parsed


def _identity_tables(session: Session) -> tuple[dict[str, ApiKeyORM], dict[str, UserORM]]:
    keys = {row.id: row for row in session.scalars(select(ApiKeyORM)).all()}
    users = {row.id: row for row in session.scalars(select(UserORM)).all()}
    return keys, users


def _identity_of(
    event_key_id: str | None,
    keys: dict[str, ApiKeyORM],
    users: dict[str, UserORM],
) -> tuple[str, str, str]:
    """(user_id, user_name, masked key) for one event; blanks when the key is gone."""
    key = keys.get(event_key_id or "")
    if key is None:
        return "", "", ""
    user = users.get(key.user_id)
    return (
        key.user_id,
        user.name if user is not None else "",
        client_keys.mask_of(key.prefix, key.key_suffix),
    )


def _keyword_haystack(
    row: GatewayUsageEventORM,
    *,
    identity: tuple[str, str, str],
    raw: dict,
) -> str:
    """Bare keywords search the neutral facts plus the diagnostic attachment."""
    _, user_name, api_key_label = identity
    return json.dumps(
        {
            "id": row.event_id,
            "models": [row.public_model, row.upstream_model, row.provider],
            "requested_model": row.requested_model,
            "correlation_key": row.correlation_key,
            "error": row.error,
            "identity": [user_name, api_key_label, row.api_key_id],
            "raw": raw,
        },
        ensure_ascii=False,
    ).lower()


def _matches_keywords(
    row: GatewayUsageEventORM,
    *,
    identity: tuple[str, str, str],
    raw: dict,
    keywords: list[str],
) -> bool:
    haystack = _keyword_haystack(row, identity=identity, raw=raw)
    return all(keyword in haystack for keyword in keywords)


# ---------------------------------------------------------------- logs: SQL pushdown
#
# Field tokens and ordering are pushed into SQLite so a page never materialises the
# whole table. These expressions mirror the Python predicates one for one
# (_stream_verdict, _cache_ratio); every filter reads neutral columns, so no JSON1
# call can raise on malformed diagnostic blobs. Bare keywords get a LIKE prefilter
# (a superset) and are then re-checked against the exact JSON document, so totals
# and paging stay identical to the in-memory oracle in test_logs_sql_parity.


def _log_stream_expr():
    """SQL twin of _stream_verdict over the neutral column + ttft, usable in WHERE."""
    verdict = GatewayUsageEventORM.is_stream
    ttft = func.coalesce(GatewayUsageEventORM.time_to_first_token_ms, 0)
    return case((verdict.is_not(None), verdict), else_=case((ttft > 0, 1), else_=0))


def _log_has_error_expr():
    """SQL twin of bool(row.error): the normalized error column decides."""
    return case((GatewayUsageEventORM.error != literal(""), 1), else_=0)


def _log_cache_expr():
    """(cached tokens, ratio) mirroring _cache_ratio; SQLite rounds half away from zero."""
    cached = func.coalesce(GatewayUsageEventORM.cache_read_tokens, 0)
    prompt = func.coalesce(GatewayUsageEventORM.input_tokens, 0)
    denominator = case((prompt >= cached, prompt), else_=prompt + cached)
    ratio = func.round(cached * 100.0 / func.nullif(denominator, 0), 1)
    return cached, ratio


def _like_contains(expression, token: str):
    """Lower-cased substring match; LIKE wildcards in the token are escaped."""
    escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return func.lower(func.coalesce(expression, "")).like(f"%{escaped}%", escape="\\")


def _masked_key_label_expr():
    """SQL twin of client_keys.mask_of, blank when the key row is gone."""
    return case(
        (ApiKeyORM.id.is_(None), literal("")),
        else_=(
            func.coalesce(ApiKeyORM.prefix, "")
            .concat("...")
            .concat(func.coalesce(ApiKeyORM.key_suffix, ""))
        ),
    )


def _log_filter_clauses(
    parsed: _LogQuery, *, from_ms: int, to_ms: int, has_error: bool | None
) -> tuple[list, bool]:
    """WHERE clauses for every token; also reports whether identity joins are needed."""
    clauses: list = []
    for token in parsed.models:
        clauses.append(
            or_(
                _like_contains(GatewayUsageEventORM.public_model, token),
                _like_contains(GatewayUsageEventORM.upstream_model, token),
            )
        )
    for token in parsed.upstreams:
        clauses.append(
            or_(
                _like_contains(GatewayUsageEventORM.provider, token),
                _like_contains(GatewayUsageEventORM.upstream_model, token),
            )
        )
    for token in parsed.users:
        clauses.append(
            or_(
                _like_contains(UserORM.name, token),
                _like_contains(ApiKeyORM.user_id, token),
            )
        )
    for token in parsed.keys:
        clauses.append(
            or_(
                _like_contains(_masked_key_label_expr(), token),
                _like_contains(GatewayUsageEventORM.api_key_id, token),
                _like_contains(ApiKeyORM.user_id, token),
            )
        )
    needs_identity = bool(parsed.users or parsed.keys)
    if parsed.statuses:
        status = func.coalesce(GatewayUsageEventORM.http_status, 0)
        clauses.append(
            or_(*[and_(status >= floor, status < ceiling) for floor, ceiling in parsed.statuses])
        )
    duration = func.coalesce(GatewayUsageEventORM.duration_ms, 0)
    if parsed.min_latency:
        clauses.append(duration > parsed.min_latency)
    if parsed.max_latency:
        clauses.append(and_(duration > 0, duration < parsed.max_latency))
    if parsed.min_ttft:
        ttft = func.coalesce(GatewayUsageEventORM.time_to_first_token_ms, 0)
        clauses.append(ttft > parsed.min_ttft)
    if parsed.min_cache_ratio >= 0:
        cached, ratio = _log_cache_expr()
        clauses.append(and_(cached > 0, ratio >= parsed.min_cache_ratio))
    if parsed.stream is not None:
        clauses.append(_log_stream_expr() == (1 if parsed.stream else 0))
    if has_error is not None:
        clauses.append(_log_has_error_expr() == (1 if has_error else 0))
    if from_ms:
        clauses.append(GatewayUsageEventORM.started_at_ms >= from_ms)
    if to_ms:
        clauses.append(GatewayUsageEventORM.started_at_ms < to_ms)
    return clauses, needs_identity


def _log_join(selectable, *, identity: bool, cost: bool = False, charge: bool = False):
    """Attach the joins a filter or an ORDER BY needs; every join is 1:1 on a key."""
    if identity:
        selectable = selectable.outerjoin(
            ApiKeyORM, ApiKeyORM.id == GatewayUsageEventORM.api_key_id
        ).outerjoin(UserORM, UserORM.id == ApiKeyORM.user_id)
    if cost:
        selectable = selectable.outerjoin(
            CostEntryORM, CostEntryORM.gateway_event_id == GatewayUsageEventORM.event_id
        )
    if charge:
        selectable = selectable.outerjoin(
            ChargeEntryORM, ChargeEntryORM.gateway_event_id == GatewayUsageEventORM.event_id
        )
    return selectable


def _log_order_by(sort: str, order: str):
    """SQL order matching the v1 Python sort: the key first, then the initial order."""
    descending = order == "desc"
    tiebreak = (
        GatewayUsageEventORM.started_at_ms.desc(),
        GatewayUsageEventORM.event_id.desc(),
    )
    if sort == "started_at":
        return (
            GatewayUsageEventORM.started_at_ms.desc()
            if descending
            else GatewayUsageEventORM.started_at_ms.asc(),
            GatewayUsageEventORM.event_id.desc()
            if descending
            else GatewayUsageEventORM.event_id.asc(),
        )
    if sort == "duration_ms":
        primary = func.coalesce(GatewayUsageEventORM.duration_ms, 0)
    elif sort == "total_tokens":
        primary = func.coalesce(GatewayUsageEventORM.total_tokens, 0)
    elif sort == "cost_micro":
        primary = func.coalesce(CostEntryORM.amount_micro, -1)
    else:
        primary = func.coalesce(ChargeEntryORM.amount_micro, -1)
    return (primary.desc() if descending else primary.asc(), *tiebreak)


_PREFILTER_TOKEN = re.compile(r"^[a-z0-9._@/+:-]+$")
_PREFILTER_LETTER = re.compile(r"[a-df-z]")
_LOG_HAYSTACK_TEMPLATE = json.dumps(
    {
        "id": "",
        "models": ["", "", ""],
        "requested_model": "",
        "correlation_key": "",
        "error": "",
        "identity": ["", "", ""],
        "raw": {},
    },
    ensure_ascii=False,
).lower()


def _non_ascii(expression):
    """GLOB for any character outside printable ASCII (case folding differs there)."""
    return expression.op("GLOB")("*[^ -~]*")


def _haystack_fallback():
    """Rows a plain LIKE prefilter could miss: escapes, non-ASCII and null identities.

    Canonical JSON never escapes printable ASCII, so a pure-ASCII row can only match
    verbatim; these guards keep the prefilter a superset of the exact JSON check.
    """
    return or_(
        _non_ascii(GatewayUsageEventORM.raw_json),
        _non_ascii(GatewayUsageEventORM.requested_model),
        _non_ascii(GatewayUsageEventORM.correlation_key),
        _non_ascii(GatewayUsageEventORM.error),
        _non_ascii(GatewayUsageEventORM.event_id),
        _non_ascii(GatewayUsageEventORM.public_model),
        _non_ascii(GatewayUsageEventORM.upstream_model),
        _non_ascii(GatewayUsageEventORM.provider),
        _non_ascii(GatewayUsageEventORM.api_key_id),
        _non_ascii(ApiKeyORM.user_id),
        _non_ascii(ApiKeyORM.prefix),
        _non_ascii(ApiKeyORM.key_suffix),
        _non_ascii(UserORM.name),
        func.instr(GatewayUsageEventORM.raw_json, "\\u") > 0,
        GatewayUsageEventORM.api_key_id.is_(None),
    )


def _keyword_prefilter(keywords: list[str]) -> tuple[list, bool]:
    """SQL LIKE window for bare keywords, or none when a token cannot be pushed down.

    A token is pushed down only when it consists of characters JSON keeps verbatim
    and carries a letter no number can: then any exact haystack match implies a LIKE
    hit. The exact JSON check still runs on every row of the window, so this only
    narrows the scan, never the result set.
    """
    if not keywords:
        return [], False
    for token in keywords:
        if (
            token in _LOG_HAYSTACK_TEMPLATE
            or _PREFILTER_TOKEN.match(token) is None
            or _PREFILTER_LETTER.search(token) is None
        ):
            return [], False
    fallback = _haystack_fallback()
    clauses = [
        or_(
            _like_contains(GatewayUsageEventORM.raw_json, token),
            _like_contains(GatewayUsageEventORM.requested_model, token),
            _like_contains(GatewayUsageEventORM.correlation_key, token),
            _like_contains(GatewayUsageEventORM.error, token),
            _like_contains(GatewayUsageEventORM.event_id, token),
            _like_contains(GatewayUsageEventORM.public_model, token),
            _like_contains(GatewayUsageEventORM.upstream_model, token),
            _like_contains(GatewayUsageEventORM.provider, token),
            _like_contains(GatewayUsageEventORM.api_key_id, token),
            _like_contains(ApiKeyORM.user_id, token),
            _like_contains(UserORM.name, token),
            _like_contains(_masked_key_label_expr(), token),
            fallback,
        )
        for token in keywords
    ]
    return clauses, True


def _identity_tables_for_rows(
    session: Session, rows: list[GatewayUsageEventORM]
) -> dict[str, tuple[str, str, str]]:
    """Identity for the selected rows only (v1 loaded both tables whole)."""
    key_ids = {row.api_key_id for row in rows if row.api_key_id}
    keys_by_id = (
        {key.id: key for key in session.scalars(select(ApiKeyORM).where(ApiKeyORM.id.in_(key_ids)))}
        if key_ids
        else {}
    )
    user_ids = {key.user_id for key in keys_by_id.values() if key.user_id}
    users_by_id = (
        {
            user.id: user
            for user in session.scalars(select(UserORM).where(UserORM.id.in_(user_ids)))
        }
        if user_ids
        else {}
    )
    return {
        row.event_id: _identity_of(row.api_key_id, keys_by_id, users_by_id) for row in rows
    }


def _model_reference_maps(session: Session):
    """The three small reference tables, read whole exactly like the v1 endpoint."""
    upstream_ids_by_name = {
        row.name: row.id for row in session.scalars(select(UpstreamModelORM))
    }
    public_ids_by_name = {row.name: row.id for row in session.scalars(select(PublicModelORM))}
    priorities = {
        (row.public_model_id, row.upstream_model_id): row.priority
        for row in session.scalars(select(ModelTargetORM))
    }
    return upstream_ids_by_name, public_ids_by_name, priorities


def _log_page_items(
    session: Session,
    rows: list[GatewayUsageEventORM],
    *,
    identities: dict[str, tuple[str, str, str]] | None = None,
) -> list[dict]:
    """Assemble items for the selected page only; money is lazy."""
    if not rows:
        return []
    event_ids = [row.event_id for row in rows]
    cost_by_event = {
        entry.gateway_event_id: entry
        for entry in session.scalars(
            select(CostEntryORM).where(CostEntryORM.gateway_event_id.in_(event_ids))
        )
    }
    charge_by_event = {
        entry.gateway_event_id: entry
        for entry in session.scalars(
            select(ChargeEntryORM).where(ChargeEntryORM.gateway_event_id.in_(event_ids))
        )
    }
    if identities is None:
        identities = _identity_tables_for_rows(session, rows)
    upstream_ids_by_name, public_ids_by_name, priorities = _model_reference_maps(session)
    # Ticket 04: one grouped request_attempts read for the whole page (never N+1).
    attempts_by_key = attempt_summaries(session, [row.correlation_key for row in rows])
    items = []
    for row in rows:
        public_id = public_ids_by_name.get(row.public_model, "")
        upstream_id = upstream_ids_by_name.get(row.upstream_model, "")
        cost = cost_by_event.get(row.event_id)
        charge = charge_by_event.get(row.event_id)
        attempts = attempts_by_key.get(row.correlation_key or "")
        items.append(
            _log_item(
                row,
                identity=identities[row.event_id],
                upstream_model_id=upstream_id,
                target_priority=priorities.get((public_id, upstream_id))
                if public_id
                else None,
                cost_micro=cost.amount_micro if cost else None,
                charge_micro=charge.amount_micro if charge else None,
                currency=(charge.currency if charge else (cost.currency if cost else "")),
                attempts=attempts,
            )
        )
    return items


def _scan_log_keywords(
    session: Session,
    stmt,
    keywords: list[str],
    *,
    off: int,
    limit: int,
) -> tuple[int, list[GatewayUsageEventORM], dict]:
    """Stream the SQL window, re-check the exact JSON haystack and collect the page."""
    keys_by_id, users_by_id = _identity_tables(session)
    total = 0
    page_rows: list[GatewayUsageEventORM] = []
    page_identities: dict[str, tuple[str, str, str]] = {}
    for row in session.scalars(stmt.execution_options(yield_per=500)):
        raw = _raw_of(row)
        identity = _identity_of(row.api_key_id, keys_by_id, users_by_id)
        if not _matches_keywords(row, identity=identity, raw=raw, keywords=keywords):
            continue
        if off <= total < off + limit:
            page_rows.append(row)
            page_identities[row.event_id] = identity
        total += 1
    return total, page_rows, page_identities


def _log_item(
    row: GatewayUsageEventORM,
    *,
    identity: tuple[str, str, str],
    upstream_model_id: str,
    target_priority: int | None,
    cost_micro: int | None,
    charge_micro: int | None,
    currency: str,
    attempts: AttemptChainSummary | None = None,
) -> dict:
    """One record as the UI consumes it; the drawer reuses this exact shape.

    Every fact is a neutral column (ADR-029): requested model, streaming,
    error text and the payload flag were normalized by the adapter at ingest,
    so nothing here reads the raw diagnostic attachment.
    """
    user_id, user_name, api_key_label = identity
    stream = _stream_verdict(row)
    error = row.error or ""
    # Ticket 04: the error field is the normalized log text only. The row also
    # carries the last failed attempt's facts; the console composes any fallback
    # wording so the service layer does not own UI copy.
    failure = attempts.last_failure if attempts is not None else None
    margin = (
        charge_micro - cost_micro
        if charge_micro is not None and cost_micro is not None
        else None
    )
    return {
        "event_id": row.event_id,
        # Cross-log/attempt-chain join key (ADR-028); empty on old rows or when
        # the adapter had no telemetry for the request.
        "correlation_key": row.correlation_key or "",
        "started_at_ms": row.started_at_ms,
        "completed_at_ms": row.completed_at_ms,
        "duration_ms": row.duration_ms,
        "time_to_first_token_ms": row.time_to_first_token_ms,
        "http_status": row.http_status,
        "public_model": row.public_model,
        # The model the client asked for, normalized by the adapter; blank on
        # rows that cannot answer, never backfilled from the recorded models.
        "requested_model": row.requested_model or "",
        "upstream_model": row.upstream_model,
        "upstream_model_id": upstream_model_id,
        "target_priority": target_priority,
        "provider": row.provider,
        "user_id": user_id,
        "user_name": user_name,
        "api_key_id": row.api_key_id or "",
        "api_key_label": api_key_label,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "total_tokens": row.total_tokens,
        "cache_read_tokens": row.cache_read_tokens,
        "cache_write_tokens": row.cache_write_tokens,
        "cache_ratio": _cache_ratio(row),
        "throughput_tps": _throughput_tps(row, is_stream=stream),
        "is_stream": stream,
        "has_error": bool(error),
        "has_payload": bool(row.has_payload),
        "error": error,
        "attempts_count": attempts.count if attempts is not None else 0,
        "has_attempts": attempts is not None and attempts.count > 0,
        "last_failure_status": failure.status_code if failure is not None else None,
        "last_failure_error_type": failure.error_type if failure is not None else "",
        "last_failure_error_message": failure.error_message if failure is not None else "",
        "cost_micro": cost_micro,
        "margin_micro": margin,
        "charge_micro": charge_micro,
        "currency": currency,
        "estimate": True,
    }


@router.get("/admin/logs")
def search_logs(
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
    query: str = "",
    from_ms: int = 0,
    to_ms: int = 0,
    sort: str = "started_at",
    order: str = "desc",
    has_error: bool | None = None,
    page_size: int = 50,
    offset: int = 0,
) -> dict:
    """Log search with field tokens + free-text keyword (all AND-combined).

    Tokens: model:x upstream:x user:x key:x status:200|4xx|5xx latency>ms
    latency<ms ttft>ms cache>pct stream:true|false; anything else is a keyword
    matched against models, identity and the stored raw record. Malformed tokens
    are 422, never 500. Rows carry the merged columns the UI renders: identity
    (user + masked key), streaming flag, throughput, cache ratio, cost/charge/
    margin and the error text.
    """
    limit, off = page_params(page_size, offset)
    parsed = _parse_log_query(query)
    _SORT_KEYS = ("started_at", "duration_ms", "total_tokens", "cost_micro", "charge_micro")
    if sort not in _SORT_KEYS or order not in ("asc", "desc"):
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "sort must be started_at|duration_ms|total_tokens|cost_micro|charge_micro;"
            " order asc|desc",
            details={"sort": sort, "order": order},
        )
    # Ordering by money leaks relative amounts even when the keys are stripped.
    if sort == "cost_micro" and "billing:cost" not in principal.permissions:
        raise AppError(ErrorCode.FORBIDDEN, "没有成本权限，不能按成本排序")
    if sort == "charge_micro" and "billing:spend" not in principal.permissions:
        raise AppError(ErrorCode.FORBIDDEN, "没有花费权限，不能按花费排序")
    clauses, needs_identity = _log_filter_clauses(
        parsed, from_ms=from_ms, to_ms=to_ms, has_error=has_error
    )
    cost_sort = sort == "cost_micro"
    charge_sort = sort == "charge_micro"
    order_by = _log_order_by(sort, order)
    if parsed.keywords:
        prefilter, prefilter_identity = _keyword_prefilter(parsed.keywords)
        stmt = _log_join(
            select(GatewayUsageEventORM),
            identity=needs_identity or prefilter_identity,
            cost=cost_sort,
            charge=charge_sort,
        )
        stmt = stmt.where(*clauses, *prefilter).order_by(*order_by)
        total, rows, identities = _scan_log_keywords(
            session, stmt, parsed.keywords, off=off, limit=limit
        )
        items = _log_page_items(session, rows, identities=identities)
    else:
        total = session.scalar(
            _log_join(
                select(func.count()).select_from(GatewayUsageEventORM),
                identity=needs_identity,
            ).where(*clauses)
        ) or 0
        page_stmt = _log_join(
            select(GatewayUsageEventORM),
            identity=needs_identity,
            cost=cost_sort,
            charge=charge_sort,
        )
        page_stmt = (
            page_stmt.where(*clauses).order_by(*order_by).offset(off).limit(limit)
        )
        items = _log_page_items(session, list(session.scalars(page_stmt)))
    next_offset = off + limit if off + limit < total else None
    return {"total": total, "items": items, "next_offset": next_offset}



@router.get("/admin/logs/{event_id}/attempts", response_model=LogAttemptsOut)
def log_attempts(
    event_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
) -> LogAttemptsOut:
    """Normalized upstream attempts for one request log (ADR-028).

    Empty attempts are a normal answer (old log or adapter without telemetry);
    only a missing log row is 404. Upstream names are resolved here so the
    adapter-specific upstream_ref never leaks into the console's display logic.
    """
    resolved = attempts_for_event(session, event_id)
    if resolved is None:
        raise AppError(ErrorCode.NOT_FOUND, f"log entry not found: {event_id}")
    correlation_key, rows = resolved
    upstream_ids = {row.upstream_ref for row in rows if row.upstream_ref}
    names = (
        {
            upstream.id: upstream.name
            for upstream in session.scalars(
                select(UpstreamORM).where(UpstreamORM.id.in_(upstream_ids))
            )
        }
        if upstream_ids
        else {}
    )
    return LogAttemptsOut(
        event_id=event_id,
        correlation_key=correlation_key,
        attempts=[
            LogAttemptOut(
                attempt=row.attempt_no,
                upstream_ref=row.upstream_ref or "",
                upstream_name=names.get(row.upstream_ref, ""),
                model=row.model or "",
                status_code=row.status_code,
                error_type=row.error_type or "",
                error_message=row.error_message or "",
                duration_ms=row.duration_ms,
                outcome=row.outcome or "",
                started_at_ms=row.started_at_ms,
            )
            for row in rows
        ],
    )

@router.get("/admin/logs/{event_id}")
def log_detail(
    event_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
) -> dict:
    """Full record for the drawer; money obeys the same field filter as the list.

    The response carries neutral facts only (ADR-029): the raw wire row stays a
    diagnostic attachment in the table and request/response bodies are served
    through the adapter's log-payload port.
    """
    row = session.get(GatewayUsageEventORM, event_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"log entry not found: {event_id}")
    keys_by_id, users_by_id = _identity_tables(session)
    cost = session.scalar(select(CostEntryORM).where(CostEntryORM.gateway_event_id == event_id))
    charge = session.scalar(
        select(ChargeEntryORM).where(ChargeEntryORM.gateway_event_id == event_id)
    )
    public = session.scalar(select(PublicModelORM).where(PublicModelORM.name == row.public_model))
    umodel = session.scalar(
        select(UpstreamModelORM).where(UpstreamModelORM.name == row.upstream_model)
    )
    target = (
        session.scalar(
            select(ModelTargetORM).where(
                ModelTargetORM.public_model_id == public.id,
                ModelTargetORM.upstream_model_id == umodel.id,
            )
        )
        if public is not None and umodel is not None
        else None
    )
    # Same attempts facts as the list so the drawer does not drop them once the
    # detail payload replaces the selected list row.
    attempts = attempt_summaries(session, [row.correlation_key or ""]).get(
        row.correlation_key or ""
    )
    return _log_item(
        row,
        identity=_identity_of(row.api_key_id, keys_by_id, users_by_id),
        upstream_model_id=umodel.id if umodel is not None else "",
        target_priority=target.priority if target is not None else None,
        cost_micro=cost.amount_micro if cost else None,
        charge_micro=charge.amount_micro if charge else None,
        currency=(charge.currency if charge else (cost.currency if cost else "")),
        attempts=attempts,
    )


# ---------------------------------------------------------------- playground


def _playground_identity(session: Session) -> ApiKeyORM:
    """Ensure the playground system user + its internal key exist; return the key.

    The plaintext never persists: it is decrypted from key_enc per request and
    used server-side to call the configured data plane (admin-only, low
    frequency).
    """
    settings = get_settings()
    stored = get_setting(session, "playground_user_id")
    if stored:
        try:
            meta = json.loads(stored)
        except json.JSONDecodeError:
            meta = {}
        key = session.get(ApiKeyORM, meta.get("key_id", ""))
        user = session.get(UserORM, meta.get("id", ""))
        if key is not None and user is not None and key.status == "active":
            return key
    user = UserORM(id=new_id("user"), name="playground", created_at_ms=now_ms())
    session.add(user)
    session.flush()
    issued = client_keys.issue_client_key(
        session, user_id=user.id, box=AesGcmBox(settings.secret_key)
    )
    put_setting(
        session,
        "playground_user_id",
        json.dumps({"id": user.id, "key_id": issued.key_id}),
        now_ms(),
    )
    session.commit()
    return session.get(ApiKeyORM, issued.key_id)


@router.post("/admin/playground/stream", dependencies=[Depends(require("playground:use"))])
async def playground_stream(
    payload: PlaygroundRequest,
    session: Session = Depends(session_of),
    adapter: DataPlaneAdapter = Depends(get_adapter),
) -> StreamingResponse:
    """SSE pass-through to the configured data plane via its client contract.

    The relay address and chat endpoint are adapter client-contract facts
    (ADR-029 ticket 04): the endpoint is looked up by its neutral purpose key
    and the URL is contract-owned, so this router never hardcodes a data-plane
    port or path. The server-side internal key stays here; the plaintext is
    decrypted per request and never persisted.
    """
    settings = get_settings()
    key = _playground_identity(session)
    plaintext = AesGcmBox(settings.secret_key).decrypt(key.key_enc)
    contract = adapter.client_contract()
    endpoint = contract.endpoint_for("chat.completions")
    if endpoint is None:
        raise AppError(
            ErrorCode.CONFLICT,
            "当前数据面没有提供模型试验所需的对话端点",
            details={"adapter": settings.data_plane_adapter},
        )
    base_url = contract.base_url()

    def relay():
        body = {
            "model": payload.model,
            "stream": True,
            "messages": [m.model_dump() for m in payload.messages],
        }
        # Optional sampling knobs: omitted from the body when the caller left them unset.
        # reasoning_effort "default" means 不传 (ticket 18): it never reaches upstream.
        for field, value in (
            ("temperature", payload.temperature),
            ("top_p", payload.top_p),
            ("max_tokens", payload.max_tokens),
            (
                "reasoning_effort",
                None if payload.reasoning_effort == "default" else payload.reasoning_effort,
            ),
        ):
            if value is not None:
                body[field] = value
        headers = {"Authorization": "Bearer " + plaintext, "Content-Type": "application/json"}
        with httpx.Client(timeout=300) as client:
            with client.stream(
                "POST", base_url + endpoint.path, json=body, headers=headers
            ) as upstream:
                yield from upstream.iter_text()

    return StreamingResponse(relay(), media_type="text/event-stream")
