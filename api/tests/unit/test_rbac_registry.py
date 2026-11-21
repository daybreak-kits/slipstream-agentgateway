"""Permission registry invariants (ticket 03): keys, built-in roles, 403 gate."""

from __future__ import annotations

import pytest

from l01_core.errors import AppError, ErrorCode
from l05_service import rbac


def test_permission_keys_use_resource_action_form() -> None:
    for permission in rbac.PERMISSIONS:
        resource, separator, action = permission.key.partition(":")
        assert separator == ":", permission.key
        assert resource and action, permission.key
        assert permission.key == permission.key.lower()
        assert permission.label and permission.group


def test_every_permission_key_is_registered_once() -> None:
    keys = [permission.key for permission in rbac.PERMISSIONS]
    assert len(keys) == len(set(keys))
    assert set(keys) == rbac.PERMISSION_KEYS


def test_builtin_roles_only_grant_registered_permissions() -> None:
    for role in rbac.BUILTIN_ROLES:
        unknown = role.permissions - rbac.PERMISSION_KEYS
        assert not unknown, (role.key, sorted(unknown))


def test_three_builtin_roles_carry_the_console_names() -> None:
    names = {role.key: role.name for role in rbac.BUILTIN_ROLES}
    assert names == {"admin": "管理用户", "customer": "客户", "reseller": "分销商"}


def test_admin_role_is_all_permissions() -> None:
    by_key = {role.key: role for role in rbac.BUILTIN_ROLES}
    assert by_key["admin"].all_permissions is True
    assert by_key["admin"].builtin is True


def test_customer_sees_spend_but_never_cost_or_creation_rights() -> None:
    customer = rbac.role_definition("customer")
    assert "billing:spend" in customer.permissions
    assert "billing:cost" not in customer.permissions
    assert "users:create" not in customer.permissions
    assert "users:read" not in customer.permissions


def test_reseller_creates_subordinates_and_reads_subtree_spend() -> None:
    reseller = rbac.role_definition("reseller")
    assert {"users:read", "users:create", "users:update"} <= reseller.permissions
    assert "billing:subtree" in reseller.permissions
    assert "billing:cost" not in reseller.permissions
    assert "users:delete" not in reseller.permissions


def test_customer_and_reseller_hold_apikeys_self_service_permissions() -> None:
    # W7 C10 / B 方案：自助密钥要求 customer/reseller 拥有 apikeys:read/write；
    # reseller 从 customer 继承，两者的密钥操作都只受 user scope 限制。
    customer = rbac.role_definition("customer")
    reseller = rbac.role_definition("reseller")
    assert {"apikeys:read", "apikeys:write"} <= customer.permissions
    assert {"apikeys:read", "apikeys:write"} <= reseller.permissions


def test_retired_role_names_are_not_aliases() -> None:
    # W6/21: no compatibility layer - old keys must fail closed and be migrated
    # in the database, never silently mapped to a built-in role.
    for old in ("user", "agent", "owner", "operator", "viewer"):
        assert rbac.role_definition(old) is None
        assert rbac.permissions_for_role_key(old) == frozenset()
    assert not hasattr(rbac, "normalize_role_key")
    assert not hasattr(rbac, "LEGACY_ROLE_ALIASES")


def test_require_permission_rejects_with_403() -> None:
    with pytest.raises(AppError) as raised:
        rbac.require_permission({"users:read"}, "users:write")
    assert raised.value.code == ErrorCode.FORBIDDEN
    assert raised.value.status_code == 403
    assert "users:write" in raised.value.message


def test_require_permission_allows_granted_key() -> None:
    rbac.require_permission({"users:read"}, "users:read")


def test_unknown_permission_key_is_rejected_on_registration() -> None:
    with pytest.raises(AppError) as raised:
        rbac.validate_permission_keys(["users:read", "billing:teleport"])
    assert raised.value.code == ErrorCode.VALIDATION_ERROR
    assert raised.value.details["unknown"] == ["billing:teleport"]
