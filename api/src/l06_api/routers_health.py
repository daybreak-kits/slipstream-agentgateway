"""Control-plane health endpoint."""

from __future__ import annotations

from fastapi import APIRouter

from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l02_domain.ir import IR_VERSION

router = APIRouter(tags=["health"])


@router.get("/admin/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "ir_version": IR_VERSION,
        "adapter": settings.data_plane_adapter,
        "data_plane_port": settings.ag_llm_port,
        "now_ms": now_ms(),
    }
