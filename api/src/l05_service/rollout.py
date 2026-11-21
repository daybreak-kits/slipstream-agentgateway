"""One deep module for configuration rollouts (architecture review #1).

The data plane changes in exactly two ways: apply a freshly rendered revision or
roll back to an archived one. Both live here so the archived row, its status
vocabulary, the active-revision marker and the operator are decided once. Callers
choose the failure policy explicitly instead of each re-inventing a try/except.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from l01_core.errors import AppError, ErrorCode
from l01_core.ids import new_id
from l01_core.timeutil import now_ms
from l03_adapters.spi import ApplyResult, DataPlaneAdapter, DataPlaneStatus, make_artifact
from l04_repo.orm import ConfigRevisionORM
from l04_repo.repository import REVISION_REPO, put_setting
from l05_service import rendering

logger = logging.getLogger(__name__)

FailurePolicy = Literal["raise", "keep-booked"]


class RevisionStatus(StrEnum):
    """The only vocabulary for config_revisions.status (also sent via OpenAPI)."""

    ACTIVE = "active"
    SUPERSEDED = "superseded"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class RolloutStatus:
    """The driver truth plus the archived row that explains it."""

    data_plane: DataPlaneStatus
    active_revision: ConfigRevisionORM | None


class Rollout:
    """Apply, rollback, status and history over one session + injected driver."""

    def __init__(self, session: Session, adapter: DataPlaneAdapter) -> None:
        self._session = session
        self._adapter = adapter

    def apply(
        self,
        principal: str,
        reason: str = "",
        *,
        on_failure: FailurePolicy = "raise",
    ) -> ConfigRevisionORM | None:
        """Render the full desired state and archive one revision.

        on_failure="raise" (default): archive a failed row, then raise APPLY_FAILED.
        on_failure="keep-booked": a driver/validation failure is archived (when the
        flow reached the archive step) and returned instead of raised; a failure
        before archiving returns None. Callers that committed business rows before
        the rollout (top-ups) can therefore leave them booked without a bare except.
        """
        revision = new_id("rev")
        try:
            session = self._session
            adapter = self._adapter
            plan = rendering.build_render_plan(session, revision=revision, adapter=adapter)
            ir, credentials = plan
            # S3: the driver's own validate() is part of the SPI contract, so the apply
            # flow must run it before rendering (a driver may reject IR that the generic
            # checker accepts). Nothing is written when it fails.
            validation = adapter.validate(ir)
            if not validation.ok:
                raise AppError(
                    ErrorCode.APPLY_FAILED,
                    "适配器校验未通过，拒绝下发",
                    details={"errors": list(validation.errors)},
                )
            # Ticket 03: the adapter materializes its own credential files (write
            # phase only) so the candidate config's key references resolve when the
            # apply gate reads them; the whitelist cleanup runs after the apply
            # actually succeeded, never on a failed one.
            adapter.materialize_credentials(credentials, prune=False)
            artifact = adapter.render(ir)
            result = adapter.apply(artifact)
        except AppError as exc:
            if on_failure == "raise":
                raise
            logger.warning(
                "config apply failed before archiving (principal=%s): %s", principal, exc.message
            )
            return None
        row = self._archive(
            revision=revision,
            artifact=artifact.content,
            artifact_hash=result.file_hash or result.applied_hash or artifact.hash,
            result=result,
            operator=principal,
            reason=reason,
        )
        if result.ok:
            self._prune_stale_credentials(credentials)
            return row
        if on_failure == "raise":
            raise AppError(
                ErrorCode.APPLY_FAILED,
                result.message or "数据面配置下发失败（已自动回滚上一版）",
                details={
                    "revision": revision,
                    "errors": list(result.errors),
                    "validation": result.validation_note,
                    "file_hash": result.file_hash,
                },
            )
        return row

    def _prune_stale_credentials(self, credentials) -> None:
        """Ticket 16/03: drop managed credential files the applied config no longer uses.

        Best effort by contract: a cleanup failure must never turn a successful
        apply into a failed one. The prune-only pass deletes managed files
        outside this render's whitelist WITHOUT rewriting the whitelist files --
        the write phase already materialized their exact bytes (W6 review P2-1);
        the plan (stale list) is logged by the adapter and failures as warnings,
        so the operator can audit the managed directory.
        """
        try:
            audit = self._adapter.materialize_credentials(credentials, prune_only=True)
        except Exception:  # pragma: no cover - prune is best-effort
            logger.warning(
                "key 文件清理失败，本次配置已生效但受管 keys/ 目录可能残留陈旧文件",
                exc_info=True,
            )
            return
        if audit.failed:
            logger.warning(
                "key 文件清理部分失败：%d 个文件保留请人工处理：%s",
                len(audit.failed),
                ", ".join(audit.failed),
            )

    def rollback(self, revision_id: str, principal: str) -> ConfigRevisionORM:
        """Roll the data plane back to an archived revision and re-archive it as active."""
        target = self._session.get(ConfigRevisionORM, revision_id)
        if target is None:
            raise AppError(ErrorCode.NOT_FOUND, f"revision not found: {revision_id}")
        # The SPI rollback takes the data-plane revision id (the id the artifact was
        # applied under), not its hash. A driver may have lost its in-process history
        # (control-plane restart); the archived artifact is the source of truth, so
        # fall back to re-applying it verbatim through the same atomic apply path.
        result = self._adapter.rollback(target.id)
        if not result.ok:
            result = self._adapter.apply(make_artifact(target.artifact, revision=target.id))
        new_revision = new_id("rev")
        row = self._archive(
            revision=new_revision,
            artifact=target.artifact,
            artifact_hash=result.file_hash or result.applied_hash or target.artifact_hash,
            result=result,
            operator=principal,
            reason=f"rollback to {revision_id}",
        )
        if not result.ok:
            raise AppError(
                ErrorCode.APPLY_FAILED,
                "回滚下发失败：数据面继续服务原配置",
                details={"message": result.message, "errors": list(result.errors)},
            )
        return row

    def status(self) -> RolloutStatus:
        """What the data plane serves now and which archived row explains it."""
        return RolloutStatus(
            data_plane=self._adapter.status(), active_revision=self._latest_active()
        )

    def history(self, limit: int = 20) -> list[ConfigRevisionORM]:
        """Newest archived revisions first (limit is caller-bounded)."""
        return list(
            self._session.scalars(
                select(ConfigRevisionORM)
                .order_by(ConfigRevisionORM.created_at_ms.desc())
                .limit(limit)
            ).all()
        )

    def _archive(
        self,
        *,
        revision: str,
        artifact: str,
        artifact_hash: str,
        result: ApplyResult,
        operator: str,
        reason: str,
    ) -> ConfigRevisionORM:
        """Insert the revision row; a successful apply also supersedes the old actives."""
        previous_rows = self._active_rows()
        row = ConfigRevisionORM(
            id=revision,
            artifact=artifact,
            artifact_hash=artifact_hash,
            adapter_id=self._adapter.describe().adapter_id,
            operator=operator,
            reason=reason,
            status=(RevisionStatus.ACTIVE if result.ok else RevisionStatus.FAILED).value,
            previous_revision_id=previous_rows[0].id if previous_rows else None,
            error_detail="" if result.ok else result.message,
            validation_note=result.validation_note,
            created_at_ms=now_ms(),
        )
        REVISION_REPO.add(self._session, row)
        if result.ok:
            for old in previous_rows:
                old.status = RevisionStatus.SUPERSEDED.value
            put_setting(
                self._session,
                "active_revision",
                json.dumps({"id": revision}),
                now_ms(),
            )
        return row

    def _latest_active(self) -> ConfigRevisionORM | None:
        rows = self._active_rows()
        return rows[0] if rows else None

    def _active_rows(self) -> list[ConfigRevisionORM]:
        return list(
            self._session.scalars(
                select(ConfigRevisionORM)
                .where(ConfigRevisionORM.status == RevisionStatus.ACTIVE.value)
                .order_by(ConfigRevisionORM.created_at_ms.desc())
            ).all()
        )


def apply_rollout(
    session: Session,
    adapter: DataPlaneAdapter,
    principal: str,
    reason: str = "",
    *,
    on_failure: FailurePolicy = "raise",
) -> ConfigRevisionORM | None:
    """Apply one render plan and commit the business rows with its revision.

    Every console write that triggers a data-plane apply needs the same two
    steps in the same order: apply once, then commit once. Keeping the pair here
    stops each route from re-spelling it and forgetting the commit (the archived
    revision and the business rows must land in one transaction).
    """
    row = Rollout(session, adapter).apply(principal, reason, on_failure=on_failure)
    session.commit()
    return row
