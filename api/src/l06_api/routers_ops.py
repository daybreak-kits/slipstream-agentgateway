"""Operational routes: log search and playground SSE proxy."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from dataclasses import field as dc_field

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l04_repo.orm import (
    ApiKeyORM,
    ChargeEntryORM,
    CostEntryORM,
    GatewayUsageEventORM,
    ModelTargetORM,
    PublicModelORM,
    UpstreamModelORM,
    UserORM,
)
from l04_repo.repository import get_setting, put_setting
from l05_service import auth, client_keys
from l06_api import field_filter
from l06_api.deps import page_params, require, session_of
from l06_api.schemas import PlaygroundRequest

router = APIRouter(tags=["ops"])


# ---------------------------------------------------------------- logs


def _raw_of(row: GatewayUsageEventORM) -> dict:
    """Parsed raw_json (the AG request_logs row); {} when absent or malformed."""
    try:
        value = json.loads(row.raw_json or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _as_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"true", "1", "yes", "on", "stream"}


_STREAM_ATTR_KEYS = ("gen_ai.request.stream", "gen_ai.request.is_stream", "stream")


def _is_stream(raw: dict, ttft_ms: int) -> bool:
    """Streaming is derived: an explicit flag wins, otherwise a TTFT marks the stream."""
    for key in ("is_stream", "stream"):
        if key in raw:
            return _as_bool(raw[key])
    attrs = raw.get("attributes_json")
    if isinstance(attrs, str) and attrs.strip():
        try:
            attrs = json.loads(attrs)
        except ValueError:
            attrs = None
    if isinstance(attrs, dict):
        for key in _STREAM_ATTR_KEYS:
            if key in attrs:
                return _as_bool(attrs[key])
    return ttft_ms > 0


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


def _matches_query(
    row: GatewayUsageEventORM,
    parsed: _LogQuery,
    *,
    identity: tuple[str, str, str],
    is_stream: bool,
    cache_ratio: float | None,
    raw: dict,
) -> bool:
    """One row against every parsed token (AND semantics, like the v1 endpoint)."""
    user_id, user_name, api_key_label = identity
    model_text = f"{row.public_model or ''} {row.upstream_model or ''}".lower()
    upstream_text = f"{row.provider or ''} {row.upstream_model or ''}".lower()
    if any(value not in model_text for value in parsed.models):
        return False
    if any(value not in upstream_text for value in parsed.upstreams):
        return False
    # user: matches the consumer id OR the display name (key: already covers
    # the id path; this widens name-based filtering to id-based filtering).
    user_text = f"{user_name} {user_id}".lower()
    if any(value not in user_text for value in parsed.users):
        return False
    key_text = f"{api_key_label} {row.api_key_id or ''} {user_id}".lower()
    if any(value not in key_text for value in parsed.keys):
        return False
    if parsed.statuses and not any(
        floor <= (row.http_status or 0) < ceiling for floor, ceiling in parsed.statuses
    ):
        return False
    if parsed.min_latency and (row.duration_ms or 0) <= parsed.min_latency:
        return False
    if parsed.max_latency and not 0 < (row.duration_ms or 0) < parsed.max_latency:
        return False
    if parsed.min_ttft and (row.time_to_first_token_ms or 0) <= parsed.min_ttft:
        return False
    if parsed.min_cache_ratio >= 0 and (
        cache_ratio is None or cache_ratio < parsed.min_cache_ratio
    ):
        return False
    if parsed.stream is not None and is_stream is not parsed.stream:
        return False
    if parsed.keywords:
        haystack = json.dumps(
            {
                "id": row.event_id,
                "models": [row.public_model, row.upstream_model, row.provider],
                "identity": [user_name, api_key_label, row.api_key_id],
                "raw": raw,
            },
            ensure_ascii=False,
        ).lower()
        if any(keyword not in haystack for keyword in parsed.keywords):
            return False
    return True


def _log_item(
    row: GatewayUsageEventORM,
    raw: dict,
    *,
    identity: tuple[str, str, str],
    upstream_model_id: str,
    target_priority: int | None,
    cost_micro: int | None,
    charge_micro: int | None,
    currency: str,
) -> dict:
    """One record as the UI consumes it; the drawer reuses this exact shape."""
    user_id, user_name, api_key_label = identity
    stream = _is_stream(raw, row.time_to_first_token_ms or 0)
    error = str(raw.get("error") or "")
    margin = (
        charge_micro - cost_micro
        if charge_micro is not None and cost_micro is not None
        else None
    )
    return {
        "event_id": row.event_id,
        "started_at_ms": row.started_at_ms,
        "completed_at_ms": row.completed_at_ms,
        "duration_ms": row.duration_ms,
        "time_to_first_token_ms": row.time_to_first_token_ms,
        "http_status": row.http_status,
        "public_model": row.public_model,
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
        "has_payload": bool(raw.get("has_payload")),
        "error": error,
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
    rows = list(
        session.scalars(
            select(GatewayUsageEventORM).order_by(
                GatewayUsageEventORM.started_at_ms.desc(), GatewayUsageEventORM.event_id.desc()
            )
        ).all()
    )
    keys_by_id, users_by_id = _identity_tables(session)
    raws = {row.event_id: _raw_of(row) for row in rows}
    identities = {
        row.event_id: _identity_of(row.api_key_id, keys_by_id, users_by_id) for row in rows
    }
    streams = {
        row.event_id: _is_stream(raws[row.event_id], row.time_to_first_token_ms or 0)
        for row in rows
    }
    ratios = {row.event_id: _cache_ratio(row) for row in rows}
    rows = [
        row
        for row in rows
        if _matches_query(
            row,
            parsed,
            identity=identities[row.event_id],
            is_stream=streams[row.event_id],
            cache_ratio=ratios[row.event_id],
            raw=raws[row.event_id],
        )
    ]
    if from_ms:
        rows = [r for r in rows if r.started_at_ms >= from_ms]
    if to_ms:
        rows = [r for r in rows if r.started_at_ms < to_ms]
    if has_error is not None:
        rows = [r for r in rows if bool(raws[r.event_id].get("error")) == has_error]
    charge_by_event = {
        row.gateway_event_id: row for row in session.scalars(select(ChargeEntryORM)).all()
    }
    cost_by_event = {
        row.gateway_event_id: row for row in session.scalars(select(CostEntryORM)).all()
    }
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
    reverse = order == "desc"

    def _cost_amount(event_id: str) -> int:
        entry = cost_by_event.get(event_id)
        return entry.amount_micro if entry is not None and entry.amount_micro is not None else -1

    def _charge_amount(event_id: str) -> int:
        entry = charge_by_event.get(event_id)
        return entry.amount_micro if entry is not None and entry.amount_micro is not None else -1

    if sort == "started_at":
        rows.sort(key=lambda r: (r.started_at_ms, r.event_id), reverse=reverse)
    elif sort == "duration_ms":
        rows.sort(key=lambda r: r.duration_ms or 0, reverse=reverse)
    elif sort == "total_tokens":
        rows.sort(key=lambda r: r.total_tokens or 0, reverse=reverse)
    elif sort == "cost_micro":
        rows.sort(key=_cost_amount, reverse=reverse)
    else:
        rows.sort(key=_charge_amount, reverse=reverse)
    total = len(rows)
    rows = rows[off : off + limit]
    umodel_ids_by_name = {
        row.name: row.id for row in session.scalars(select(UpstreamModelORM)).all()
    }
    target_priorities = {
        (t_row.public_model_id, t_row.upstream_model_id): t_row.priority
        for t_row in session.scalars(select(ModelTargetORM)).all()
    }
    public_by_name = {
        row.name: row.id for row in session.scalars(select(PublicModelORM)).all()
    }
    items = []
    for row in rows:
        public_id = public_by_name.get(row.public_model, "")
        umodel_id = umodel_ids_by_name.get(row.upstream_model, "")
        charge = charge_by_event.get(row.event_id)
        cost = cost_by_event.get(row.event_id)
        items.append(
            _log_item(
                row,
                raws[row.event_id],
                identity=identities[row.event_id],
                upstream_model_id=umodel_id,
                target_priority=target_priorities.get((public_id, umodel_id))
                if public_id
                else None,
                cost_micro=cost.amount_micro if cost else None,
                charge_micro=charge.amount_micro if charge else None,
                currency=(charge.currency if charge else (cost.currency if cost else "")),
            )
        )
    next_offset = off + limit if off + limit < total else None
    return {"total": total, "items": items, "next_offset": next_offset}


@router.get("/admin/logs/{event_id}")
def log_detail(
    event_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
    include_payload: bool = False,
) -> dict:
    """Full record for the drawer; money obeys the same field filter as the list."""
    row = session.get(GatewayUsageEventORM, event_id)
    if row is None:
        raise AppError(ErrorCode.NOT_FOUND, f"log entry not found: {event_id}")
    raw = _raw_of(row)
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
    body = _log_item(
        row,
        raw,
        identity=_identity_of(row.api_key_id, keys_by_id, users_by_id),
        upstream_model_id=umodel.id if umodel is not None else "",
        target_priority=target.priority if target is not None else None,
        cost_micro=cost.amount_micro if cost else None,
        charge_micro=charge.amount_micro if charge else None,
        currency=(charge.currency if charge else (cost.currency if cost else "")),
    )
    if include_payload:
        # AG strips bodies unless has_payload; scrub before serialising so a
        # cost-stripped caller cannot read the raw USD cost back out of the JSON.
        body["raw_json"] = json.dumps(
            field_filter.sanitize(raw, principal.permissions), ensure_ascii=False
        )
    return body


# ---------------------------------------------------------------- playground


def _playground_identity(session: Session) -> ApiKeyORM:
    """Ensure the playground system user + its internal key exist; return the key.

    The plaintext never persists: it is decrypted from key_enc per request and
    used server-side to call the 3600 data plane (admin-only, low frequency).
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
    payload: PlaygroundRequest, session: Session = Depends(session_of)
) -> StreamingResponse:
    """SSE pass-through to the 3600 data plane using the server-side internal key."""
    settings = get_settings()
    key = _playground_identity(session)
    plaintext = AesGcmBox(settings.secret_key).decrypt(key.key_enc)
    base_url = "http://127.0.0.1:" + str(settings.ag_llm_port)

    def relay():
        body = {
            "model": payload.model,
            "stream": True,
            "messages": [m.model_dump() for m in payload.messages],
        }
        # Optional sampling knobs: omitted from the body when the caller left them unset.
        for field, value in (
            ("temperature", payload.temperature),
            ("top_p", payload.top_p),
            ("max_tokens", payload.max_tokens),
            ("reasoning_effort", payload.reasoning_effort),
        ):
            if value is not None:
                body[field] = value
        headers = {"Authorization": "Bearer " + plaintext, "Content-Type": "application/json"}
        with httpx.Client(timeout=300) as client:
            with client.stream(
                "POST", base_url + "/v1/chat/completions", json=body, headers=headers
            ) as upstream:
                yield from upstream.iter_text()

    return StreamingResponse(relay(), media_type="text/event-stream")
