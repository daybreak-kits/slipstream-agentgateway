"""Routing-chain trace query: GET /admin/traces/{trace_id} (M5-a).

Span data arrives out-of-band through the resident OTLP receiver, so a trace id
present on a request log may have no stored spans yet (or the export may have
failed). That is not an error page: the console expects 404/null and simply omits
the routing-chain section (M5-b). Permission is the same logs:read gate as the
request-log pages.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l05_service import auth
from l05_service.traces import get_trace_detail
from l06_api.deps import require, session_of
from l06_api.schemas import TraceDetailOut

router = APIRouter(tags=["traces"])


@router.get("/admin/traces/{trace_id}", response_model=TraceDetailOut)
def trace_detail(
    trace_id: str,
    session: Session = Depends(session_of),
    principal: auth.Principal = Depends(require("logs:read")),
) -> TraceDetailOut:
    """Stored span tree plus attempts reordered by client-span start time (E19)."""
    detail = get_trace_detail(session, trace_id)
    if detail is None:
        raise AppError(ErrorCode.NOT_FOUND, f"trace not found: {trace_id}")
    return TraceDetailOut(**detail)
