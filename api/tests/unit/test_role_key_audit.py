"""W6 ticket 21: old console role keys must be gone from system source and UI.

The audit intentionally targets role-key positions instead of banning the words
"user"/"agent" everywhere: API consumers, chat message roles and `user_id`
fields keep their domain meaning. The migration script and its fixtures are the
only places allowed to spell the retired keys.
"""

from __future__ import annotations

import re
from pathlib import Path

from l05_service import rbac
from l06_api.schemas import UserCreate

REPO_ROOT = Path(__file__).resolve().parents[3]
API_SRC = REPO_ROOT / "api" / "src"
WEB_SRC = REPO_ROOT / "web" / "src"

OLD_KEYS = ("user", "agent", "owner", "operator", "viewer")
OLD = "|".join(OLD_KEYS)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _object_block(text: str, header: str) -> str:
    start = text.index(header)
    end = text.index("\n};", start)
    return text[start:end]


def test_builtin_role_registry_has_only_new_keys_and_display_names() -> None:
    assert rbac.BUILTIN_ROLE_KEYS == frozenset({"admin", "customer", "reseller"})
    assert {role.key: role.name for role in rbac.BUILTIN_ROLES} == {
        "admin": "管理用户",
        "customer": "客户",
        "reseller": "分销商",
    }
    # The retired keys are not aliases: lookups fail closed instead of mapping.
    for old in OLD_KEYS:
        assert rbac.role_definition(old) is None
        assert rbac.permissions_for_role_key(old) == frozenset()
    assert not hasattr(rbac, "normalize_role_key")
    assert not hasattr(rbac, "LEGACY_ROLE_ALIASES")
    assert not hasattr(rbac, "BUILTIN_ROLE_USER")
    assert not hasattr(rbac, "BUILTIN_ROLE_AGENT")


def test_user_create_contract_defaults_to_customer() -> None:
    assert UserCreate.model_fields["role"].default == "customer"


def test_api_source_has_no_retired_role_key_positions() -> None:
    patterns = (
        re.compile(r"\bBUILTIN_ROLE_(?:USER|AGENT)\b"),
        re.compile(r"\bLEGACY_ROLE_ALIASES?\b|\bnormalize_role_key\b"),
        re.compile(rf"\brole\s*=\s*[\"'](?:{OLD})[\"']"),
        re.compile(rf"\brole\s*:\s*str\s*=\s*[\"'](?:{OLD})[\"']"),
        re.compile(rf"\brole\s*:\s*str\s*=\s*Field\(default=[\"'](?:{OLD})[\"']"),
        re.compile(rf"\.role\s*=\s*[\"'](?:{OLD})[\"']"),
    )
    violations: list[str] = []
    for path in sorted(API_SRC.rglob("*.py")):
        text = _read(path)
        for pattern in patterns:
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                violations.append(f"{path.relative_to(REPO_ROOT)}:{line}: {match.group(0)}")
    assert not violations, "api/src still spells retired role keys:\n" + "\n".join(violations)


def test_frontend_role_constants_only_contain_new_keys() -> None:
    roles_ts = _read(WEB_SRC / "components" / "governance" / "roles.ts")
    declared = re.search(
        r"export const ADMIN_ROLES[^=]*=\s*\[(.*?)\];", roles_ts, re.S
    )
    assert declared, "ADMIN_ROLES must stay a literal list"
    admin_roles = re.findall(r"[\"']([^\"']+)[\"']", declared.group(1))
    assert admin_roles == ["admin", "customer", "reseller"]

    for header in (
        "export const ROLE_LABEL",
        "export const ROLE_HINT",
        "export const ROLE_TONE",
    ):
        block = _object_block(roles_ts, header)
        keys = re.findall(r"^\s*([a-z_]+)\s*:", block, re.M)
        assert set(keys) == {"admin", "customer", "reseller"}, (header, keys)

    for old in OLD_KEYS:
        assert f'"{old}"' not in roles_ts
        assert f"'{old}'" not in roles_ts
    assert 'customer: "客户"' in roles_ts
    assert 'reseller: "分销商"' in roles_ts

    users_ts = _read(WEB_SRC / "pages" / "users.tsx")
    options = re.search(
        r"const BUILTIN_ROLE_OPTIONS = \[(.*?)\];", users_ts, re.S
    )
    assert options, "BUILTIN_ROLE_OPTIONS must stay a literal fallback list"
    option_keys = re.findall(r"key:\s*[\"']([^\"']+)[\"']", options.group(1))
    assert option_keys == ["admin", "customer", "reseller"]

    mock_ts = _read(WEB_SRC / "lib" / "mock.ts")
    admin_start = mock_ts.index("const adminRoles")
    mock_roles = mock_ts[admin_start : mock_ts.index("\n];", admin_start)]
    mock_role_keys = re.findall(r"key:\s*[\"']([^\"']+)[\"']", mock_roles)
    assert not (set(mock_role_keys) & set(OLD_KEYS)), mock_role_keys
    assert {"admin", "customer", "reseller"} <= set(mock_role_keys)

    users_start = mock_ts.index("const mockUsers")
    mock_users = mock_ts[users_start : mock_ts.index("\n];", users_start)]
    mock_user_roles = set(re.findall(r"role:\s*[\"']([^\"']+)[\"']", mock_users))
    assert mock_user_roles <= {"admin", "customer", "reseller"}, mock_user_roles

    reserved = re.search(r"const RESERVED_ROLE_KEYS = new Set\(\[(.*?)\]\)", mock_ts)
    assert reserved, "RESERVED_ROLE_KEYS must stay a literal set"
    reserved_keys = set(re.findall(r"[\"']([^\"']+)[\"']", reserved.group(1)))
    assert not (reserved_keys & set(OLD_KEYS)), reserved_keys

    mock_user_block = mock_ts[mock_ts.index("const MOCK_CUSTOMER = {"):]
    mock_user_block = mock_user_block[: mock_user_block.index("\n};")]
    mock_role = re.search(r"role:\s*[\"']([^\"']+)[\"']", mock_user_block)
    assert mock_role and mock_role.group(1) == "customer"

    assert 'role: body.role ?? "customer"' in mock_ts
    for dialog in ("edit-user-dialog.tsx", "create-user-dialog.tsx"):
        text = _read(WEB_SRC / "components" / "users" / dialog)
        assert '?? "customer"' in text, dialog
        assert '?? "user"' not in text, dialog

    playground = _read(WEB_SRC / "pages" / "playground.tsx")
    assert 'role === "owner"' not in playground
    assert 'role === "admin"' in playground

    auth_types = _read(WEB_SRC / "types.ts")
    assert 'role: "admin" | "agent" | "user"' not in auth_types
    assert 'role: "admin" | "customer" | "reseller"' in auth_types


def test_generated_contract_has_no_retired_role_key_literals() -> None:
    contract = _read(WEB_SRC / "generated" / "contract.ts")
    retired = re.search(rf"\brole\??\s*:\s*[\"'](?:{OLD})[\"']", contract)
    assert retired is None, retired.group(0) if retired else ""
    assert "role: string;" in contract
    # A role enum must never sneak a retired key into the generated surface.
    assert "role: \"admin\"" not in contract
