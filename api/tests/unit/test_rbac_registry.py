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
    assert names == {"admin": "管理用户", "user": "普通用户", "agent": "代理用户"}


def test_admin_role_is_all_permissions() -> None:
    by_key = {role.key: role for role in rbac.BUILTIN_ROLES}
    assert by_key["admin"].all_permissions is True
    assert by_key["admin"].builtin is True


def test_ordinary_user_sees_spend_but_never_cost_or_creation_rights() -> None:
    user = rbac.role_definition("user")
    assert "billing:spend" in user.permissions
    assert "billing:cost" not in user.permissions
    assert "users:create" not in user.permissions
    assert "users:read" not in user.permissions


def test_agent_user_creates_subordinates_and_reads_subtree_spend() -> None:
    agent = rbac.role_definition("agent")
    assert {"users:read", "users:create", "users:update"} <= agent.permissions
    assert "billing:subtree" in agent.permissions
    assert "billing:cost" not in agent.permissions
    assert "users:delete" not in agent.permissions


def test_legacy_role_names_alias_to_builtin_keys() -> None:
    assert rbac.normalize_role_key("owner") == "admin"
    assert rbac.normalize_role_key("admin") == "admin"
    assert rbac.normalize_role_key("operator") == "agent"
    assert rbac.normalize_role_key("viewer") == "user"
    assert rbac.normalize_role_key("custom_ops") == "custom_ops"


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
