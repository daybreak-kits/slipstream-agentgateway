"""ADR-021 request-body payload reader: GET /admin/logs/{event_id}/payload.

Isolated router (own file, registered in app.ALL_ROUTERS) so the logs-query
owner's routers stay untouched. Reads the data-plane SQLite's
request_log_payloads through l03_adapters.agentgateway.usage (read-only,
schema-checked); no row or no payload store answers 404. The response goes
through field_filter.sanitize so money keys can never leak from raw bodies.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from l01_core.errors import AppError, ErrorCode
from l01_core.settings import get_settings
from l03_adapters.agentgateway.usage import fetch_request_payload, open_readonly
from l05_service import auth
from l06_api import field_filter
from l06_api.deps import require

router = APIRouter(tags=["logs-payload"])


@router.get("/admin/logs/{event_id}/payload")
def log_payload(
    event_id: str,
    principal: auth.Principal = Depends(require("logs:read")),
) -> dict:
    """Stored prompt/completion bodies for one request log (only when full mode)."""
    settings = get_settings()
    conn = open_readonly(settings.ag_log_db_path)
    try:
        payload = fetch_request_payload(conn, event_id)
    finally:
        conn.close()
    if payload is None:
        raise AppError(ErrorCode.NOT_FOUND, f"该事件没有正文日志: {event_id}")
    return field_filter.sanitize(payload, principal.permissions)
