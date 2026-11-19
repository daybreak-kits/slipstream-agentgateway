"""User-facing model exposure (W4-H): GET /admin/my/models.

Every logged-in console user may read the parameter block of every ENABLED
public model (逐用户可见 = 所有启用中的公开模型): name, type, merged capability
parameters and the upstream member names that produced them. This is the
playground / 我的 data source.

Deliberately NOT here: any cost, markup or price key. The money filter strips
known money keys for principals without billing:cost, but this endpoint simply
never emits them — defense in depth instead of one more filtered projection.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from l05_service.models_dev import user_model_parameters
from l06_api.deps import current_principal, session_of
from l06_api.schemas import MyModelOut

router = APIRouter(tags=["my"])


@router.get("/admin/my/models", response_model=list[MyModelOut])
def my_models(
    session: Session = Depends(session_of),
    principal=Depends(current_principal),
) -> list[dict]:
    """Enabled public models with their merged member parameters; login only."""
    return user_model_parameters(session)
