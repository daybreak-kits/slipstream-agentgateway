"""Role and permission-matrix routes (ticket 03).

The matrix is registry-driven: GET /admin/permissions renders rbac.PERMISSIONS
so the SPA never hardcodes a permission list. Roles are stored in admin_roles;
assignment happens through /admin/admins, which validates the role key.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from l05_service import rbac, roles
from l06_api.deps import require, session_of

router = APIRouter(tags=["roles"])


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=255)
    permissions: list[str] = Field(default_factory=list)
    key: str | None = Field(default=None, min_length=3, max_length=32)


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    permissions: list[str] | None = None


@router.get("/admin/permissions", dependencies=[Depends(require("roles:read"))])
def list_permissions() -> dict:
    """Full permission registry grouped for the matrix UI."""
    groups = []
    for group in rbac.PERMISSION_GROUPS:
        entries = [
            {
                "key": permission.key,
                "label": permission.label,
                "description": permission.description,
            }
            for permission in rbac.PERMISSIONS
            if permission.group == group
        ]
        if entries:
            groups.append({"group": group, "permissions": entries})
    return {"groups": groups, "keys": [permission.key for permission in rbac.PERMISSIONS]}


@router.get("/admin/roles", dependencies=[Depends(require("roles:read"))])
def list_roles(session: Session = Depends(session_of)) -> dict:
    items = roles.list_roles(session)
    return {"items": items, "total": len(items)}


@router.post(
    "/admin/roles", status_code=201, dependencies=[Depends(require("roles:write"))]
)
def create_role(payload: RoleCreate, session: Session = Depends(session_of)) -> dict:
    return roles.create_role(
        session,
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions,
        key=payload.key,
    )


@router.patch("/admin/roles/{role_id}", dependencies=[Depends(require("roles:write"))])
def patch_role(
    role_id: str, payload: RolePatch, session: Session = Depends(session_of)
) -> dict:
    return roles.update_role(
        session,
        role_id,
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions,
    )


@router.delete(
    "/admin/roles/{role_id}",
    status_code=204,
    dependencies=[Depends(require("roles:write"))],
)
def delete_role(role_id: str, session: Session = Depends(session_of)) -> None:
    roles.delete_role(session, role_id)
