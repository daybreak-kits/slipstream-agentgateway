"""Rollback: re-apply an archived revision through the SPI, with a hard-fail path.

The service used to pass the artifact hash where the driver expects the revision
id, and it ignored ApplyResult; a failed rollback was still archived as active.
These tests pin the corrected contract (adapter-spi §4).
"""

from __future__ import annotations

import pytest

from l01_core.errors import AppError
from l02_domain.ir import GatewayIR
from l03_adapters.spi import AdapterInfo, ApplyResult, Artifact, DataPlaneStatus, ValidationResult
from l04_repo.orm import ConfigRevisionORM
from l05_service.rollout import Rollout


class _StubAdapter:
    """SPI stub: records rollback/apply calls and replays scripted results."""

    def __init__(self, *, rollback_ok: bool = True, apply_ok: bool = True) -> None:
        self._rollback_ok = rollback_ok
        self._apply_ok = apply_ok
        self.rollback_calls: list[str] = []
        self.apply_calls: list[Artifact] = []

    def describe(self) -> AdapterInfo:
        return AdapterInfo(adapter_id="stub", version="test")

    def validate(self, ir: GatewayIR) -> ValidationResult:  # pragma: no cover - unused
        raise AssertionError("validate must not run during rollback")

    def render(self, ir: GatewayIR) -> Artifact:  # pragma: no cover - unused
        raise AssertionError("render must not run during rollback")

    def apply(self, artifact: Artifact) -> ApplyResult:
        self.apply_calls.append(artifact)
        if self._apply_ok:
            return ApplyResult(ok=True, applied_hash=artifact.hash, revision_id=artifact.revision)
        return ApplyResult(ok=False, message="stub apply failed")

    def status(self) -> DataPlaneStatus:  # pragma: no cover - unused
        return DataPlaneStatus(config_hash=None)

    def usage(self, cursor):  # pragma: no cover - unused
        raise AssertionError("unused")

    def health(self):  # pragma: no cover - unused
        raise AssertionError("unused")

    def rollback(self, revision_id: str) -> ApplyResult:
        self.rollback_calls.append(revision_id)
        if self._rollback_ok:
            return ApplyResult(
                ok=True,
                applied_hash="hash_rolled_back",
                revision_id=revision_id,
                validation_note="driver history replay",
            )
        return ApplyResult(ok=False, message=f"未知回滚目标: {revision_id}")


def _seed_revisions(factory) -> None:
    with factory() as session:
        session.add_all(
            [
                ConfigRevisionORM(
                    id="rev_active",
                    artifact="active: yes\n",
                    artifact_hash="hash_active",
                    adapter_id="stub",
                    operator="seed",
                    reason="seed",
                    status="active",
                    previous_revision_id=None,
                    created_at_ms=1,
                ),
                ConfigRevisionORM(
                    id="rev_old",
                    artifact="old: yes\n",
                    artifact_hash="hash_old",
                    adapter_id="stub",
                    operator="seed",
                    reason="seed",
                    status="superseded",
                    previous_revision_id=None,
                    created_at_ms=0,
                ),
            ]
        )
        session.commit()


def test_rollback_passes_revision_id_and_archives_active_row(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_revisions(factory)
    adapter = _StubAdapter(rollback_ok=True)
    with factory() as session:
        row = Rollout(session, adapter).rollback("rev_old", "tester")
        session.commit()
        assert adapter.rollback_calls == ["rev_old"]  # id, never the hash
        assert adapter.apply_calls == []  # driver history won
        assert row.status == "active"
        assert row.artifact == "old: yes\n"
        assert row.artifact_hash == "hash_rolled_back"
        assert row.validation_note == "driver history replay"
        assert row.previous_revision_id == "rev_active"
        assert session.get(ConfigRevisionORM, "rev_active").status == "superseded"


def test_rollback_falls_back_to_apply_when_driver_lost_history(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_revisions(factory)
    adapter = _StubAdapter(rollback_ok=False, apply_ok=True)
    with factory() as session:
        row = Rollout(session, adapter).rollback("rev_old", "tester")
        session.commit()
        assert adapter.rollback_calls == ["rev_old"]
        assert [a.revision for a in adapter.apply_calls] == ["rev_old"]
        assert row.status == "active"
        # the fallback re-applies the archived content, so the applied hash is
        # the content hash computed by make_artifact, not the stored marker.
        assert row.artifact_hash == adapter.apply_calls[0].hash
        assert row.artifact_hash != "hash_old"


def test_failed_rollback_archives_failed_row_and_keeps_old_active(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    _seed_revisions(factory)
    adapter = _StubAdapter(rollback_ok=False, apply_ok=False)
    with factory() as session:
        with pytest.raises(AppError) as excinfo:
            Rollout(session, adapter).rollback("rev_old", "tester")
        session.commit()
        assert "回滚下发失败" in excinfo.value.message
        assert excinfo.value.details["message"] == "stub apply failed"
        assert excinfo.value.details["errors"] == []
        failed = session.query(ConfigRevisionORM).filter_by(status="failed").one()
        assert failed.artifact == "old: yes\n"
        assert failed.error_detail == "stub apply failed"
        assert failed.validation_note == ""
        assert session.get(ConfigRevisionORM, "rev_active").status == "active"
