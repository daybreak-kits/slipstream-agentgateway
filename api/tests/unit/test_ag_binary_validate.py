"""Ticket 08: the agentgateway --validate-only gate runs before any write.

Resolution order and skip semantics are part of the apply contract: a missing
binary must be recorded, never silently treated as "config looks fine".
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from l03_adapters.agentgateway import binary_validate as bv

FIXTURE = Path(__file__).parents[1] / "contract" / "fixtures" / "ag_1_7_full_config.yaml"


def _install_fake_binary(path: Path) -> str:
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    return str(path)


def _write_config(directory: Path, text: str | None = None) -> Path:
    """Rendered fixture + the key files AG reads while validating."""
    (directory / "keys").mkdir(parents=True, exist_ok=True)
    for name in ("ups_a.key", "ups_b.key"):
        (directory / "keys" / name).write_text("test-key\n", encoding="utf-8")
    config = directory / "config.yaml"
    payload = text if text is not None else FIXTURE.read_text(encoding="utf-8")
    config.write_text(payload, encoding="utf-8")
    return config


def test_find_binary_prefers_explicit_existing_path(tmp_path: Path) -> None:
    explicit = _install_fake_binary(tmp_path / "agentgateway.exe")
    assert bv.find_binary(explicit) == explicit


def test_find_binary_returns_none_when_nothing_installed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(bv.ENV_BINARY, str(tmp_path / "missing-env"))
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    assert bv.find_binary() is None


def test_find_binary_falls_back_to_env_then_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_binary = _install_fake_binary(tmp_path / "env-agentgateway.exe")
    monkeypatch.setenv(bv.ENV_BINARY, env_binary)
    assert bv.find_binary() == env_binary

    monkeypatch.delenv(bv.ENV_BINARY)
    monkeypatch.setattr(shutil, "which", lambda _name: "/from/path/agentgateway")
    assert bv.find_binary() == "/from/path/agentgateway"


def test_build_validator_skips_and_records_when_binary_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(bv.ENV_BINARY, str(tmp_path / "missing"))
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    validator = bv.build_validator()
    result = validator(str(tmp_path / "config.yaml"))
    assert result.ok is True and result.skipped is True
    assert "not found" in result.note
    assert result.errors == ()


def test_build_validator_records_explicit_disable(tmp_path: Path) -> None:
    result = bv.build_validator("")(str(tmp_path / "config.yaml"))
    assert result.ok is True and result.skipped is True
    assert "disabled" in result.note


def _binary_or_skip() -> str:
    binary = bv.find_binary()
    if binary is None:
        pytest.skip("agentgateway binary not installed; set AG_BINARY to run --validate-only tests")
    return binary


def test_validate_only_accepts_rendered_golden_config(tmp_path: Path) -> None:
    binary = _binary_or_skip()
    config = _write_config(tmp_path)
    result = bv.run_validate(str(config), binary=binary)
    assert result.ok is True, result.errors
    assert result.skipped is False
    assert "valid" in result.note.lower()


def test_validate_only_reports_unknown_field_error(tmp_path: Path) -> None:
    binary = _binary_or_skip()
    text = FIXTURE.read_text(encoding="utf-8").replace(
        "visibility: internal", "visibility: internal\n      bogusField: 1", 1
    )
    config = _write_config(tmp_path, text)
    result = bv.run_validate(str(config), binary=binary)
    assert result.ok is False and result.skipped is False
    assert result.errors, "rejected config must expose displayable errors"
    assert any("unknown field" in error for error in result.errors), result.errors


def test_validate_only_reports_negative_priority_error(tmp_path: Path) -> None:
    binary = _binary_or_skip()
    text = FIXTURE.read_text(encoding="utf-8").replace("priority: 10", "priority: -3", 1)
    config = _write_config(tmp_path, text)
    result = bv.run_validate(str(config), binary=binary)
    assert result.ok is False
    assert any("priority" in error for error in result.errors), result.errors


def test_validate_only_reports_missing_key_file(tmp_path: Path) -> None:
    """AG reads provider key files during validation; a missing key is an error."""
    binary = _binary_or_skip()
    config = _write_config(tmp_path)
    (tmp_path / "keys" / "ups_a.key").unlink()
    result = bv.run_validate(str(config), binary=binary)
    assert result.ok is False
    assert any("read resource file" in error for error in result.errors), result.errors


def test_validate_only_missing_binary_at_run_time_is_an_error(tmp_path: Path) -> None:
    config = _write_config(tmp_path)
    result = bv.run_validate(str(config), binary=str(tmp_path / "gone.exe"))
    assert result.ok is False and result.skipped is False
    assert result.errors
