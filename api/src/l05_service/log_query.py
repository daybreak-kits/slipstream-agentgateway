"""Log query syntax: one token table, one parsed predicate, two matchers.

The HTTP layer only reads the query string and turns AppError into the shared
422 envelope. Token semantics live here: parsing, the SQL pushdown clauses and
the in-memory keyword matcher are all driven by the same ParsedLogQuery.

The exported token catalog is also the source for the console's query-syntax
help; the frontend must not keep a second copy of this list.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from dataclasses import field as dc_field

from sqlalchemy import and_, case, func, literal, or_

from l01_core.errors import AppError, ErrorCode
from l04_repo.orm import ApiKeyORM, GatewayUsageEventORM, UserORM


@dataclass(frozen=True, slots=True)
class QueryTokenSpec:
    """One documented query token, used by the help endpoint."""

    token: str
    meaning: str
    example: str


QUERY_TOKEN_SPECS = (
    QueryTokenSpec("model:glm", "匹配公开模型或上游模型名", "model:glm-5.3"),
    QueryTokenSpec(
        "upstream:zai", "匹配上游标识（provider）或上游模型名", "upstream:zai"
    ),
    QueryTokenSpec("user:alice", "匹配用户 ID 或用户名称", "user:alice"),
    QueryTokenSpec(
        "key:WXYZ",
        "匹配密钥后缀（列表里的 sk-...WXYZ）或密钥 ID",
        "key:WXYZ",
    ),
    QueryTokenSpec("status:200", "精确 HTTP 状态码", "status:200"),
    QueryTokenSpec("status:5xx", "按状态码段筛选（1xx 至 5xx）", "status:5xx"),
    QueryTokenSpec("latency>500", "总耗时大于 N 毫秒", "latency>500"),
    QueryTokenSpec(
        "latency<200", "总耗时小于 N 毫秒（0 耗时不匹配）", "latency<200"
    ),
    QueryTokenSpec("ttft>300", "首字时间大于 N 毫秒", "ttft>300"),
    QueryTokenSpec("cache>30", "缓存命中比例大于 N%（0 至 100）", "cache>30"),
    QueryTokenSpec(
        "stream:true",
        "只看流式（true）或非流式（false）请求",
        "stream:true",
    ),
)


def query_token_specs() -> list[QueryTokenSpec]:
    return list(QUERY_TOKEN_SPECS)


@dataclass(slots=True)
class ParsedLogQuery:
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


def parse_log_query(query: str) -> ParsedLogQuery:
    """Validate the free-text query; bad values return 422 instead of a 500 later."""
    parsed = ParsedLogQuery()
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


def matches_keywords(
    row: GatewayUsageEventORM,
    *,
    identity: tuple[str, str, str],
    raw: dict,
    keywords: list[str],
) -> bool:
    haystack = _keyword_haystack(row, identity=identity, raw=raw)
    return all(keyword in haystack for keyword in keywords)


def _log_stream_expr():
    """SQL twin of stream_verdict over the neutral column + ttft, usable in WHERE."""
    verdict = GatewayUsageEventORM.is_stream
    ttft = func.coalesce(GatewayUsageEventORM.time_to_first_token_ms, 0)
    return case((verdict.is_not(None), verdict), else_=case((ttft > 0, 1), else_=0))


def _log_has_error_expr():
    """SQL twin of bool(row.error): the normalized error column decides."""
    return case((GatewayUsageEventORM.error != literal(""), 1), else_=0)


def _log_cache_expr():
    """(cached tokens, ratio) mirroring cache_ratio; SQLite rounds half away from zero."""
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


def filter_clauses(
    parsed: ParsedLogQuery,
    *,
    from_ms: int,
    to_ms: int,
    has_error: bool | None,
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


def _haystack_fallback(raw_column):
    """Rows a plain LIKE prefilter could miss: escapes, non-ASCII and null identities."""
    return or_(
        _non_ascii(raw_column),
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
        func.instr(raw_column, "\\u") > 0,
        GatewayUsageEventORM.api_key_id.is_(None),
    )


def keyword_prefilter(keywords: list[str], *, raw_column) -> tuple[list, bool]:
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
    fallback = _haystack_fallback(raw_column)
    clauses = [
        or_(
            _like_contains(raw_column, token),
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
