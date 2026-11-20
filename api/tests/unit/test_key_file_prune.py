"""Ticket 16: prune stale key files inside the managed keys/ directory.

Seam: `l05_service.rendering.prune_key_files` (the audit + delete pass the
rollout runs after a successful apply). The managed directory is
`<ag_config_dir>/keys`; the whitelist is the current render's key_files. The
test asserts on disk state + the returned audit, never on private helpers.
"""

from __future__ import annotations

import pytest

from l01_core.settings import reset_settings_cache
from l05_service.rendering import prune_key_files


@pytest.fixture()
def keys_dir(tmp_path, monkeypatch):
    """Point the settings at a temp ag-config dir and hand back its keys/ child."""
    root = tmp_path / "ag-config"
    keys = root / "keys"
    keys.mkdir(parents=True)
    monkeypatch.setenv("SLIPSTREAM_AG_CONFIG_DIR", str(root))
    monkeypatch.setenv("SLIPSTREAM_SECRET_KEY", "test-secret")
    reset_settings_cache()
    yield keys
    reset_settings_cache()


def _write(path, text="secret"):
    path.write_text(text, encoding="utf-8")
    return path


def test_prune_removes_stale_managed_key_files_only(keys_dir):
    """ADR-026 stale files (deleted key rows, pre-multikey names) disappear."""
    current = _write(keys_dir / "ups_a#1.key", "current-secret")
    stale_hash = _write(keys_dir / "ups_gone#2.key")
    stale_legacy = _write(keys_dir / "ups_retired.key")
    # Not managed key files: never delete them.
    readme = _write(keys_dir / "README.md", "do not delete")
    nested = keys_dir / "nested"
    nested.mkdir()
    nested_key = _write(nested / "ups_nested#1.key")
    # Outside the managed directory: never touched.
    outside = _write(keys_dir.parent / "outside.key")

    result = prune_key_files({str(current): "current-secret"})

    assert result.dry_run is False
    assert set(result.stale) == {str(stale_hash), str(stale_legacy)}
    assert set(result.deleted) == {str(stale_hash), str(stale_legacy)}
    assert result.failed == ()
    assert not stale_hash.exists() and not stale_legacy.exists()
    # Whitelisted file keeps its content; non-key files/dirs/outside files stay.
    assert current.exists() and current.read_text(encoding="utf-8") == "current-secret"
    assert readme.exists()
    assert nested_key.exists()
    assert outside.exists()


def test_prune_dry_run_reports_the_plan_without_deleting(keys_dir):
    """先 dry-run 可审计: the operator-visible plan is returned before any delete."""
    current = _write(keys_dir / "ups_a#1.key")
    stale = _write(keys_dir / "ups_gone#1.key")

    result = prune_key_files({str(current): "secret"}, dry_run=True)

    assert result.dry_run is True
    assert result.stale == (str(stale),)
    assert result.deleted == ()
    assert stale.exists(), "dry-run must not delete anything"


def test_prune_is_a_noop_when_the_directory_matches_the_whitelist(keys_dir):
    """无变化不删: a repeat apply with the same keys deletes nothing."""
    current = _write(keys_dir / "ups_a#1.key")
    _write(keys_dir / "notes.txt", "not a key")

    result = prune_key_files({str(current): "secret"})

    assert result.stale == ()
    assert result.deleted == ()
    assert result.failed == ()
    assert current.exists()


def test_prune_is_a_noop_when_the_managed_directory_does_not_exist(tmp_path, monkeypatch):
    """A fresh install renders before any keys/ exists; pruning must not raise."""
    monkeypatch.setenv("SLIPSTREAM_AG_CONFIG_DIR", str(tmp_path / "missing"))
    monkeypatch.setenv("SLIPSTREAM_SECRET_KEY", "test-secret")
    reset_settings_cache()
    try:
        result = prune_key_files({str(tmp_path / "missing" / "keys" / "ups#1.key"): "x"})
    finally:
        reset_settings_cache()
    assert result.stale == () and result.deleted == ()
