"""Vendor CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l04_repo.orm import VendorORM
from l04_repo.repository import VENDOR_REPO
from l05_service import crud
from l06_api.deps import page_params, require, session_of
from l06_api.schemas import VendorCreate, VendorPatch

router = APIRouter(prefix="/admin/vendors", tags=["vendors"])


def _body(vendor: VendorORM) -> dict:
    return {
        "id": vendor.id,
        "name": vendor.name,
        "slug": vendor.slug,
        "note": vendor.note,
        "upstream_seq": vendor.upstream_seq,
        "created_at_ms": vendor.created_at_ms,
    }


@router.post("", status_code=201, dependencies=[Depends(require("vendors:write"))])
def create_vendor(payload: VendorCreate, session: Session = Depends(session_of)) -> dict:
    vendor = crud.create_vendor(
        session, name=payload.name, slug=payload.slug, note=payload.note
    )
    session.commit()
    return _body(vendor)


@router.get("", dependencies=[Depends(require("vendors:read"))])
def list_vendors(
    session: Session = Depends(session_of), page_size: int = 50, offset: int = 0
) -> list[dict]:
    limit, off = page_params(page_size, offset)
    return [_body(v) for v in VENDOR_REPO.list_all(session, limit=limit, offset=off)]


@router.patch("/{vendor_id}", dependencies=[Depends(require("vendors:write"))])
def patch_vendor(
    vendor_id: str, payload: VendorPatch, session: Session = Depends(session_of)
) -> dict:
    vendor = VENDOR_REPO.get(session, vendor_id)
    if vendor is None:
        raise AppError(ErrorCode.NOT_FOUND, f"vendor not found: {vendor_id}")
    VENDOR_REPO.set_fields(vendor, payload.model_dump(exclude_none=True))
    session.commit()
    return _body(vendor)


@router.delete(
    "/{vendor_id}", status_code=204, dependencies=[Depends(require("vendors:write"))]
)
def delete_vendor(vendor_id: str, session: Session = Depends(session_of)) -> None:
    vendor = VENDOR_REPO.get(session, vendor_id)
    if vendor is None:
        raise AppError(ErrorCode.NOT_FOUND, f"vendor not found: {vendor_id}")
    VENDOR_REPO.delete(session, vendor)
    session.commit()
