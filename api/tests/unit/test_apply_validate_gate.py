"""Ticket 08: the applier refuses to write a config that --validate-only rejects.

The gate is injected so these tests stay hermetic; the real subprocess path is
covered by test_ag_binary_validate.py. Semantics under test:
- failure => no target file, no marker, displayable errors on ApplyResult;
- success => recorded real file sha256 and validation note on ApplyResult;
- the archived rollback replay goes through the same gate.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from l03_adapters.agentgateway.apply import ConfigApplier
from l03_adapters.agentgateway.binary_validate import BinaryValidation
from l03_adapters.spi import make_artifact

CONTENT = "llm:\n  port: 3600\n"
OTHER = "llm:\n  port: 3601\n"


def _accepting(_path: str) -> BinaryValidation:
    return BinaryValidation(ok=True, note="Configuration is valid!")


def _rejecting(path: str) -> BinaryValidation:
    return BinaryValidation(
        ok=False,
        errors=("llm.models[0]: unknown field `bogusField`",),
        note="agentgateway --validate-only rejected the configuration",
    )


def test_rejected_config_writes_nothing(tmp_path: Path) -> None:
    applier = ConfigApplier(str(tmp_path), "config.yaml", validator=_rejecting)
    result = applier.apply(make_artifact(CONTENT, revision="rev_bad"))
    assert result.ok is False
    assert result.rolled_back is False
    assert "validate-only" in result.message
    assert result.errors and "unknown field" in result.errors[0]
    assert (tmp_path / "config.yaml").exists() is False
    assert (tmp_path / "config.yaml.hash").exists() is False
    assert applier.status().config_hash is None
    # no candidate file may survive the failed gate
    assert sorted(p.name for p in tmp_path.iterdir()) == []


def test_rejected_config_keeps_previous_config_serving(tmp_path: Path) -> None:
    accepting = ConfigApplier(str(tmp_path), "config.yaml", validator=_accepting)
    good = make_artifact(CONTENT, revision="rev_good")
    assert accepting.apply(good).ok
    before = (tmp_path / "config.yaml").read_text(encoding="utf-8")

    rejecting = ConfigApplier(str(tmp_path), "config.yaml", validator=_rejecting)
    result = rejecting.apply(make_artifact(OTHER, revision="rev_bad"))
    assert result.ok is False
    assert (tmp_path / "config.yaml").read_text(encoding="utf-8") == before
    status = rejecting.status()
    assert status.config_hash == good.hash
    assert "matches" in status.detail


def test_validator_sees_candidate_inside_config_dir_and_it_is_removed(tmp_path: Path) -> None:
    seen: dict[str, str] = {}

    def inspecting(path: str) -> BinaryValidation:
        seen["path"] = path
        seen["content"] = Path(path).read_text(encoding="utf-8")
        return BinaryValidation(ok=True, note="Configuration is valid!")

    applier = ConfigApplier(str(tmp_path), "config.yaml", validator=inspecting)
    artifact = make_artifact(CONTENT, revision="rev_1")
    assert applier.apply(artifact).ok
    assert os.path.dirname(seen["path"]) == str(tmp_path)
    assert seen["content"] == artifact.content
    assert [p.name for p in tmp_path.iterdir() if "candidate" in p.name] == []


def test_apply_records_real_file_hash_and_validation_note(tmp_path: Path) -> None:
    applier = ConfigApplier(str(tmp_path), "config.yaml", validator=_accepting)
    artifact = make_artifact(CONTENT, revision="rev_1")
    result = applier.apply(artifact)
    assert result.ok
    on_disk = (tmp_path / "config.yaml").read_bytes()
    real_hash = hashlib.sha256(on_disk).hexdigest()
    assert result.file_hash == real_hash
    assert result.applied_hash == artifact.hash == real_hash
    assert "valid" in result.validation_note.lower()


def test_skipped_validation_is_recorded_not_hidden(tmp_path: Path) -> None:
    def skipped(_path: str) -> BinaryValidation:
        return BinaryValidation(
            ok=True, skipped=True, note="agentgateway binary not found; --validate-only skipped"
        )

    applier = ConfigApplier(str(tmp_path), "config.yaml", validator=skipped)
    result = applier.apply(make_artifact(CONTENT, revision="rev_1"))
    assert result.ok
    assert "not found" in result.validation_note
    assert result.file_hash is not None


def test_rollback_replays_through_the_validation_gate(tmp_path: Path) -> None:
    accepting = ConfigApplier(str(tmp_path), "config.yaml", validator=_accepting)
    first = make_artifact(CONTENT, revision="rev_1")
    second = make_artifact(OTHER, revision="rev_2")
    assert accepting.apply(first).ok
    assert accepting.apply(second).ok

    rejecting = ConfigApplier(str(tmp_path), "config.yaml", validator=_rejecting)
    result = rejecting.rollback("rev_1")
    assert result.ok is False
    assert (tmp_path / "config.yaml").read_text(encoding="utf-8") == OTHER
