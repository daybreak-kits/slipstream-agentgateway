"""ADR-020 price JSON one-click export/import: GET /admin/prices/export, POST /admin/prices/import.

Isolated router so the billing-router owner stays untouched. Both endpoints read
and write the upstream-model rows (ADR-020 authority); the legacy versioned
books are history only. v1 does NOT include cache prices - those keep being
edited through the existing /admin/prices/upstream versioned endpoint, and the
export marks that scope in meta.cache_prices.

Permissions reuse the upstream-model registry keys (no new permission keys):
export = upstream_models:read, import = upstream_models:write. Cost fields in
the export response are still removed by the central money filter for callers
without billing:cost (docs §0.5).

The import body is validated via PriceImportIn.model_validate instead of a
typed signature parameter: a request model referenced by FastAPI would land in
components.schemas and make the committed web/src/generated/contract.ts stale,
and web/ is owned by another worker in this phase. The import is all-or-
nothing: the service raises per-line 422s before any write, and the session is
committed only after a fully valid batch.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends
from pydantic import ValidationError
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l05_service import pricing
from l06_api.deps import require, session_of
from l06_api.schemas import PriceImportIn

router = APIRouter(tags=["pricing-io"])


@router.get("/admin/prices/export", dependencies=[Depends(require("upstream_models:read"))])
def export_prices(session: Session = Depends(session_of)) -> dict:
    """Current effective prices of every upstream model as one editable JSON file."""
    return pricing.export_model_prices(session)


@router.post(
    "/admin/prices/import",
    dependencies=[Depends(require("upstream_models:write"))],
)
def import_prices(payload: dict = Body(...), session: Session = Depends(session_of)) -> dict:
    """Bulk-edit prices from an exported file; rejected batches change nothing."""
    try:
        body = PriceImportIn.model_validate(payload)
    except ValidationError as exc:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "价目导入请求格式不正确",
            # include_context: ctx may hold the raw ValueError, which json cannot encode.
            details={"errors": exc.errors(include_url=False, include_context=False)},
        ) from None
    result = pricing.import_model_prices(
        session, [row.model_dump() for row in body.upstream_models]
    )
    session.commit()
    return result
