"""Permission registry and built-in roles for the console (ticket 03).

A permission key is "resource:action" ("users:read", "billing:cost"). The
registry below is the single source of truth: role payloads are validated
against it, "GET /admin/permissions" renders it, and the "require(...)"
dependencies in l06_api reference these exact strings.

Roles are rows, not code: "admin_roles" stores key/name/permission list and
"users.role" stores the key. The three built-in roles are seeded on startup and
can never be deleted. Authorization checks always test a permission, never a
role name, so a custom role behaves like a built-in one with the same grant set.
W6 ticket 21 retired the old user/agent keys (and the owner/operator/viewer
input aliases): migration is a database script, never an in-code alias.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from l01_core.errors import AppError, ErrorCode


@dataclass(frozen=True)
class Permission:
    """One "resource:action" capability shown in the permission matrix."""

    key: str
    label: str
    group: str
    description: str = ""


# Group order used by the console permission matrix.
PERMISSION_GROUPS: tuple[str, ...] = (
    "主数据",
    "流量治理",
    "治理",
    "计费",
    "用量",
    "账号",
    "模型试验",
)


PERMISSIONS: tuple[Permission, ...] = (
    # 主数据
    Permission("upstreams:read", "查看上游渠道", "主数据"),
    Permission("upstreams:write", "维护上游渠道", "主数据"),
    Permission("upstream_models:read", "查看上游模型", "主数据"),
    Permission("upstream_models:write", "维护上游模型", "主数据"),
    Permission("public_models:read", "查看公开模型", "主数据"),
    Permission("public_models:write", "维护公开模型", "主数据"),
    Permission("model_targets:read", "查看模型路由", "主数据"),
    Permission("model_targets:write", "维护模型路由", "主数据"),
    # 流量治理
    Permission("availability:read", "查看可用性规则", "流量治理"),
    Permission("availability:write", "维护可用性规则", "流量治理"),
    Permission("transforms:read", "查看流量变换", "流量治理"),
    Permission("transforms:write", "维护流量变换", "流量治理"),
    # 治理
    Permission("config:read", "查看配置版本", "治理"),
    Permission("config:write", "发布/回滚配置", "治理"),
    Permission("settings:read", "查看控制台设置", "治理"),
    Permission("settings:write", "修改控制台设置", "治理"),
    Permission("audits:read", "查看审计日志", "治理"),
    Permission("policies:read", "查看策略与护栏", "治理"),
    Permission("policies:write", "维护策略、护栏与 MCP", "治理"),
    # 计费
    Permission("prices:read", "查看价格表", "计费"),
    Permission("prices:write", "维护价格表与汇率", "计费"),
    Permission("billing:cost", "查看成本与毛利", "计费", "无此权限时响应中直接不出现成本字段"),
    Permission("billing:spend", "查看己方花费", "计费", "充值/扣费/消费金额"),
    Permission("billing:subtree", "查看下级花费", "计费", "分销商查看自己子树的消费"),
    Permission("ledger:read", "查看账本", "计费"),
    # 用量
    Permission("logs:read", "查看调用日志", "用量"),
    Permission("logs:pull", "拉取上游用量", "用量"),
    Permission("reports:read", "查看报表与看板", "用量"),
    # 账号
    Permission("users:read", "查看用户", "账号"),
    Permission("users:create", "创建用户", "账号"),
    Permission("users:update", "修改用户", "账号"),
    Permission("users:delete", "删除用户", "账号"),
    Permission("apikeys:read", "查看客户端密钥", "账号"),
    Permission("apikeys:write", "维护客户端密钥", "账号"),
    Permission("admins:read", "查看管理员", "账号"),
    Permission("admins:write", "维护管理员与角色分配", "账号"),
    Permission("roles:read", "查看角色与权限矩阵", "账号"),
    Permission("roles:write", "维护角色与权限矩阵", "账号"),
    # 模型试验
    Permission("playground:use", "使用模型试验台", "模型试验"),
)


PERMISSION_KEYS: frozenset[str] = frozenset(permission.key for permission in PERMISSIONS)
PERMISSION_BY_KEY: dict[str, Permission] = {
    permission.key: permission for permission in PERMISSIONS
}


@dataclass(frozen=True)
class RoleDefinition:
    """A built-in role: seeded on startup, never deletable."""

    key: str
    name: str
    description: str
    permissions: frozenset[str]
    builtin: bool = True
    all_permissions: bool = False


BUILTIN_ROLE_ADMIN = "admin"
BUILTIN_ROLE_CUSTOMER = "customer"
BUILTIN_ROLE_RESELLER = "reseller"

_CUSTOMER_PERMISSIONS: frozenset[str] = frozenset(
    {
        # 只读：主数据/流量治理/治理/价目/用量报表
        "upstreams:read",
        "upstream_models:read",
        "public_models:read",
        "model_targets:read",
        "availability:read",
        "transforms:read",
        "config:read",
        "settings:read",
        "audits:read",
        "policies:read",
        "prices:read",
        "ledger:read",
        "logs:read",
        "reports:read",
        # 自己的花费与试验台
        "billing:spend",
        "playground:use",
    }
)

_RESELLER_PERMISSIONS: frozenset[str] = _CUSTOMER_PERMISSIONS | {
    "users:read",
    "users:create",
    "users:update",
    "billing:subtree",
}

BUILTIN_ROLES: tuple[RoleDefinition, ...] = (
    RoleDefinition(
        key=BUILTIN_ROLE_ADMIN,
        name="管理用户",
        description="拥有全部权限，可维护角色、管理员与所有配置",
        permissions=frozenset(),
        all_permissions=True,
    ),
    RoleDefinition(
        key=BUILTIN_ROLE_CUSTOMER,
        name="客户",
        description="只读查看，可看自己的花费并试用模型",
        permissions=_CUSTOMER_PERMISSIONS,
    ),
    RoleDefinition(
        key=BUILTIN_ROLE_RESELLER,
        name="分销商",
        description="在客户基础上可创建下级并查看子树花费",
        permissions=_RESELLER_PERMISSIONS,
    ),
)

BUILTIN_ROLE_KEYS: frozenset[str] = frozenset(role.key for role in BUILTIN_ROLES)
RESERVED_ROLE_KEYS: frozenset[str] = BUILTIN_ROLE_KEYS


def role_definition(role_key: str) -> RoleDefinition | None:
    """Built-in definition for a canonical role key; unknown keys return None."""
    for definition in BUILTIN_ROLES:
        if definition.key == role_key:
            return definition
    return None


def permissions_for_role_key(role_key: str) -> frozenset[str]:
    """Built-in permissions for a role key; unknown keys fail closed (empty set)."""
    definition = role_definition(role_key)
    if definition is None:
        return frozenset()
    if definition.all_permissions:
        return PERMISSION_KEYS
    return definition.permissions


def validate_permission_keys(keys: object) -> frozenset[str]:
    """Validate a role's permission list against the registry."""
    if not isinstance(keys, (list, tuple, set, frozenset)):
        raise AppError(ErrorCode.VALIDATION_ERROR, "permissions 必须是字符串数组")
    requested = {str(key) for key in keys}
    unknown = sorted(requested - PERMISSION_KEYS)
    if unknown:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "存在未注册的权限键",
            details={"unknown": unknown},
        )
    return frozenset(requested)


def parse_permissions_json(raw: str) -> frozenset[str]:
    """Parse admin_roles.permissions_json defensively (unknown keys are dropped)."""
    try:
        data = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return frozenset()
    if not isinstance(data, list):
        return frozenset()
    return frozenset(str(item) for item in data if str(item) in PERMISSION_KEYS)


def require_permission(permissions: object, permission: str) -> None:
    """Raise 403 when the principal's permission set lacks the required key."""
    granted = permissions if isinstance(permissions, (set, frozenset)) else set(permissions or ())
    if permission not in granted:
        raise AppError(
            ErrorCode.FORBIDDEN,
            "缺少权限 " + permission,
            details={"permission": permission},
        )
