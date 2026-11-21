"""Ticket 16/03: the agentgateway driver's managed keys/ whitelist semantics.

Seam: the agentgateway `materialize_credentials` port (the audit + delete pass
the rollout runs after a successful apply). The managed directory is
`<config_dir>/keys`; the whitelist is the current call's credential files. The
test asserts on disk state + the returned audit, never on private helpers.
Driver-neutral port semantics (fake vs real, same assertions) live in
tests/contract/test_driver_port_conformance.py.
"""

from __future__ import annotations

import pytest

from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.spi import CredentialFile


@pytest.fixture()
def adapter(tmp_path):
    """A driver bound to a fresh config dir; hands back (adapter, managed keys/)."""
    root = tmp_path / "ag-config"
    keys = root / "keys"
    keys.mkdir(parents=True)
    return AgentgatewayAdapter(config_dir=str(root), ag_binary=""), keys


def _write(path, text="secret"):
    path.write_text(text, encoding="utf-8")
    return path


def test_prune_removes_stale_managed_key_files_only(adapter):
    """ADR-026 stale files (deleted key rows, pre-multikey names) disappear."""
    ag, keys = adapter
    current = keys / "ups_a#1.key"
    current.write_text("current-secret", encoding="utf-8")
    stale_hash = _write(keys / "ups_gone#2.key")
    stale_legacy = _write(keys / "ups_retired.key")
    # Not managed key files: never delete them.
    readme = _write(keys / "README.md", "do not delete")
    nested = keys / "nested"
    nested.mkdir()
    nested_key = _write(nested / "ups_nested#1.key")
    # Outside the managed directory: never touched.
    outside = _write(keys.parent / "outside.key")

    result = ag.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="current-secret")]
    )

    assert result.dry_run is False
    assert result.written == (str(current),)
    assert set(result.stale) == {str(stale_hash), str(stale_legacy)}
    assert set(result.deleted) == {str(stale_hash), str(stale_legacy)}
    assert result.failed == ()
    assert not stale_hash.exists() and not stale_legacy.exists()
    # Whitelisted file keeps its content; non-key files/dirs/outside files stay.
    assert current.exists() and current.read_text(encoding="utf-8") == "current-secret"
    assert readme.exists()
    assert nested_key.exists()
    assert outside.exists()


def test_prune_dry_run_reports_the_plan_without_deleting(adapter):
    """先 dry-run 可审计: the operator-visible plan is returned before any delete."""
    ag, keys = adapter
    current = _write(keys / "ups_a#1.key")
    stale = _write(keys / "ups_gone#1.key")

    result = ag.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret")], dry_run=True
    )

    assert result.dry_run is True
    assert result.written == () and result.deleted == ()
    assert result.stale == (str(stale),)
    assert stale.exists(), "dry-run must not delete anything"
    assert current.exists()


def test_prune_is_a_noop_when_the_directory_matches_the_whitelist(adapter):
    """无变化不删: a repeat apply with the same keys deletes nothing."""
    ag, keys = adapter
    current = _write(keys / "ups_a#1.key")
    _write(keys / "notes.txt", "not a key")

    result = ag.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret")]
    )

    assert result.stale == ()
    assert result.deleted == ()
    assert result.failed == ()
    assert current.exists()


def test_prune_is_a_noop_when_the_managed_directory_does_not_exist(tmp_path):
    """A fresh install renders before any keys/ exists; pruning must not raise."""
    ag = AgentgatewayAdapter(config_dir=str(tmp_path / "missing"), ag_binary="")

    result = ag.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret")], dry_run=True
    )

    assert result.stale == () and result.deleted == () and result.written == ()


def test_prune_only_keeps_whitelist_file_bytes_untouched(adapter):
    """W6 review P2-1: the cleanup pass prunes without rewriting managed bytes.

    The write phase already put the exact bytes on disk; the post-apply pass
    must not open/rewrite the whitelist files (a stale mtime/content would race
    the serving data plane) and must only delete outside files.
    """
    ag, keys = adapter
    current = keys / "ups_a#1.key"
    current.write_text("tampered-on-disk", encoding="utf-8")
    stale = _write(keys / "ups_gone#1.key")

    result = ag.materialize_credentials(
        [CredentialFile(ref="ups_a#1", plaintext="secret")], prune_only=True
    )

    assert result.written == (), "prune_only 绝不重写"
    assert result.stale == (str(stale),) and result.deleted == (str(stale),)
    assert current.read_text(encoding="utf-8") == "tampered-on-disk", (
        "白名单文件的字节保持原样（写阶段已落盘，不二次重写）"
    )
    assert not stale.exists()
