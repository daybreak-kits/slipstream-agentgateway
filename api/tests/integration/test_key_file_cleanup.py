"""Ticket 16/03: a successful apply materializes and prunes keys via the adapter.

Seam: `Rollout.apply` + the adapter's materialize_credentials port + the real
`keys/` directory (the agentgateway driver owns the disk layout; the system
never writes a key file itself). Each test seeds the standard channel
(upstream ups_test, one key row), pre-creates files around the managed
directory and asserts the post-apply disk state — never on private helpers.
"""

from __future__ import annotations

import logging
from pathlib import Path

from tests.conftest import seed_channel

from l01_core.settings import get_settings, reset_settings_cache
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.mock import MockAdapter
from l05_service.rollout import Rollout


def _adapter() -> AgentgatewayAdapter:
    return AgentgatewayAdapter(get_settings().data_plane_config_dir, ag_binary="")


def _apply(factory, adapter=None, *, on_failure="raise"):
    with factory() as session:
        row = Rollout(session, adapter or _adapter()).apply(
            "tester", reason="ticket16", on_failure=on_failure
        )
        session.commit()
        return row


def _keys_dir() -> Path:
    return Path(get_settings().data_plane_config_dir) / "keys"


def _seed_with_stale_files(engine, factory) -> tuple[Path, Path, Path]:
    """Seed the channel and plant one stale key, one legacy name, one non-key file."""
    seed_channel(engine, factory)
    reset_settings_cache()
    keys_dir = _keys_dir()
    keys_dir.mkdir(parents=True, exist_ok=True)
    stale = keys_dir / "ups_removed#1.key"
    stale.write_text("old-secret", encoding="utf-8")
    legacy = keys_dir / "ups_test.key"
    legacy.write_text("pre-multikey-secret", encoding="utf-8")
    note = keys_dir / "notes.txt"
    note.write_text("operator note", encoding="utf-8")
    return stale, legacy, note


def test_successful_apply_materializes_and_removes_only_stale_managed_key_files(
    engine_and_sessionmaker,
):
    engine, factory = engine_and_sessionmaker
    stale, legacy, note = _seed_with_stale_files(engine, factory)
    outside = Path(get_settings().data_plane_config_dir) / "outside.key"
    outside.write_text("outside-secret", encoding="utf-8")

    row = _apply(factory)

    assert row.status == "active"
    # The fresh render's credential was materialized through the adapter port;
    # '#' is a literal filename char.
    current = _keys_dir() / "ups_test#1.key"
    assert current.read_text(encoding="utf-8") == "raw-upstream-key"
    # Files no longer in the whitelist disappear (cleanup ran only after success).
    assert not stale.exists()
    assert not legacy.exists()
    # Non-key files and files outside the managed dir are out of scope.
    assert note.read_text(encoding="utf-8") == "operator note"
    assert outside.read_text(encoding="utf-8") == "outside-secret"
    assert sorted(path.name for path in _keys_dir().glob("*.key")) == ["ups_test#1.key"]


def test_failed_apply_does_not_prune_key_files(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    stale, _, _ = _seed_with_stale_files(engine, factory)

    row = _apply(factory, MockAdapter(fail_next_apply=True), on_failure="keep-booked")

    assert row is not None and row.status == "failed"
    assert stale.exists(), "配置未生效时不能清理旧密钥文件"


def test_prune_failure_is_logged_but_does_not_block_the_apply(
    engine_and_sessionmaker, monkeypatch, caplog
):
    engine, factory = engine_and_sessionmaker
    _seed_with_stale_files(engine, factory)
    adapter = _adapter()
    real_materialize = type(adapter).materialize_credentials
    phases: list[bool] = []

    def _explode_on_cleanup(files, *, dry_run=False, prune=True):
        phases.append(prune)
        if prune:  # the post-apply cleanup phase, not the pre-apply write
            raise OSError("disk busy")
        return real_materialize(adapter, files, dry_run=dry_run, prune=prune)

    monkeypatch.setattr(adapter, "materialize_credentials", _explode_on_cleanup)
    with caplog.at_level(logging.WARNING, logger="l05_service.rollout"):
        row = _apply(factory, adapter)

    assert phases == [False, True], "写阶段先于 apply，清理阶段只在其后"
    assert row.status == "active", "清理失败不得把已生效的下发改成失败"
    assert any(
        "key 文件清理" in record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING
    )
    assert (_keys_dir() / "ups_test#1.key").exists()


def test_repeat_apply_keeps_the_current_key_file_and_leaves_no_temp_files(
    engine_and_sessionmaker,
):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    reset_settings_cache()

    assert _apply(factory).status == "active"
    current = _keys_dir() / "ups_test#1.key"
    first_bytes = current.read_bytes()
    assert _apply(factory).status == "active"

    assert current.read_bytes() == first_bytes
    assert sorted(path.name for path in _keys_dir().glob("*.key")) == ["ups_test#1.key"]
    assert not list(_keys_dir().glob("*.tmp"))


def test_rollout_materializes_before_apply_and_prunes_only_after_success(
    engine_and_sessionmaker,
):
    """Ticket 03 port contract: the adapter sees write-phase then cleanup-phase.

    Keys must exist before apply (the binary gate reads them relative to the
    config file), and the whitelist cleanup must run only once the apply
    succeeded — a failed apply leaves the old credentials serving.
    """
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    reset_settings_cache()
    inner = _adapter()
    calls: list[str] = []
    real_materialize = type(inner).materialize_credentials

    class _Recording(AgentgatewayAdapter):
        def validate(self, ir):
            calls.append("validate")
            return super().validate(ir)

        def materialize_credentials(self, files, *, dry_run=False, prune=True):
            calls.append(f"materialize prune={prune}")
            return real_materialize(inner, files, dry_run=dry_run, prune=prune)

        def render(self, ir):
            calls.append("render")
            return super().render(ir)

        def apply(self, artifact):
            calls.append("apply")
            return super().apply(artifact)

    row = _apply(factory, _Recording(get_settings().data_plane_config_dir, ag_binary=""))

    assert row.status == "active"
    assert calls == [
        "validate",
        "materialize prune=False",
        "render",
        "apply",
        "materialize prune=True",
    ], calls
    assert (_keys_dir() / "ups_test#1.key").exists()
