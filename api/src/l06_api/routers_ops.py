"""Operational routes: log search and playground SSE proxy."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l03_adapters.spi import DataPlaneAdapter
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
from l05_service import auth, log_facts, log_query
from l05_service.attempts import (
    AttemptChainSummary,
    attempt_summaries,
    attempts_for_event,
    resolve_attempt_upstream_facts,
)
from l05_service.models_dev import user_model_parameters
from l05_service.playground_identity import ensure_playground_identity
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.playground import (
    REGISTERED_OUTPUT_CAP_FIELDS,
    PlaygroundRequest,
    relay_body,
)
from l06_api.schemas import (
    LogAttemptOut,
    LogAttemptsOut,
    LogQuerySyntaxOut,
    LogQueryTokenOut,
)

router = APIRouter(tags=["ops"])


# ---------------------------------------------------------------- logs


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
        row.event_id: log_facts.identity_of(row.api_key_id, keys_by_id, users_by_id) for row in rows
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
    keys_by_id, users_by_id = log_facts.identity_tables(session)
    total = 0
    page_rows: list[GatewayUsageEventORM] = []
    page_identities: dict[str, tuple[str, str, str]] = {}
    for row in session.scalars(stmt.execution_options(yield_per=500)):
        raw = log_facts.raw_of(row.raw_json)
        identity = log_facts.identity_of(row.api_key_id, keys_by_id, users_by_id)
        if not log_query.matches_keywords(row, identity=identity, raw=raw, keywords=keywords):
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
    stream = log_facts.stream_verdict(row)
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
        "cache_ratio": log_facts.cache_ratio(row),
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
    parsed = log_query.parse_log_query(query)
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
    clauses, needs_identity = log_query.filter_clauses(
        parsed, from_ms=from_ms, to_ms=to_ms, has_error=has_error
    )
    cost_sort = sort == "cost_micro"
    charge_sort = sort == "charge_micro"
    order_by = _log_order_by(sort, order)
    if parsed.keywords:
        prefilter, prefilter_identity = log_query.keyword_prefilter(
            parsed.keywords, raw_column=GatewayUsageEventORM.raw_json
        )
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



@router.get("/admin/logs/query-syntax", response_model=LogQuerySyntaxOut)
def log_query_syntax(
    principal: auth.Principal = Depends(require("logs:read")),
) -> LogQuerySyntaxOut:
    """Canonical query token catalog; keeps the help dialog and parser in sync."""
    return LogQuerySyntaxOut(
        tokens=[
            LogQueryTokenOut(token=spec.token, meaning=spec.meaning, example=spec.example)
            for spec in log_query.query_token_specs()
        ]
    )


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
    facts = resolve_attempt_upstream_facts(session, [row.upstream_ref for row in rows])
    return LogAttemptsOut(
        event_id=event_id,
        correlation_key=correlation_key,
        attempts=[
            LogAttemptOut(
                attempt=row.attempt_no,
                upstream_id=facts[row.upstream_ref or ""].upstream_id,
                upstream_name=facts[row.upstream_ref or ""].upstream_name,
                upstream_key_seq=facts[row.upstream_ref or ""].upstream_key_seq,
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
    keys_by_id, users_by_id = log_facts.identity_tables(session)
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
        identity=log_facts.identity_of(row.api_key_id, keys_by_id, users_by_id),
        upstream_model_id=umodel.id if umodel is not None else "",
        target_priority=target.priority if target is not None else None,
        cost_micro=cost.amount_micro if cost else None,
        charge_micro=charge.amount_micro if charge else None,
        currency=(charge.currency if charge else (cost.currency if cost else "")),
        attempts=attempts,
    )


# ---------------------------------------------------------------- playground


def _registered_max_output_tokens(session: Session, model: str) -> int | None:
    """所选模型（公开模型名）登记的 max_output_tokens；未登记/未声明返回 None.

    单一事实源就是 GET /admin/my/models 背后的成员合并逻辑：控制面按「只填空」
    合并成员参数，前端面板看到的登记值与此处一致，不会各算各的。0 = 未声明，
    控制面无值可依，per-model 校验跳过（schema 静态上限仍兜底），前端回退
    安全默认并在 UI 如实标注。
    """
    for item in user_model_parameters(session):
        if item["name"] == model:
            return item["parameters"]["max_output_tokens"] or None
    return None


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
    # Ticket 19: the registered max_output_tokens is the backend backstop for
    # the output token cap; the frontend inline hint is the first layer.
    registered = _registered_max_output_tokens(session, payload.model)
    if registered is not None:
        for field in REGISTERED_OUTPUT_CAP_FIELDS:
            value = getattr(payload, field)
            if value is not None and value > registered:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR,
                    f"{field} 超过所选模型登记的最大输出词元 {registered}",
                    details={"model": payload.model, "field": field, "registered": registered},
                )
    settings = get_settings()
    key, _created = ensure_playground_identity(session, commit=True)
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
        # One table drives both the request schema and this body (ticket 05):
        # no per-field hand wiring and no second whitelist here.
        body = relay_body(payload)
        headers = {"Authorization": "Bearer " + plaintext, "Content-Type": "application/json"}
        with httpx.Client(timeout=300) as client:
            with client.stream(
                "POST", base_url + endpoint.path, json=body, headers=headers
            ) as upstream:
                yield from upstream.iter_text()

    return StreamingResponse(relay(), media_type="text/event-stream")
