"""Upstream CRUD plus keys, probes, model discovery and transforms (ticket 09)."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from l01_core.crypto import SecretBox
from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l02_domain.transforms_codec import parse_transforms, transforms_to_json
from l03_adapters.spi import DataPlaneAdapter
from l04_repo.orm import UpstreamModelORM, UpstreamORM
from l04_repo.repository import UPSTREAM_REPO
from l05_service import crud, upstream_ops
from l06_api.deps import get_adapter, page_params, require, session_of
from l06_api.schemas import (
    UpstreamBatch,
    UpstreamCreate,
    UpstreamImportModels,
    UpstreamKeyBatchDelete,
    UpstreamKeyCreate,
    UpstreamKeyPatch,
    UpstreamKeyTestIn,
    UpstreamModelProbeIn,
    UpstreamPatch,
    UpstreamProbeIn,
)

router = APIRouter(prefix="/admin/upstreams", tags=["upstreams"])


def _secret_box() -> SecretBox:
    return SecretBox(get_settings().secret_key)


def _probe_summary(row) -> dict | None:
    if row is None:
        return None
    return {
        "kind": row.kind,
        "status": row.status,
        "http_status": row.http_status,
        "latency_ms": row.latency_ms,
        "model_count": row.model_count,
        "tested_at_ms": row.tested_at_ms,
    }


def _body(session: Session, upstream: UpstreamORM) -> dict:
    probe = upstream_ops.latest_probe(session, upstream.id)
    # ADR-026: keys are rows now. key_count only counts upstream_keys rows, so
    # an un-migrated legacy database reports 0 and the console prompts for the
    # migration instead of pretending the retired mirror is a live key.
    key_count = upstream_ops.key_count(session, upstream)
    model_count = session.scalar(
        select(func.count())
        .select_from(UpstreamModelORM)
        .where(UpstreamModelORM.upstream_id == upstream.id)
    )
    return {
        "id": upstream.id,
        "vendor_id": upstream.vendor_id,
        "name": upstream.name,
        "base_url": upstream.base_url,
        "api_style": upstream.api_style,
        "api_style_source": upstream_ops.probe_source(session, upstream.id, upstream.api_style),
        "transforms": (
            json.loads(upstream.transforms_json) if upstream.transforms_json else None
        ),
        "max_buffer_bytes": upstream.max_buffer_bytes,
        "has_api_key": key_count > 0,
        "enabled": upstream.enabled,
        "created_at_ms": upstream.created_at_ms,
        "key_count": key_count,
        "model_count": int(model_count or 0),
        "last_probe": _probe_summary(probe),
    }


def _load(session: Session, upstream_id: str) -> UpstreamORM:
    upstream = UPSTREAM_REPO.get(session, upstream_id)
    if upstream is None:
        raise AppError(ErrorCode.NOT_FOUND, f"upstream not found: {upstream_id}")
    return upstream


@router.post("", status_code=201, dependencies=[Depends(require("upstreams:write"))])
def create_upstream(payload: UpstreamCreate, session: Session = Depends(session_of)) -> dict:
    upstream = crud.create_upstream(
        session,
        vendor_id=payload.vendor_id,
        base_url=payload.base_url,
        api_style=payload.api_style,
        api_key=payload.api_key,
        secret_box=_secret_box(),
        name=payload.name,
        transforms=payload.transforms,
        max_buffer_bytes=payload.max_buffer_bytes,
    )
    session.commit()
    return _body(session, upstream)


@router.get("", dependencies=[Depends(require("upstreams:read"))])
def list_upstreams(
    session: Session = Depends(session_of), page_size: int = 50, offset: int = 0
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    return [
        _body(session, upstream)
        for upstream in UPSTREAM_REPO.list_all(session, limit=limit, offset=off)
    ]


@router.get(
    "/{upstream_id}/keys",
    dependencies=[Depends(require("upstreams:read"))],
)
def list_keys(upstream_id: str, session: Session = Depends(session_of)) -> dict:
    upstream = _load(session, upstream_id)
    return {
        "items": upstream_ops.list_keys(session, upstream),
        "limit": upstream_ops.MAX_UPSTREAM_KEYS,
    }


@router.post(
    "/{upstream_id}/keys",
    status_code=201,
    dependencies=[Depends(require("upstreams:write"))],
)
def add_key(
    upstream_id: str,
    payload: UpstreamKeyCreate,
    session: Session = Depends(session_of),
) -> dict:
    upstream = _load(session, upstream_id)
    row = upstream_ops.add_key(
        session,
        upstream,
        label=payload.label,
        api_key=payload.api_key,
        secret_box=_secret_box(),
    )
    session.commit()
    return upstream_ops.key_view(row)


@router.post(
    "/{upstream_id}/keys/batch-delete",
    dependencies=[Depends(require("upstreams:write"))],
)
def batch_delete_keys(
    upstream_id: str,
    payload: UpstreamKeyBatchDelete,
    session: Session = Depends(session_of),
) -> dict:
    """ADR-026 ②: keys are equal peers, so removal is per-key with a report."""
    upstream = _load(session, upstream_id)
    result = upstream_ops.batch_delete_keys(
        session, upstream, ids=payload.ids, secret_box=_secret_box()
    )
    session.commit()
    return {"upstream_id": upstream_id, **result}


@router.post(
    "/{upstream_id}/keys/test",
    dependencies=[Depends(require("upstreams:write"))],
)
def test_keys(
    upstream_id: str,
    payload: UpstreamKeyTestIn | None = None,
    session: Session = Depends(session_of),
) -> dict:
    """ADR-026 ③: one minimal authenticated request per key row.

    Outcomes land on each row (last_test_json / last_test_at_ms) and are
    returned in request order; network failures are outcomes, not raises.
    """
    upstream = _load(session, upstream_id)
    result = upstream_ops.test_keys(
        session,
        upstream,
        secret_box=_secret_box(),
        api_style_override=payload.api_style if payload else None,
    )
    session.commit()
    return result


@router.patch(
    "/{upstream_id}/keys/{key_id}",
    dependencies=[Depends(require("upstreams:write"))],
)
def patch_key(
    upstream_id: str,
    key_id: str,
    payload: UpstreamKeyPatch,
    session: Session = Depends(session_of),
) -> dict:
    upstream = _load(session, upstream_id)
    fields = payload.model_dump(exclude_none=True)
    row = upstream_ops.update_key(
        session,
        upstream,
        key_id,
        label=fields.get("label"),
        secret_box=_secret_box(),
    )
    session.commit()
    return upstream_ops.key_view(row)


@router.delete(
    "/{upstream_id}/keys/{key_id}",
    dependencies=[Depends(require("upstreams:write"))],
)
def delete_key(
    upstream_id: str, key_id: str, session: Session = Depends(session_of)
) -> dict:
    upstream = _load(session, upstream_id)
    upstream_ops.delete_key(
        session, upstream, key_id, secret_box=_secret_box()
    )
    session.commit()
    return {"deleted": key_id}


@router.post(
    "/{upstream_id}/test-connection",
    dependencies=[Depends(require("upstreams:write"))],
)
def test_connection(
    upstream_id: str,
    payload: UpstreamProbeIn | None = None,
    session: Session = Depends(session_of),
) -> dict:
    upstream = _load(session, upstream_id)
    key_id = payload.key_id if payload else None
    result = upstream_ops.probe(
        session,
        upstream,
        kind="test",
        key_id=key_id,
        secret_box=_secret_box(),
        api_style_override=payload.api_style if payload else None,
    )
    session.commit()
    return {"upstream_id": upstream_id, **result}


@router.post(
    "/{upstream_id}/discover-models",
    dependencies=[Depends(require("upstreams:write"))],
)
def discover_models(
    upstream_id: str,
    payload: UpstreamProbeIn | None = None,
    session: Session = Depends(session_of),
) -> dict:
    upstream = _load(session, upstream_id)
    key_id = payload.key_id if payload else None
    result = upstream_ops.probe(
        session,
        upstream,
        kind="discover",
        key_id=key_id,
        secret_box=_secret_box(),
        api_style_override=payload.api_style if payload else None,
    )
    session.commit()
    return {"upstream_id": upstream_id, **result}


@router.post(
    "/{upstream_id}/import-models",
    dependencies=[Depends(require("upstreams:write"))],
)
def import_models(
    upstream_id: str,
    payload: UpstreamImportModels,
    session: Session = Depends(session_of),
) -> dict:
    upstream = _load(session, upstream_id)
    result = upstream_ops.import_models(
        session,
        upstream,
        names=payload.names,
        model_type=payload.model_type,
    )
    session.commit()
    return {"upstream_id": upstream_id, **result}


@router.post(
    "/{upstream_id}/models/probe",
    dependencies=[Depends(require("upstream_models:write"))],
)
def probe_models(
    upstream_id: str,
    payload: UpstreamModelProbeIn,
    session: Session = Depends(session_of),
) -> dict:
    """Probe this upstream's stored models with one minimal chat each (ticket 05).

    Serial by design (the console shows progress model by model), 20s per model,
    results returned for this call only - no probe row, key test or model row is
    written. model_write is upstream_models:write in the permission registry.
    """
    upstream = _load(session, upstream_id)
    model_ids = list(payload.model_ids)
    if payload.model_id:
        model_ids.insert(0, payload.model_id)
    return upstream_ops.probe_models(
        session,
        upstream,
        model_ids=model_ids,
        key_id=payload.key_id,
        secret_box=_secret_box(),
    )


@router.patch("/batch", dependencies=[Depends(require("upstreams:write"))])
def batch_upstreams(payload: UpstreamBatch, session: Session = Depends(session_of)) -> dict:
    """Declared before PATCH /{upstream_id} so "batch" is never read as an id."""
    result = upstream_ops.batch_upstreams(
        session, ids=payload.ids, action=payload.action
    )
    session.commit()
    return result


@router.delete(
    "/{upstream_id}",
    dependencies=[Depends(require("upstreams:write"))],
)
def delete_upstream(upstream_id: str, session: Session = Depends(session_of)) -> dict:
    upstream_ops.delete_upstream(session, upstream_id)
    session.commit()
    return {"deleted": upstream_id}


@router.get("/{upstream_id}", dependencies=[Depends(require("upstreams:read"))])
def get_upstream(upstream_id: str, session: Session = Depends(session_of)) -> dict:
    return _body(session, _load(session, upstream_id))


@router.patch("/{upstream_id}", dependencies=[Depends(require("upstreams:write"))])
def patch_upstream(
    upstream_id: str, payload: UpstreamPatch, session: Session = Depends(session_of)
) -> dict:
    fields = payload.model_dump(exclude_none=True)
    if "name" in fields:
        # ADR-023 #6 改名路径: an explicit non-blank name wins (duplicates are a
        # 422 like every other entity); blank/absent leaves the name untouched.
        # The host:port auto-name is a create-time fallback only, so a renamed
        # upstream never gets re-derived when base_url changes later.
        name = (fields.pop("name") or "").strip()
        if name and name != _load(session, upstream_id).name:
            crud.ensure_unique_name(session, UpstreamORM, name)
            fields["name"] = name
    crud.update_upstream(session, upstream_id, fields=fields, secret_box=_secret_box())
    session.commit()
    return _body(session, _load(session, upstream_id))


@router.get(
    "/{upstream_id}/transforms",
    dependencies=[Depends(require("transforms:read"))],
)
def get_transforms(upstream_id: str, session: Session = Depends(session_of)) -> dict:
    upstream = _load(session, upstream_id)
    if not upstream.transforms_json:
        return {"upstream_id": upstream_id, "transforms": None}
    return {"upstream_id": upstream_id, "transforms": json.loads(upstream.transforms_json)}


@router.put(
    "/{upstream_id}/transforms",
    dependencies=[Depends(require("transforms:write"))],
)
def put_transforms(
    upstream_id: str, payload: dict, session: Session = Depends(session_of)
) -> dict:
    """Store structured rewrite rules; protected headers and bad ordering reject loudly."""
    spec = parse_transforms(payload)
    canonical = crud.set_upstream_transforms(
        session, upstream_id, transforms=payload or None
    )
    session.commit()
    return {
        "upstream_id": upstream_id,
        "stored": canonical,
        "parsed": transforms_to_json(spec),
    }


@router.post(
    "/{upstream_id}/transforms/preview",
    dependencies=[Depends(require("transforms:read"))],
)
def preview_transforms(
    upstream_id: str, payload: dict, adapter: DataPlaneAdapter = Depends(get_adapter)
) -> dict:
    """Compile in memory via the adapter port: before/after plus skip reasons and
    E9 notes (no store). The concrete compiler is adapter-private."""
    spec = parse_transforms(payload)
    preview = adapter.preview_transforms(spec)
    return {
        "upstream_id": upstream_id,
        "before": payload,
        "after": preview.after,
        "skipped": list(preview.skipped),
        "notes": list(preview.notes),
    }
