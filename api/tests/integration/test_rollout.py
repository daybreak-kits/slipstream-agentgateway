"""Rollout is the single apply/rollback/status/history module (architecture #1)."""

from __future__ import annotations

from tests.conftest import seed_channel

from l02_domain.ir import GatewayIR
from l03_adapters.spi import (
    AdapterInfo,
    ApplyResult,
    Artifact,
    DataPlaneStatus,
    MaterializationResult,
    ValidationResult,
    make_artifact,
)
from l04_repo.orm import ConfigRevisionORM
from l05_service.rollout import RevisionStatus, Rollout


class _ScriptedAdapter:
    """SPI stub: scripted apply result, fixed status, unused methods raise."""

    def __init__(self, result: ApplyResult) -> None:
        self._result = result
        self.applied: list[Artifact] = []

    def describe(self) -> AdapterInfo:
        return AdapterInfo(adapter_id="stub", version="test")

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return ValidationResult(ok=True)

    def materialize_credentials(
        self, files, *, dry_run: bool = False, prune: bool = True, prune_only: bool = False
    ) -> MaterializationResult:
        return MaterializationResult(
            dry_run=dry_run,
            written=() if dry_run else tuple(file.ref for file in files),
        )

    def render(self, ir: GatewayIR) -> Artifact:
        return make_artifact("llm:\n  port: 3600\n", revision=ir.revision)

    def apply(self, artifact: Artifact) -> ApplyResult:
        self.applied.append(artifact)
        return self._result

    def status(self) -> DataPlaneStatus:
        return DataPlaneStatus(
            config_hash="sha-current",
            process_version="test",
            listening=True,
            detail="ok",
        )

    def usage(self, cursor):  # pragma: no cover - unused
        raise AssertionError("unused")

    def health(self):  # pragma: no cover - unused
        raise AssertionError("unused")

    def rollback(self, revision_id: str):  # pragma: no cover - unused
        raise AssertionError("unused")


def test_revision_status_is_the_single_vocabulary() -> None:
    assert {status.value for status in RevisionStatus} == {"active", "superseded", "failed"}


def test_keep_booked_apply_archives_failed_revision_without_raising(engine_and_sessionmaker):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    adapter = _ScriptedAdapter(
        ApplyResult(ok=False, message="gate rejected", errors=("bad field",))
    )
    with factory() as session:
        row = Rollout(session, adapter).apply(
            "tester", reason="balance-topup", on_failure="keep-booked"
        )
        assert row is not None
        assert row.status == RevisionStatus.FAILED
        assert row.operator == "tester"
        assert row.error_detail == "gate rejected"
        assert adapter.applied, "the scripted apply must actually run"
        session.commit()
        failed = session.query(ConfigRevisionORM).filter_by(status="failed").one()
        assert failed.id == row.id
        assert session.query(ConfigRevisionORM).filter_by(status="active").all() == []


def test_apply_endpoint_records_the_principal(engine_and_sessionmaker, client):
    engine, factory = engine_and_sessionmaker
    seed_channel(engine, factory)
    response = client.post("/admin/config/apply", json={"reason": "w1-operator"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "active"
    assert body["reason"] == "w1-operator"
    assert body["operator"] and body["operator"] != "api"
    with factory() as session:
        row = session.get(ConfigRevisionORM, body["id"])
        assert row is not None and row.operator == body["operator"]


def test_latest_revision_endpoint_uses_the_same_response_model(engine_and_sessionmaker, client):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        session.add(
            ConfigRevisionORM(
                id="rev_latest",
                artifact="active: yes\n",
                artifact_hash="hash_latest",
                adapter_id="stub",
                operator="seed",
                reason="seed",
                status="active",
                created_at_ms=2,
            )
        )
        session.commit()
    response = client.get("/admin/config/revisions/latest")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == "rev_latest"
    assert body["status"] == "active"
    assert body["operator"] == "seed"


def test_openapi_publishes_the_revision_status_enum(client):
    schemas = client.app.openapi()["components"]["schemas"]
    revision = schemas["ConfigRevisionOut"]["properties"]["status"]
    assert revision["$ref"].endswith("/RevisionStatus")
    assert schemas["RevisionStatus"]["enum"] == ["active", "superseded", "failed"]


def test_status_and_history_expose_the_active_revision(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
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
                    created_at_ms=2,
                ),
                ConfigRevisionORM(
                    id="rev_old",
                    artifact="old: yes\n",
                    artifact_hash="hash_old",
                    adapter_id="stub",
                    operator="seed",
                    reason="seed",
                    status="superseded",
                    created_at_ms=1,
                ),
            ]
        )
        session.commit()
        rollout = Rollout(session, _ScriptedAdapter(ApplyResult(ok=True)))
        snapshot = rollout.status()
        assert snapshot.data_plane.config_hash == "sha-current"
        assert snapshot.active_revision is not None
        assert snapshot.active_revision.id == "rev_active"
        assert [row.id for row in rollout.history(limit=2)] == ["rev_active", "rev_old"]
