"""ADR-021 request-body payload reader: GET /admin/logs/{event_id}/payload.

Isolated router (own file, registered in app.ALL_ROUTERS) so the logs-query
owner's routers stay untouched. Bodies live in the adapter's own store; the
router only calls the SPI ``read_log_payload`` port (docs/SYSTEM-BOUNDARY.md,
W6 ticket 02): no row or no payload store answers 404. The response goes
through field_filter.sanitize so money keys can never leak from raw bodies.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from l01_core.errors import AppError, ErrorCode
from l03_adapters.spi import DataPlaneAdapter
from l05_service import auth
from l06_api import field_filter
from l06_api.deps import get_adapter, require

router = APIRouter(tags=["logs-payload"])


@router.get("/admin/logs/{event_id}/payload")
def log_payload(
    event_id: str,
    principal: auth.Principal = Depends(require("logs:read")),
    adapter: DataPlaneAdapter = Depends(get_adapter),
) -> dict:
    """Stored prompt/completion bodies for one request log (only when full mode)."""
    payload = adapter.read_log_payload(event_id)
    if payload is None:
        raise AppError(ErrorCode.NOT_FOUND, f"该事件没有正文日志: {event_id}")
    return field_filter.sanitize(payload.as_dict(), principal.permissions)
