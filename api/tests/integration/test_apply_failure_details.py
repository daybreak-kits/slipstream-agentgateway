"""Ticket 08: failed applies are auditable - failure reason + displayable errors.

The applier returns ApplyResult(errors=..., validation_note=...) when the binary
gate (or the read-back) rejects a config; the service must archive that on the
failed revision row and surface it in APPLY_FAILED.details, so the API/UI can
show why nothing was written.
"""

from __future__ import annotations

import pytest
from tests.conftest import seed_channel

from l01_core.errors import AppError, ErrorCode
from l02_domain.ir import GatewayIR
from l03_adapters.spi import (
    AdapterInfo,
    ApplyResult,
    Artifact,
    CredentialFile,
    DataPlaneStatus,
    MaterializationResult,
    ValidationResult,
    make_artifact,
)
from l04_repo.orm import ConfigRevisionORM
from l05_service.rollout import Rollout

REJECTED = "配置未通过 agentgateway --validate-only 校验，未写入任何文件"


class _GateAdapter:
    """SPI stub whose apply result is scripted by the test."""

    def __init__(self, result: ApplyResult) -> None:
        self._result = result
        self.applied: list[Artifact] = []
        self.materialized: tuple[CredentialFile, ...] = ()

    def describe(self) -> AdapterInfo:
        return AdapterInfo(adapter_id="agentgateway", version="test")

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return ValidationResult(ok=True)

    def materialize_credentials(
        self, files, *, dry_run: bool = False, prune: bool = True, prune_only: bool = False
    ) -> MaterializationResult:
        self.materialized = tuple(files)
        return MaterializationResult(
            dry_run=dry_run,
            written=() if dry_run else tuple(file.ref for file in files),
        )

    def render(self, ir: GatewayIR) -> Artifact:
        return make_artifact("llm:\n  port: 3600\n", revision=ir.revision)

    def apply(self, artifact: Artifact) -> ApplyResult:
        self.applied.append(artifact)
        return self._result

    def status(self) -> DataPlaneStatus:  # pragma: no cover - unused
        return DataPlaneStatus(config_hash=None)

    def usage(self, cursor):  # pragma: no cover - unused
        raise AssertionError("unused")

    def health(self):  # pragma: no cover - unused
        raise AssertionError("unused")

    def rollback(self, revision_id: str) -> ApplyResult:  # pragma: no cover - unused
        raise AssertionError("unused")


def test_gate_rejection_archives_reason_and_displayable_errors(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    adapter = _GateAdapter(
        ApplyResult(
            ok=False,
            message=REJECTED,
            rolled_back=False,
            errors=("llm.models[0]: unknown field bogusField",),
            validation_note="agentgateway --validate-only rejected the configuration",
        )
    )
    with factory() as session:
        with pytest.raises(AppError) as excinfo:
            Rollout(session, adapter).apply("tester")
        session.commit()
        assert excinfo.value.code == ErrorCode.APPLY_FAILED
        details = excinfo.value.details
        assert details["errors"] == ["llm.models[0]: unknown field bogusField"]
        assert details["validation"] == "agentgateway --validate-only rejected the configuration"
        assert details["file_hash"] is None
        failed = session.query(ConfigRevisionORM).filter_by(status="failed").one()
        assert failed.error_detail == REJECTED
        assert failed.validation_note.startswith("agentgateway --validate-only rejected")
        assert session.query(ConfigRevisionORM).filter_by(status="active").all() == []


def test_success_records_real_file_hash_and_gate_note(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    real_hash = "a" * 64
    adapter = _GateAdapter(
        ApplyResult(
            ok=True,
            applied_hash="b" * 64,
            file_hash=real_hash,
            validation_note="Configuration is valid!",
        )
    )
    with factory() as session:
        row = Rollout(session, adapter).apply("tester")
        session.commit()
        assert row.status == "active"
        assert row.artifact_hash == real_hash  # the file on disk, not the artifact hash
        assert row.error_detail == ""
        assert row.validation_note == "Configuration is valid!"
        assert row.artifact == adapter.applied[0].content
