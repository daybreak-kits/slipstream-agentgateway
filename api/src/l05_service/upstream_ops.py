"""Upstream operations beyond CRUD (ticket 09): multi-key, probes, discovery, batch.

ADR-026 多密钥平权: every ``upstream_keys`` row is an equal credential and the
renderer expands each row into its own AG provider/key file - there is no
primary key, no rotation and no mirror into ``upstreams.api_key_enc`` (the
legacy column is retired; ``_ensure_rows`` materializes it into a real row for
databases that predate this table). Probe rows are append-only so the list can
show the last outcome. ``fetch_models`` (one style) and ``detect_api_style``
(ADR-023 #6 auto-probing) are the network calls, kept module level so tests can
replace them without touching HTTP.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.crypto import SecretBox
from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l02_domain.models import ApiStyle, ModelType
from l04_repo.orm import (
    AuditLogORM,
    ModelTargetORM,
    UpstreamKeyORM,
    UpstreamModelORM,
    UpstreamORM,
    UpstreamProbeORM,
)
from l04_repo.repository import (
    AUDIT_REPO,
    UPSTREAM_KEY_REPO,
    UPSTREAM_MODEL_REPO,
    UPSTREAM_PROBE_REPO,
    UPSTREAM_REPO,
)

MAX_UPSTREAM_KEYS = 20
PROBE_TIMEOUT_SECONDS = 8.0
LEGACY_KEY_ID = "legacy"

# ADR-023 #6: auto-probing order; openai_responses is the disambiguation probe
# that only runs after the openai family /models check succeeded.
DETECT_ORDER: tuple[ApiStyle, ...] = (
    ApiStyle.OPENAI_CHAT,
    ApiStyle.OPENAI_RESPONSES,
    ApiStyle.ANTHROPIC_MESSAGES,
    ApiStyle.GEMINI,
)
# OpenAI floors max_output_tokens at 16; smaller probe requests are rejected.
RESPONSES_PROBE_MAX_TOKENS = 16
_ANTHROPIC_VERSION = "2023-06-01"

# Ticket 05 model probe: one minimal chat per stored model, serial, no persistence.
MODEL_PROBE_TIMEOUT_SECONDS = 20.0
MODEL_PROBE_MAX_TOKENS = 16
MODEL_PROBE_MESSAGE_LIMIT = 200


def _upstream(session: Session, upstream_id: str) -> UpstreamORM:
    upstream = UPSTREAM_REPO.get(session, upstream_id)
    if upstream is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream not found: {upstream_id}")
    return upstream


def _audit(
    session: Session,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    detail_json: str = "{}",
) -> None:
    AUDIT_REPO.add(
        session,
        AuditLogORM(
            id=new_id("aud"),
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail_json=detail_json,
            created_at_ms=now_ms(),
        ),
    )


def _key_rows(session: Session, upstream_id: str) -> list[UpstreamKeyORM]:
    stmt = (
        select(UpstreamKeyORM)
        .where(UpstreamKeyORM.upstream_id == upstream_id)
        .order_by(UpstreamKeyORM.created_at_ms, UpstreamKeyORM.id)
    )
    return list(session.scalars(stmt).all())


def _suffix(plaintext: str) -> str:
    return plaintext[-4:] if len(plaintext) > 4 else plaintext


def _mask(suffix: str) -> str:
    return "…" + suffix if suffix else "…"


def key_view(row: UpstreamKeyORM) -> dict[str, Any]:
    """Masked key row plus the last per-key test outcome (ADR-026 ③)."""
    return {
        "id": row.id,
        "label": row.label,
        "masked": _mask(row.key_suffix),
        "key_suffix": row.key_suffix,
        "created_at_ms": row.created_at_ms,
        "last_test": (json.loads(row.last_test_json) if row.last_test_json else None),
        "last_test_at_ms": row.last_test_at_ms,
    }


def _decrypt(secret_box: SecretBox, ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return secret_box.decrypt(ciphertext)
    except Exception:  # noqa: BLE001 - a corrupt key must not 500 the console
        return ""


def list_keys(
    session: Session, upstream: UpstreamORM, secret_box: SecretBox
) -> list[dict[str, Any]]:
    """Masked keys; an upstream created before this table gets a synthetic row."""
    rows = _key_rows(session, upstream.id)
    if rows:
        return [key_view(row) for row in rows]
    if not upstream.api_key_enc:
        return []
    suffix = _suffix(_decrypt(secret_box, upstream.api_key_enc))
    return [
        {
            "id": LEGACY_KEY_ID,
            "label": "默认密钥",
            "masked": _mask(suffix),
            "key_suffix": suffix,
            "created_at_ms": upstream.created_at_ms,
            "legacy": True,
            "last_test": None,
            "last_test_at_ms": 0,
        }
    ]


def key_count(session: Session, upstream: UpstreamORM) -> int:
    """Row count including the pre-table credential (no write on list)."""
    rows = _key_rows(session, upstream.id)
    if rows:
        return len(rows)
    return 1 if upstream.api_key_enc else 0


def _ensure_rows(
    session: Session, upstream: UpstreamORM, secret_box: SecretBox
) -> list[UpstreamKeyORM]:
    """Persist the legacy inline credential as the first key row when needed.

    ADR-026 retired the mirror, but a database created before ``upstream_keys``
    still carries the credential in ``upstreams.api_key_enc``; materializing it
    here (write paths only) keeps that one inline key from being orphaned by the
    first key-panel action. The bulk path is scripts/migrate_multikey_v2.py.
    """
    rows = _key_rows(session, upstream.id)
    if rows or not upstream.api_key_enc:
        return rows
    row = UpstreamKeyORM(
        id=new_id("upk"),
        upstream_id=upstream.id,
        label="默认密钥",
        key_enc=upstream.api_key_enc,
        key_suffix=_suffix(_decrypt(secret_box, upstream.api_key_enc)),
        created_at_ms=upstream.created_at_ms or now_ms(),
    )
    UPSTREAM_KEY_REPO.add(session, row)
    return [row]


def create_initial_key(
    session: Session, upstream: UpstreamORM, *, api_key: str, secret_box: SecretBox
) -> UpstreamKeyORM:
    """Create the first key row for a freshly created upstream.

    ADR-026: this row is the credential's only home - ``upstreams.api_key_enc``
    is no longer written, and the renderer expands the row into its own
    provider/key file.
    """
    row = UpstreamKeyORM(
        id=new_id("upk"),
        upstream_id=upstream.id,
        label="默认密钥",
        key_enc=secret_box.encrypt(api_key),
        key_suffix=_suffix(api_key),
        created_at_ms=now_ms(),
    )
    UPSTREAM_KEY_REPO.add(session, row)
    return row


def _resolve(rows: list[UpstreamKeyORM], key_id: str) -> UpstreamKeyORM:
    # The synthetic id from a pre-table upstream becomes a real row on first
    # write (_ensure_rows), so map it to that row instead of 404ing.
    if key_id == LEGACY_KEY_ID and len(rows) == 1:
        return rows[0]
    for row in rows:
        if row.id == key_id:
            return row
    raise AppError(ErrorCode.NOT_FOUND, f"upstream key not found: {key_id}")


def add_key(
    session: Session,
    upstream: UpstreamORM,
    *,
    label: str,
    api_key: str,
    secret_box: SecretBox,
    actor: str = "",
) -> UpstreamKeyORM:
    """Add one equal credential row (ADR-026: no primary semantics)."""
    rows = _ensure_rows(session, upstream, secret_box)
    if len(rows) >= MAX_UPSTREAM_KEYS:
        raise AppError(
            ErrorCode.CONFLICT,
            f"每个上游最多 {MAX_UPSTREAM_KEYS} 把密钥",
            details={"limit": MAX_UPSTREAM_KEYS},
        )
    for row in rows:
        if _decrypt(secret_box, row.key_enc) == api_key:
            raise AppError(ErrorCode.CONFLICT, "该密钥已存在，未重复添加")
    row = UpstreamKeyORM(
        id=new_id("upk"),
        upstream_id=upstream.id,
        label=label,
        key_enc=secret_box.encrypt(api_key),
        key_suffix=_suffix(api_key),
        created_at_ms=now_ms(),
    )
    UPSTREAM_KEY_REPO.add(session, row)
    _audit(
        session,
        actor=actor,
        action="add_key",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"key_id": row.id}),
    )
    return row


def update_key(
    session: Session,
    upstream: UpstreamORM,
    key_id: str,
    *,
    label: str | None = None,
    secret_box: SecretBox,
    actor: str = "",
) -> UpstreamKeyORM:
    """Rename one key row; label is the only editable field (ADR-026 ②)."""
    rows = _ensure_rows(session, upstream, secret_box)
    row = _resolve(rows, key_id)
    if label is not None:
        row.label = label
    session.flush()
    _audit(
        session,
        actor=actor,
        action="update_key",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"key_id": row.id}),
    )
    return row


def delete_key(
    session: Session,
    upstream: UpstreamORM,
    key_id: str,
    *,
    secret_box: SecretBox,
    actor: str = "",
) -> None:
    """Delete one key row; the last remaining key is protected (ADR-026 ⑥)."""
    rows = _ensure_rows(session, upstream, secret_box)
    row = _resolve(rows, key_id)
    if len(rows) <= 1:
        raise AppError(
            ErrorCode.CONFLICT,
            "至少保留一把密钥；如需停止调用请直接停用上游",
        )
    UPSTREAM_KEY_REPO.delete(session, row)
    _audit(
        session,
        actor=actor,
        action="delete_key",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"key_id": key_id}),
    )


def batch_delete_keys(
    session: Session,
    upstream: UpstreamORM,
    *,
    ids: list[str],
    secret_box: SecretBox,
    actor: str = "",
) -> dict[str, Any]:
    """Delete many keys with a per-key report; the last key is refused (409).

    Items report in request order; a missing id and the "at least one key"
    refusal are per-item errors, never an abort of the whole batch.
    """
    rows = _ensure_rows(session, upstream, secret_box)
    by_id = {row.id: row for row in rows}
    items: list[dict[str, Any]] = []
    deleted: list[str] = []
    for key_id in ids:
        row = by_id.get(key_id)
        if row is None:
            items.append({"key_id": key_id, "ok": False, "error": "密钥不存在"})
            continue
        if len(rows) - len(deleted) <= 1:
            items.append(
                {
                    "key_id": key_id,
                    "ok": False,
                    "error": "至少保留一把密钥；如需停止调用请直接停用上游",
                }
            )
            continue
        UPSTREAM_KEY_REPO.delete(session, row)
        deleted.append(key_id)
        items.append({"key_id": key_id, "ok": True})
    session.flush()
    _audit(
        session,
        actor=actor,
        action="batch_delete_keys",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"deleted": deleted}),
    )
    return {"items": items, "deleted": len(deleted)}


def test_keys(
    session: Session,
    upstream: UpstreamORM,
    *,
    secret_box: SecretBox,
    api_style_override: str | None = None,
    actor: str = "",
) -> dict[str, Any]:
    """Test every key of this upstream against its base_url (ADR-026 ③).

    One minimal authenticated GET per row; the outcome lands on the row
    (last_test_json/last_test_at_ms) and in the response. Network failures are
    outcomes, not raises.
    """
    requested = api_style_override or upstream.api_style
    try:
        ApiStyle(requested)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown api_style: {requested}"
        ) from None
    rows = _ensure_rows(session, upstream, secret_box)
    items: list[dict[str, Any]] = []
    for row in rows:
        api_key = _decrypt(secret_box, row.key_enc)
        status_code, _models, latency_ms = 0, [], 0
        error = ""
        try:
            status_code, _models, latency_ms = fetch_models(
                base_url=upstream.base_url,
                api_style=requested,
                api_key=api_key,
            )
            if not 200 <= status_code < 300:
                error = f"上游返回 HTTP {status_code}"
        except httpx.TimeoutException:
            latency_ms = int(PROBE_TIMEOUT_SECONDS * 1000)
            error = f"请求超时（{int(PROBE_TIMEOUT_SECONDS)} 秒）"
        except httpx.HTTPError as exc:
            error = f"连接失败：{exc}"
        items.append(
            {
                "key_id": row.id,
                "ok": 200 <= status_code < 300,
                "status_code": status_code,
                "latency_ms": latency_ms,
                "error": error,
            }
        )
        row.last_test_json = json.dumps(items[-1], ensure_ascii=False)
        row.last_test_at_ms = now_ms()
    session.flush()
    _audit(
        session,
        actor=actor,
        action="test_keys",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"ok": sum(1 for item in items if item["ok"]), "total": len(items)}),
    )
    return {"upstream_id": upstream.id, "api_style": requested, "items": items}


def _probe_url(base_url: str) -> str:
    trimmed = base_url.strip()
    if trimmed.endswith("#"):
        return trimmed[:-1]
    return trimmed.rstrip("/") + "/models"


def _auth_headers(api_style: str, api_key: str) -> dict[str, str]:
    if not api_key:
        return {}
    if api_style == ApiStyle.ANTHROPIC_MESSAGES:
        return {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    if api_style == ApiStyle.GEMINI:
        return {"x-goog-api-key": api_key}
    return {"Authorization": f"Bearer {api_key}"}


def _model_ids(payload: object) -> list[str]:
    found: list[str] = []
    if isinstance(payload, dict):
        data = payload.get("data")
        models = payload.get("models")
        entries = data if isinstance(data, list) else models if isinstance(models, list) else []
        for item in entries:
            name: object = item.get("id") or item.get("name") if isinstance(item, dict) else item
            if isinstance(name, str) and name.strip():
                found.append(name.strip().removeprefix("models/"))
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, str) and item.strip():
                found.append(item.strip())
    return sorted(set(found))


def fetch_models(
    *,
    base_url: str,
    api_style: str,
    api_key: str,
    timeout_s: float = PROBE_TIMEOUT_SECONDS,
) -> tuple[int, list[str], int]:
    """GET <base>/models; returns (http_status, model ids, latency_ms)."""
    started = time.perf_counter()
    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        response = client.get(_probe_url(base_url), headers=_auth_headers(api_style, api_key))
    latency_ms = int((time.perf_counter() - started) * 1000)
    try:
        payload: object = response.json()
    except ValueError:
        payload = None
    return response.status_code, _model_ids(payload), latency_ms


# --- ADR-023 #6 protocol auto-detection -------------------------------------


def _probe_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    json_body: dict | None = None,
    timeout_s: float = PROBE_TIMEOUT_SECONDS,
) -> tuple[int, object | None, int]:
    """One detection HTTP call; returns (http_status, decoded JSON or None, latency_ms)."""
    started = time.perf_counter()
    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        response = client.request(method, url, headers=headers, json=json_body)
    latency_ms = int((time.perf_counter() - started) * 1000)
    try:
        return response.status_code, response.json(), latency_ms
    except ValueError:
        return response.status_code, None, latency_ms


def _pinned_url(base_url: str) -> str | None:
    """A '#' suffix pins the models endpoint exactly (same convention as _probe_url)."""
    trimmed = base_url.strip()
    return trimmed[:-1] if trimmed.endswith("#") else None


def _models_urls(base_url: str, *, version: str = "v1") -> list[str]:
    """Candidate model-list URLs for one auth family.

    A base that already carries a version segment (…/v1, …/v1beta) gets /models
    appended; otherwise the protocol's canonical version path is tried first and
    the plain /models legacy layout second.
    """
    pinned = _pinned_url(base_url)
    if pinned is not None:
        return [pinned]
    trimmed = base_url.strip().rstrip("/")
    if re.fullmatch(r"v\d+[^/]*", trimmed.rsplit("/", 1)[-1]):
        return [trimmed + "/models"]
    return [f"{trimmed}/{version}/models", trimmed + "/models"]


def _endpoint_url(base_url: str, path: str) -> str:
    """Join a sub-path (responses) keeping an existing /vN segment if present."""
    trimmed = base_url.strip().rstrip("/")
    if re.fullmatch(r"v\d+[^/]*", trimmed.rsplit("/", 1)[-1]):
        return trimmed + "/" + path
    return trimmed + f"/v1/{path}"


def _miss_detail(status: int, payload: object, expected: str) -> str:
    if 200 <= status < 300:
        return f"HTTP {status} 但响应缺少 {expected} 数组"
    return f"HTTP {status}"


def _detection_failure_message(steps: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for protocol in DETECT_ORDER:
        attempts = [step for step in steps if step["protocol"] == protocol]
        if attempts:
            last = attempts[-1]
            detail = last["detail"] or f"HTTP {last['http_status']}"
            parts.append(f"{protocol}: {detail}")
        else:
            parts.append(f"{protocol}: 未尝试")
    return "四种协议均未命中，无法自动识别接口风格：" + "；".join(parts)


def _detection_message(result: dict[str, Any]) -> str:
    """Probe-row payload for an auto run: source + resolved style + every step.

    upstream_probes has no steps column (must not grow one), so the structured
    detection record lives in the free-text message field as JSON.
    """
    return json.dumps(
        {"source": "auto", "resolved": result["protocol"], "steps": result["steps"]},
        ensure_ascii=False,
    )


def detect_api_style(
    *, base_url: str, api_key: str, timeout_s: float = PROBE_TIMEOUT_SECONDS
) -> dict[str, Any]:
    """Probe an upstream in ADR-023 #6 order; first match wins, nothing raises.

    openai_chat: GET /v1/models with Bearer, 2xx plus a data array means the
    openai family; openai_responses is then disambiguated with one minimal POST
    /v1/responses (accepted -> responses, anything else -> chat). anthropic
    retries /models with x-api-key + anthropic-version; gemini tries /v1beta/
    models with x-goog-api-key (header keeps the key out of URLs). Every attempt
    is recorded with order, protocol, HTTP status and latency.
    """
    steps: list[dict[str, Any]] = []
    started = time.perf_counter()

    def record(
        protocol: str,
        method: str,
        url: str,
        *,
        ok: bool,
        detail: str = "",
        http_status: int = 0,
        latency_ms: int = 0,
    ) -> None:
        steps.append(
            {
                "order": len(steps) + 1,
                "protocol": str(protocol),
                "method": method,
                "url": url,
                "http_status": http_status,
                "latency_ms": latency_ms,
                "ok": ok,
                "detail": detail,
            }
        )

    def attempt(
        protocol: str,
        method: str,
        url: str,
        headers: dict[str, str],
        json_body: dict | None = None,
        expect: str | None = None,
    ) -> tuple[bool, object | None]:
        """Run one attempt and record it; network errors are outcomes, not raises.

        expect names the JSON key that must hold a list for a shape hit
        (data/models); None accepts any 2xx (used for the responses probe).
        """
        try:
            status, payload, latency_ms = _probe_request(
                method, url, headers=headers, json_body=json_body, timeout_s=timeout_s
            )
        except httpx.HTTPError as exc:
            record(protocol, method, url, ok=False, detail=f"连接失败：{exc}")
            return False, None
        shaped = expect is None or (
            isinstance(payload, dict) and isinstance(payload.get(expect), list)
        )
        ok = 200 <= status < 300 and shaped
        if ok:
            detail = ""
        elif 200 <= status < 300:
            detail = _miss_detail(status, payload, expect or "")
        else:
            detail = f"HTTP {status}"
        record(
            protocol,
            method,
            url,
            ok=ok,
            detail=detail,
            http_status=status,
            latency_ms=latency_ms,
        )
        return ok, payload

    bearer = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    # 1) openai family via /models with Bearer auth.
    for url in _models_urls(base_url):
        ok, payload = attempt(ApiStyle.OPENAI_CHAT, "GET", url, bearer, expect="data")
        if not ok:
            continue
        models_seen = _model_ids(payload)
        # 2) chat vs responses: one minimal /responses call decides.
        if _pinned_url(base_url) is not None:
            record(
                ApiStyle.OPENAI_RESPONSES,
                "POST",
                url,
                ok=False,
                detail="base_url 以 # 锁定了模型端点，无法探测 /responses，按 openai_chat 处理",
            )
            protocol = ApiStyle.OPENAI_CHAT
        else:
            responses_url = _endpoint_url(base_url, "responses")
            probe_body = {
                "model": models_seen[0] if models_seen else "gpt-4o-mini",
                "input": "ping",
                "max_output_tokens": RESPONSES_PROBE_MAX_TOKENS,
            }
            accepted, _ = attempt(
                ApiStyle.OPENAI_RESPONSES, "POST", responses_url, bearer, probe_body
            )
            if not accepted:
                steps[-1]["detail"] = (steps[-1]["detail"] or "失败") + "；按 openai_chat 处理"
            protocol = ApiStyle.OPENAI_RESPONSES if accepted else ApiStyle.OPENAI_CHAT
        return {
            "protocol": str(protocol),
            "steps": steps,
            "models": models_seen,
            "message": f"自动探测命中 {protocol}",
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

    # 3) anthropic messages via /models with x-api-key + anthropic-version.
    anthropic_headers = {"anthropic-version": _ANTHROPIC_VERSION}
    if api_key:
        anthropic_headers["x-api-key"] = api_key
    for url in _models_urls(base_url):
        ok, payload = attempt(
            ApiStyle.ANTHROPIC_MESSAGES, "GET", url, anthropic_headers, expect="data"
        )
        if ok:
            return {
                "protocol": str(ApiStyle.ANTHROPIC_MESSAGES),
                "steps": steps,
                "models": _model_ids(payload),
                "message": f"自动探测命中 {ApiStyle.ANTHROPIC_MESSAGES}",
                "latency_ms": int((time.perf_counter() - started) * 1000),
            }

    # 4) gemini via /v1beta/models with x-goog-api-key.
    gemini_headers = {"x-goog-api-key": api_key} if api_key else {}
    for url in _models_urls(base_url, version="v1beta"):
        ok, payload = attempt(ApiStyle.GEMINI, "GET", url, gemini_headers, expect="models")
        if ok:
            return {
                "protocol": str(ApiStyle.GEMINI),
                "steps": steps,
                "models": _model_ids(payload),
                "message": f"自动探测命中 {ApiStyle.GEMINI}",
                "latency_ms": int((time.perf_counter() - started) * 1000),
            }

    return {
        "protocol": None,
        "steps": steps,
        "models": [],
        "message": _detection_failure_message(steps),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


def _detection_row(
    *, upstream_id: str, kind: str, result: dict[str, Any]
) -> UpstreamProbeORM:
    """Probe row for one detection run; steps JSON rides in message (no new column)."""
    ok_steps = [step for step in result["steps"] if step["ok"]]
    return UpstreamProbeORM(
        id=new_id("upr"),
        upstream_id=upstream_id,
        kind=kind,
        status="ok" if result["protocol"] else "error",
        http_status=ok_steps[-1]["http_status"] if ok_steps else 0,
        latency_ms=result["latency_ms"],
        message=_detection_message(result),
        model_count=len(result["models"]),
        models_json=json.dumps(result["models"]),
        tested_at_ms=now_ms(),
    )


def resolve_auto_style(
    session: Session, *, upstream_id: str, base_url: str, api_key: str
) -> str:
    """Resolve api_style="auto" to a concrete style before anything is stored.

    Runs the detection sequence, records it as a probe row (kind="detect") and
    raises 422 with one failure line per protocol when nothing matched.
    """
    result = detect_api_style(base_url=base_url, api_key=api_key)
    UPSTREAM_PROBE_REPO.add(
        session, _detection_row(upstream_id=upstream_id, kind="detect", result=result)
    )
    session.flush()
    if result["protocol"] is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            result["message"],
            details={"protocol_source": "auto", "probe_steps": result["steps"]},
        )
    return result["protocol"]


def probe_source(session: Session, upstream_id: str, api_style: str) -> str:
    """How the current style was determined: the latest detection's verdict.

    "auto" only when the most recent probe row carries an auto-detection record
    that resolved to exactly the stored style; anything else reads as manual.
    """
    row = latest_probe(session, upstream_id)
    if row is None:
        return "manual"
    try:
        meta = json.loads(row.message)
    except ValueError:
        return "manual"
    if isinstance(meta, dict) and meta.get("source") == "auto":
        return "auto" if meta.get("resolved") == api_style else "manual"
    return "manual"


def probe_view(row: UpstreamProbeORM) -> dict[str, Any]:
    return {
        "id": row.id,
        "kind": row.kind,
        "status": row.status,
        "http_status": row.http_status,
        "latency_ms": row.latency_ms,
        "message": row.message,
        "model_count": row.model_count,
        "models": json.loads(row.models_json or "[]"),
        "tested_at_ms": row.tested_at_ms,
    }


def latest_probe(session: Session, upstream_id: str) -> UpstreamProbeORM | None:
    stmt = (
        select(UpstreamProbeORM)
        .where(UpstreamProbeORM.upstream_id == upstream_id)
        .order_by(UpstreamProbeORM.tested_at_ms.desc(), UpstreamProbeORM.id.desc())
        .limit(1)
    )
    return session.scalars(stmt).first()


def primary_key_plaintext(
    session: Session,
    upstream: UpstreamORM,
    *,
    secret_box: SecretBox,
    key_id: str | None = None,
) -> str:
    """The probe credential: the named key, else the first key row (ADR-026 ③:
    probing uses any one credential; there is no primary row anymore)."""
    rows = _ensure_rows(session, upstream, secret_box)
    if not rows:
        return ""
    selected = _resolve(rows, key_id) if key_id else rows[0]
    return _decrypt(secret_box, selected.key_enc)


def probe(
    session: Session,
    upstream: UpstreamORM,
    *,
    kind: str,
    key_id: str | None,
    secret_box: SecretBox,
    actor: str = "",
    api_style_override: str | None = None,
) -> dict[str, Any]:
    """Run one probe (kind test|discover) and append its record.

    api_style_override (request body) may be a concrete style for this call only,
    or "auto" to run the ADR-023 detection; nothing here ever persists "auto".
    The response adds protocol / protocol_source / probe_steps on top of the
    historical probe_view keys.
    """
    api_key = primary_key_plaintext(session, upstream, secret_box=secret_box, key_id=key_id)
    requested = api_style_override or upstream.api_style
    try:
        ApiStyle(requested)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown api_style: {requested}"
        ) from None
    if requested == ApiStyle.AUTO:
        result = detect_api_style(base_url=upstream.base_url, api_key=api_key)
        record = _detection_row(upstream_id=upstream.id, kind=kind, result=result)
        protocol, steps, source = result["protocol"], result["steps"], "auto"
        detection_message = result["message"]
    else:
        started = time.perf_counter()
        try:
            http_status, models, latency_ms = fetch_models(
                base_url=upstream.base_url,
                api_style=requested,
                api_key=api_key,
            )
            if 200 <= http_status < 300:
                status, message = "ok", ""
            else:
                status = "error"
                message = f"上游返回 HTTP {http_status}"
                if http_status == 401 and not api_key:
                    message += "（本次请求没有携带密钥）"
        except httpx.TimeoutException:
            http_status, models = 0, []
            latency_ms = int((time.perf_counter() - started) * 1000)
            status, message = "timeout", f"请求超时（{int(PROBE_TIMEOUT_SECONDS)} 秒）"
        except httpx.HTTPError as exc:
            http_status, models = 0, []
            latency_ms = int((time.perf_counter() - started) * 1000)
            status, message = "error", f"连接失败：{exc}"
        record = UpstreamProbeORM(
            id=new_id("upr"),
            upstream_id=upstream.id,
            kind=kind,
            status=status,
            http_status=http_status,
            latency_ms=latency_ms,
            message=message,
            model_count=len(models),
            models_json=json.dumps(models),
            tested_at_ms=now_ms(),
        )
        protocol, source = requested, "manual"
        steps = [
            {
                "order": 1,
                "protocol": requested,
                "method": "GET",
                "url": _probe_url(upstream.base_url),
                "http_status": http_status,
                "latency_ms": latency_ms,
                "ok": status == "ok",
                "detail": message,
            }
        ]
    UPSTREAM_PROBE_REPO.add(session, record)
    _audit(
        session,
        actor=actor,
        action="probe_" + kind,
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"status": record.status, "model_count": record.model_count}),
    )
    view = probe_view(record)
    view["protocol"] = protocol
    view["protocol_source"] = source
    view["probe_steps"] = steps
    if requested == ApiStyle.AUTO:
        # the row keeps the structured JSON (probe_source reads it back); the
        # response shows the human summary line instead of the blob
        view["message"] = detection_message
    return view


# --- ticket 05: model-level chat probe ---------------------------------------


def _probe_http_client(timeout_s: float) -> httpx.Client:
    """One short-lived HTTP client per model probe.

    Module level so tests can replace only the wire (MockTransport) while the
    URL/auth/body construction and sanitising run for real.
    """
    return httpx.Client(timeout=timeout_s, follow_redirects=True)


def _model_chat_url(base_url: str, api_style: str, model: str) -> str:
    """Chat endpoint for one stored style, keeping an existing /vN segment."""
    trimmed = base_url.strip()
    if trimmed.endswith("#"):
        # The '#' pin only marks the models endpoint; chat lives next to it.
        trimmed = trimmed[:-1]
    if api_style == ApiStyle.GEMINI:
        gemini_model = model.strip().removeprefix("models/")
        if re.fullmatch(r"v\d+[^/]*", trimmed.rstrip("/").rsplit("/", 1)[-1]):
            return trimmed.rstrip("/") + f"/models/{gemini_model}:generateContent"
        return trimmed.rstrip("/") + f"/v1beta/models/{gemini_model}:generateContent"
    paths = {
        ApiStyle.OPENAI_CHAT: "chat/completions",
        ApiStyle.OPENAI_RESPONSES: "responses",
        ApiStyle.ANTHROPIC_MESSAGES: "messages",
    }
    path = paths.get(ApiStyle(api_style))
    if path is None:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"api_style 不支持 chat 探测: {api_style}")
    return _endpoint_url(trimmed, path)


def _model_chat_body(api_style: str, model: str) -> dict[str, Any]:
    """The smallest chat payload each protocol accepts (max tokens = 16)."""
    if api_style == ApiStyle.OPENAI_RESPONSES:
        return {
            "model": model,
            "input": "ping",
            "max_output_tokens": MODEL_PROBE_MAX_TOKENS,
        }
    if api_style == ApiStyle.ANTHROPIC_MESSAGES:
        return {
            "model": model,
            "max_tokens": MODEL_PROBE_MAX_TOKENS,
            "messages": [{"role": "user", "content": "ping"}],
        }
    if api_style == ApiStyle.GEMINI:
        return {
            "contents": [{"parts": [{"text": "ping"}]}],
            "generationConfig": {"maxOutputTokens": MODEL_PROBE_MAX_TOKENS},
        }
    return {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": MODEL_PROBE_MAX_TOKENS,
        "stream": False,
    }


def _upstream_error_detail(response: httpx.Response) -> str:
    """Short upstream-reported reason for a failed probe (not redacted yet)."""
    payload: object = None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    detail = ""
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            detail = str(error.get("message") or error.get("code") or "")
        elif isinstance(error, str):
            detail = error
        if not detail:
            detail = str(payload.get("message") or payload.get("detail") or "")
    if not detail:
        detail = response.text or ""
    return " ".join(detail.split())[:1000]


_SECRET_PATTERNS = (
    re.compile(r"(?i)bearer\s+[a-z0-9._\-]+"),
    re.compile(r"sk-[A-Za-z0-9_\-]{6,}"),
)


def _redact_probe_message(message: str, api_key: str) -> str:
    """Top-and-tail the message: secrets out, one line, hard length cap."""
    redacted = message
    if api_key:
        redacted = redacted.replace(api_key, "***")
    redacted = _SECRET_PATTERNS[0].sub("Bearer ***", redacted)
    redacted = _SECRET_PATTERNS[1].sub("sk-***", redacted)
    redacted = " ".join(redacted.split())
    if len(redacted) > MODEL_PROBE_MESSAGE_LIMIT:
        redacted = redacted[: MODEL_PROBE_MESSAGE_LIMIT - 1] + "…"
    return redacted


def probe_model_chat(
    *,
    base_url: str,
    api_style: str,
    api_key: str,
    model: str,
    timeout_s: float = MODEL_PROBE_TIMEOUT_SECONDS,
) -> tuple[int, str, int]:
    """POST one minimal chat to a stored upstream; returns (status, detail, ms).

    Nothing raises on an upstream rejection: a non-2xx status comes back with a
    short reason the caller redacts. Network errors still raise so the caller
    can classify timeout vs connection failure.
    """
    url = _model_chat_url(base_url, api_style, model)
    headers = {**_auth_headers(api_style, api_key), "Content-Type": "application/json"}
    started = time.perf_counter()
    with _probe_http_client(timeout_s) as client:
        response = client.post(url, headers=headers, json=_model_chat_body(api_style, model))
    latency_ms = int((time.perf_counter() - started) * 1000)
    if 200 <= response.status_code < 300:
        return response.status_code, "", latency_ms
    return response.status_code, _upstream_error_detail(response), latency_ms


def _probe_key(
    session: Session, upstream: UpstreamORM, *, secret_box: SecretBox, key_id: str | None
) -> tuple[str, str]:
    """(plaintext, key row id) of the selected credential, else the first row."""
    rows = _ensure_rows(session, upstream, secret_box)
    selected = (_resolve(rows, key_id) if key_id else rows[0] if rows else None)
    if selected is None:
        return "", ""
    return _decrypt(secret_box, selected.key_enc), selected.id


def probe_models(
    session: Session,
    upstream: UpstreamORM,
    *,
    model_ids: list[str],
    key_id: str | None,
    secret_box: SecretBox,
) -> dict[str, Any]:
    """Serial minimal-chat probe of this upstream's stored models (ticket 05).

    Only rows that already belong to this upstream are accepted - the request
    can never name a base URL, style or credential beyond a stored key id, so
    the endpoint cannot be turned into an SSRF/probing proxy. Results are
    returned once and never persisted (no probe row, no last_test, no audit).
    """
    requested: list[str] = []
    for raw in model_ids:
        value = (raw or "").strip()
        if value and value not in requested:
            requested.append(value)
    if not requested:
        raise AppError(ErrorCode.VALIDATION_ERROR, "model_ids 不能为空")
    try:
        api_style = ApiStyle(upstream.api_style)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown api_style: {upstream.api_style}"
        ) from None
    if api_style == ApiStyle.AUTO:
        raise AppError(ErrorCode.VALIDATION_ERROR, "api_style 尚未解析（auto），无法探测")

    rows = {
        row.id: row
        for row in session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.id.in_(requested))
        ).all()
    }
    unknown = [model_id for model_id in requested if model_id not in rows]
    foreign = [
        model_id
        for model_id in requested
        if model_id in rows and rows[model_id].upstream_id != upstream.id
    ]
    if unknown or foreign:
        details: dict[str, Any] = {}
        if unknown:
            details["unknown_model_ids"] = unknown
        if foreign:
            details["foreign_model_ids"] = foreign
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "只能探测该上游已存在的模型",
            details=details,
        )

    api_key, selected_key_id = _probe_key(
        session, upstream, secret_box=secret_box, key_id=key_id
    )
    items: list[dict[str, Any]] = []
    for model_id in requested:
        row = rows[model_id]
        started = time.perf_counter()
        status, detail, latency_ms = 0, "", 0
        try:
            status, detail, latency_ms = probe_model_chat(
                base_url=upstream.base_url,
                api_style=upstream.api_style,
                api_key=api_key,
                model=row.name,
            )
            if 200 <= status < 300:
                ok, error_type, message = True, "", ""
            else:
                ok, error_type = False, "http"
                message = f"上游返回 HTTP {status}"
                if detail:
                    message += f"：{detail}"
                if status == 401 and not api_key:
                    message += "（本次请求没有携带密钥）"
        except httpx.TimeoutException:
            ok, error_type, status = False, "timeout", 0
            latency_ms = int((time.perf_counter() - started) * 1000)
            message = f"请求超时（{int(MODEL_PROBE_TIMEOUT_SECONDS)} 秒）"
        except httpx.HTTPError as exc:
            ok, error_type, status = False, "connection", 0
            latency_ms = int((time.perf_counter() - started) * 1000)
            message = f"连接失败：{exc}"
        items.append(
            {
                "model_id": row.id,
                "model": row.name,
                "ok": ok,
                "status": status,
                "latency_ms": latency_ms,
                "error_type": error_type,
                "message": _redact_probe_message(message, api_key),
            }
        )
    return {"upstream_id": upstream.id, "key_id": selected_key_id, "items": items}


def import_models(
    session: Session,
    upstream: UpstreamORM,
    *,
    names: list[str],
    model_type: str,
    actor: str = "",
) -> dict[str, list[Any]]:
    try:
        ModelType(model_type)
    except ValueError:
        raise AppError(
            ErrorCode.VALIDATION_ERROR, f"unknown model_type: {model_type}"
        ) from None
    existing = {
        row.name
        for row in session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.upstream_id == upstream.id)
        ).all()
    }
    created: list[str] = []
    skipped: list[str] = []
    errors: list[dict[str, str]] = []
    for raw in names:
        name = (raw or "").strip()
        if not name:
            continue
        if len(name) > 255:
            errors.append({"name": name, "message": "模型名超过 255 字符"})
            continue
        if name in existing:
            skipped.append(name)
            continue
        UPSTREAM_MODEL_REPO.add(
            session,
            UpstreamModelORM(
                id=new_id("umdl"),
                upstream_id=upstream.id,
                name=name,
                model_type=model_type,
                created_at_ms=now_ms(),
            ),
        )
        existing.add(name)
        created.append(name)
    _audit(
        session,
        actor=actor,
        action="import_models",
        entity_type="upstream",
        entity_id=upstream.id,
        detail_json=json.dumps({"created": len(created), "skipped": len(skipped)}),
    )
    return {"created": created, "skipped": skipped, "errors": errors}


def delete_upstream(session: Session, upstream_id: str, *, actor: str = "") -> None:
    """Delete an upstream unless a public model target references one of its models."""
    upstream = _upstream(session, upstream_id)
    models = list(
        session.scalars(
            select(UpstreamModelORM).where(UpstreamModelORM.upstream_id == upstream.id)
        ).all()
    )
    model_ids = [model.id for model in models]
    references: list[ModelTargetORM] = []
    if model_ids:
        references = list(
            session.scalars(
                select(ModelTargetORM).where(ModelTargetORM.upstream_model_id.in_(model_ids))
            ).all()
        )
    if references:
        referenced = {ref.upstream_model_id for ref in references}
        names = sorted(model.name for model in models if model.id in referenced)
        raise AppError(
            ErrorCode.CONFLICT,
            "上游模型仍被公开模型引用，不能删除",
            details={"models": names, "target_count": len(references)},
        )
    for row in _key_rows(session, upstream.id):
        UPSTREAM_KEY_REPO.delete(session, row)
    for probe_row in session.scalars(
        select(UpstreamProbeORM).where(UpstreamProbeORM.upstream_id == upstream.id)
    ).all():
        UPSTREAM_PROBE_REPO.delete(session, probe_row)
    for model in models:
        UPSTREAM_MODEL_REPO.delete(session, model)
    UPSTREAM_REPO.delete(session, upstream)
    session.flush()
    _audit(session, actor=actor, action="delete", entity_type="upstream", entity_id=upstream_id)


def batch_upstreams(
    session: Session, *, ids: list[str], action: str, actor: str = ""
) -> dict[str, Any]:
    """Enable/disable/delete each id; a referenced delete fails alone, never aborts."""
    changed: list[str] = []
    missing: list[str] = []
    failed: list[dict[str, str]] = []
    seen: set[str] = set()
    for upstream_id in ids:
        if upstream_id in seen:
            continue
        seen.add(upstream_id)
        upstream = UPSTREAM_REPO.get(session, upstream_id)
        if upstream is None:
            missing.append(upstream_id)
            continue
        if action == "delete":
            try:
                delete_upstream(session, upstream_id, actor=actor)
            except AppError as exc:
                failed.append(
                    {"id": upstream_id, "code": exc.code.value, "message": exc.message}
                )
                continue
        else:
            upstream.enabled = action == "enable"
            _audit(
                session,
                actor=actor,
                action=action,
                entity_type="upstream",
                entity_id=upstream.id,
            )
        changed.append(upstream_id)
    session.flush()
    return {"changed": changed, "missing": missing, "failed": failed, "action": action}
