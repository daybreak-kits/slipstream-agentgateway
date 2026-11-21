"""Control-plane health endpoint.

ADR-029 (ticket 04): the data-plane port fact comes from the adapter's client
contract, not from system settings — the system layer never spells a data-plane
wire field itself.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from l01_core.settings import get_settings
from l01_core.timeutil import now_ms
from l02_domain.ir import IR_VERSION
from l03_adapters.spi import DataPlaneAdapter
from l06_api.deps import get_adapter

router = APIRouter(tags=["health"])


@router.get("/admin/health")
def health(adapter: DataPlaneAdapter = Depends(get_adapter)) -> dict:
    settings = get_settings()
    # The legacy wire field (byte-stable for the console) is adapter-owned: the
    # contract supplies both key and value, so no system code hardcodes a port.
    return {
        "status": "ok",
        "ir_version": IR_VERSION,
        "adapter": settings.data_plane_adapter,
        **adapter.client_contract().health_fields(),
        "now_ms": now_ms(),
    }
