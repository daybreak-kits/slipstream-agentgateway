"""In-memory MockAdapter: the reference driver used by contract tests and dev runs."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from typing import Any

from l02_domain.ir import GatewayIR
from l02_domain.models import UsageEvent
from l02_domain.validation import validate_gateway_ir
from l03_adapters.spi import (
    AdapterInfo,
    ApplyResult,
    Artifact,
    DataPlaneStatus,
    HealthSnapshot,
    UsageCursor,
    UsagePage,
    ValidationResult,
    make_artifact,
)
from l03_adapters.yaml_dumps import to_yaml


@dataclass
class MockAdapter:
    """Config dir backed (tmp in tests) driver that mimics apply/rollback semantics."""

    config_dir: str = ""
    fail_next_apply: bool = False
    usage_events: tuple[UsageEvent, ...] = ()

    def __post_init__(self) -> None:
        self._current: Artifact | None = None
        self._previous: Artifact | None = None
        self._history: dict[str, Artifact] = {}

    def describe(self) -> AdapterInfo:
        return AdapterInfo(adapter_id="mock", version="0.1.0")

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return validate_gateway_ir(ir)

    def render(self, ir: GatewayIR) -> Artifact:
        payload: dict[str, Any] = {
            "revision": ir.revision,
            "providers": [u.id for u in ir.upstreams],
            "models": [m.id for m in ir.models],
            "publicModels": [
                {"name": p.name, "targets": [t.id for t in p.targets]} for p in ir.public_models
            ],
            "apiKeys": [k.id for k in ir.api_keys],
        }
        if ir.limits is not None:
            payload["limits"] = {
                "requestsPerMinute": ir.limits.requests_per_minute,
                "tokensPerMinute": ir.limits.tokens_per_minute,
                "budgetUsd": ir.limits.budget_usd,
            }
        return make_artifact(to_yaml(payload), revision=ir.revision)

    def apply(self, artifact: Artifact) -> ApplyResult:
        if self.fail_next_apply:
            self.fail_next_apply = False
            # Simulated failed hot reload: keep serving the previous artifact.
            return ApplyResult(ok=False, message="injected failure", rolled_back=True)
        self._previous = self._current
        self._current = artifact
        if artifact.revision:
            self._history[artifact.revision] = artifact
        if self.config_dir:
            os.makedirs(self.config_dir, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=self.config_dir, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(artifact.content)
            os.replace(tmp_path, os.path.join(self.config_dir, "config.yaml"))
        return ApplyResult(
            ok=True, applied_hash=artifact.hash, revision_id=artifact.revision or None
        )

    def status(self) -> DataPlaneStatus:
        return DataPlaneStatus(
            config_hash=self._current.hash if self._current else None,
            process_version="mock-0.1.0",
            listening=self._current is not None,
            detail="in-memory driver",
        )

    def usage(self, cursor: UsageCursor | None) -> UsagePage:
        start = int(cursor.value) if cursor is not None else 0
        window = list(self.usage_events[start : start + 2])
        next_index = start + len(window)
        next_cursor = (
            UsageCursor(value=str(next_index)) if next_index < len(self.usage_events) else None
        )
        return UsagePage(events=tuple(window), next_cursor=next_cursor)

    def health(self) -> HealthSnapshot:
        from l01_core.timeutil import now_ms

        return HealthSnapshot(healthy=True, detail="mock always healthy", checked_at_ms=now_ms())

    def rollback(self, revision_id: str) -> ApplyResult:
        target = self._history.get(revision_id)
        if target is None:
            return ApplyResult(ok=False, message=f"unknown revision: {revision_id}")
        self._current = target
        return ApplyResult(ok=True, applied_hash=target.hash, revision_id=revision_id)
