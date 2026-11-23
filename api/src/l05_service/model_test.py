"""Server-side model tests through the data plane.

W9 decision: the control plane never calls an upstream model directly. A test
uses the auto-generated public model <upstream>/<model> and the internal
"测试专用" key, exactly like Playground. Agentgateway therefore authenticates,
routes, fails over and writes usage/log rows for the test; billing/usage views
see the request. Results shown next to a model are read back from those log
events, not from a private probe table.
"""

from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from l01_core.crypto import AesGcmBox
from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import (
    ConfigRevisionORM,
    GatewayUsageEventORM,
    UpstreamModelORM,
    UpstreamORM,
)
from l05_service import auto_public
from l05_service.playground_identity import ensure_test_identity
from l05_service.usage_pull import pull_once

MODEL_TEST_TIMEOUT_SECONDS = 60.0
MODEL_TEST_MAX_OUTPUT_TOKENS = 16
MODEL_TEST_MESSAGE = "hi"


def _display_error(response: httpx.Response) -> str:
    text = ""
    try:
        payload = response.json()
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            text = str(error.get("message") or error.get("type") or "")
        elif isinstance(payload, dict):
            text = str(payload.get("message") or payload.get("detail") or "")
    except Exception:
        text = response.text[:500]
    text = " ".join(text.split())
    return text[:500]


def _data_plane_auth_failure(message: str) -> bool:
    """agentgateway rejects an unknown client key with a plain-text 401.

    Upstream 401s carry a provider-specific message instead; only the exact
    gateway wording is rewritten so a genuinely bad upstream key keeps showing
    the provider's own error.
    """
    lowered = message.strip().lower()
    return lowered == "authentication failed" or "api key authentication failure" in lowered


def _public_names(session: Session, models: list[UpstreamModelORM]) -> dict[str, str]:
    names: dict[str, str] = {}
    for model in models:
        public = auto_public.ensure_auto_public_model(session, model)
        names[model.id] = public.name
    session.flush()
    return names


def _one_test(
    *,
    base_url: str,
    endpoint: str,
    public_name: str,
    test_key: str,
) -> tuple[bool, int, int, str, str, dict[str, Any]]:
    url = base_url.rstrip("/") + endpoint
    body = {
        "model": public_name,
        "messages": [{"role": "user", "content": MODEL_TEST_MESSAGE}],
        "max_tokens": MODEL_TEST_MAX_OUTPUT_TOKENS,
        "temperature": 0,
        "stream": False,
    }
    headers = {"Authorization": "Bearer " + test_key, "Content-Type": "application/json"}
    started = __import__("time").perf_counter()
    try:
        with httpx.Client(timeout=MODEL_TEST_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=body, headers=headers)
    except httpx.TimeoutException:
        elapsed = int((__import__("time").perf_counter() - started) * 1000)
        return False, 0, elapsed, "timeout", f"请求超时（{int(MODEL_TEST_TIMEOUT_SECONDS)} 秒）", {}
    except httpx.HTTPError as exc:
        elapsed = int((__import__("time").perf_counter() - started) * 1000)
        return False, 0, elapsed, "connection", f"连接数据面失败：{exc}", {}
    elapsed = int((__import__("time").perf_counter() - started) * 1000)
    if 200 <= response.status_code < 300:
        try:
            payload = response.json()
        except Exception:
            payload = {}
        usage = payload.get("usage") if isinstance(payload, dict) else None
        return True, response.status_code, elapsed, "", "", usage if isinstance(usage, dict) else {}
    return False, response.status_code, elapsed, "http", _display_error(response), {}


def test_upstream_models(
    session: Session,
    upstream: UpstreamORM,
    *,
    model_ids: list[str],
    adapter: DataPlaneAdapter,
) -> dict[str, Any]:
    requested = list(dict.fromkeys((raw or "").strip() for raw in model_ids if (raw or "").strip()))
    if not requested:
        raise AppError(ErrorCode.VALIDATION_ERROR, "model_ids 不能为空")
    models = list(
        session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.id.in_(requested))
        ).all()
    )
    by_id = {model.id: model for model in models}
    unknown = [model_id for model_id in requested if model_id not in by_id]
    foreign = [
        model_id
        for model_id in requested
        if model_id in by_id and by_id[model_id].upstream_id != upstream.id
    ]
    if unknown or foreign:
        details: dict[str, Any] = {}
        if unknown:
            details["unknown_model_ids"] = unknown
        if foreign:
            details["foreign_model_ids"] = foreign
        raise AppError(
            ErrorCode.VALIDATION_ERROR, "只能测试该上游已存在的模型", details=details
        )

    contract = adapter.client_contract()
    endpoint = contract.endpoint_for("chat.completions")
    if endpoint is None:
        raise AppError(
            ErrorCode.CONFLICT,
            "当前数据面没有提供对话端点",
            details={"adapter": get_settings().data_plane_adapter},
        )
    key = ensure_test_identity(session)
    test_key = AesGcmBox(get_settings().secret_key).decrypt(key.key_enc)
    active_revision = session.scalars(
        select(ConfigRevisionORM)
        .where(ConfigRevisionORM.status == "active")
        .order_by(ConfigRevisionORM.created_at_ms.desc())
    ).first()
    test_key_loaded = bool(
        active_revision
        and key.key_hash
        and key.key_hash in (active_revision.artifact or "")
    )
    names = _public_names(session, models)
    base_url = contract.base_url()

    items: list[dict[str, Any]] = []
    for model_id in requested:
        model = by_id[model_id]
        public_name = names[model.id]
        ok, status, latency_ms, error_type, message, usage = _one_test(
            base_url=base_url,
            endpoint=endpoint.path,
            public_name=public_name,
            test_key=test_key,
        )
        if not ok and status == 404:
            message = (
                "数据面还没有这个公开模型；请先保存并下发配置。"
                + (f"（上游返回：{message}）" if message else "")
            )
        elif (
            not ok
            and status == 401
            and not test_key_loaded
            and _data_plane_auth_failure(message)
        ):
            message = (
                "数据面尚未加载测试专用凭据，模型测试被网关拒绝（401）；"
                "请先在网关策略页保存并下发配置后重试。"
                + (f"（数据面返回：{message}）" if message else "")
            )
        items.append(
            {
                "model_id": model.id,
                "model": model.name,
                "public_model": public_name,
                "ok": ok,
                "status": status,
                "latency_ms": latency_ms,
                "error_type": error_type,
                "message": message,
                "usage": usage,
            }
        )

    pulled = 0
    try:
        pulled = pull_once(session, adapter)
    except Exception:
        # Logs are eventually consistent; the test result is still valid.
        pulled = 0
    return {
        "upstream_id": upstream.id,
        "key_id": key.id,
        "pulled_events": pulled,
        "items": items,
    }


def latest_test_results(
    session: Session, upstream: UpstreamORM, *, model_ids: list[str] | None = None
) -> dict[str, Any]:
    """Latest log-backed test result per upstream model (no model probe table)."""
    key = ensure_test_identity(session)
    models = list(
        session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.upstream_id == upstream.id)
        ).all()
    )
    if model_ids:
        wanted = set(model_ids)
        models = [model for model in models if model.id in wanted]
    names = _public_names(session, models)
    by_public = {name: model for model, name in ((m, names[m.id]) for m in models)}
    events = list(
        session.scalars(
            select(GatewayUsageEventORM)
            .where(
                GatewayUsageEventORM.api_key_id == key.id,
                or_(
                    GatewayUsageEventORM.requested_model.in_(list(by_public)),
                    GatewayUsageEventORM.public_model.in_(list(by_public)),
                ),
            )
            .order_by(GatewayUsageEventORM.started_at_ms.desc())
        ).all()
    )
    latest: dict[str, GatewayUsageEventORM] = {}
    for event in events:
        matched = (
            event.requested_model
            if event.requested_model in by_public
            else event.public_model
        )
        latest.setdefault(matched, event)
    items: list[dict[str, Any]] = []
    for public_name, model in by_public.items():
        event = latest.get(public_name)
        if event is None:
            continue
        items.append(
            {
                "model_id": model.id,
                "model": model.name,
                "public_model": public_name,
                "ok": not bool(event.error) and (event.http_status or 0) < 400,
                "status": event.http_status or 0,
                "latency_ms": event.duration_ms or 0,
                "started_at_ms": event.started_at_ms,
                "input_tokens": event.input_tokens or 0,
                "output_tokens": event.output_tokens or 0,
                "error": event.error or "",
            }
        )
    return {"upstream_id": upstream.id, "items": items}
