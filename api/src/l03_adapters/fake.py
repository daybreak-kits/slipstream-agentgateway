"""FakeAdapter: an in-memory data plane for system-flow and boundary tests.

W6 ticket 01 introduces the fake driver so the control plane can exercise its
main flow (startup, health, connection, usage pull/list, log list/detail,
render/apply and cleanup) without a real data plane. It is intentionally
selectable only through the registry/settings seam for tests and local demos;
the console never offers a data-plane picker, so this file must not leak into
web UI choices.

Every new SPI port is implemented here with deterministic, side-effect-free
semantics. The fake driver does not know any vendor wire format: no OTLP,
config paths, port numbers or capability-path vocabulary appear in this module.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Sequence
from typing import Any

from l01_core.timeutil import now_ms
from l02_domain.ir import GatewayIR, TransformsSpec
from l02_domain.models import RequestAttempt, UsageEvent
from l02_domain.validation import ValidationResult, validate_gateway_ir
from l03_adapters.spi import (
    AdapterInfo,
    ApplyResult,
    Artifact,
    AttemptSink,
    Capability,
    ClientContract,
    ClientEndpoint,
    CredentialFile,
    DataPlaneStatus,
    HealthSnapshot,
    LogPayload,
    MaterializationResult,
    TelemetryHandle,
    TransformPreview,
    UsageCursor,
    UsagePage,
    make_artifact,
)
from l03_adapters.yaml_dumps import to_yaml

_FAKE_VERSION = "fake-1.0.0"
_FAKE_CAPABILITIES = (
    Capability("routing.priority_failover", True, _FAKE_VERSION, "fake: priority failover"),
    Capability("routing.weighted", True, _FAKE_VERSION, "fake: weighted routing"),
    Capability("routing.conditional", True, _FAKE_VERSION, "fake: conditional routing"),
    Capability("observe.request_log", True, _FAKE_VERSION, "fake: request log"),
    Capability("observe.request_attempts", True, _FAKE_VERSION, "fake: normalized attempts"),
    Capability("usage.read_events", True, _FAKE_VERSION, "fake: incremental usage"),
    Capability("config.validate_only", True, _FAKE_VERSION, "fake: in-memory validation"),
    Capability("config.hot_reload", True, _FAKE_VERSION, "fake: in-memory apply"),
    Capability("policies.transformations.conditional", True, _FAKE_VERSION, "fake: transforms"),
    Capability("mcp.targets", True, _FAKE_VERSION, "fake: mcp targets"),
)


def _default_usage_events() -> tuple[UsageEvent, ...]:
    """Three deterministic flow events: success, upstream error and embedding."""
    stamp = now_ms() - 5_000
    return (
        UsageEvent(
            event_id="evt_fake_0001",
            started_at_ms=stamp,
            completed_at_ms=stamp + 210,
            duration_ms=210,
            time_to_first_token_ms=45,
            http_status=200,
            public_model="fake-chat",
            upstream_model="fake-chat-upstream",
            provider="fake",
            input_tokens=1_200,
            output_tokens=300,
            total_tokens=1_500,
            raw_json='{"has_payload": false}',
        ),
        UsageEvent(
            event_id="evt_fake_0002",
            started_at_ms=stamp + 1_000,
            completed_at_ms=stamp + 1_040,
            duration_ms=40,
            http_status=429,
            public_model="fake-chat",
            upstream_model="fake-chat-upstream",
            provider="fake",
            input_tokens=80,
            output_tokens=0,
            total_tokens=80,
            raw_json='{"error": "fake upstream rate limited", "has_payload": false}',
        ),
        UsageEvent(
            event_id="evt_fake_0003",
            started_at_ms=stamp + 2_000,
            completed_at_ms=stamp + 2_020,
            duration_ms=20,
            http_status=200,
            public_model="fake-embed",
            upstream_model="fake-embed-upstream",
            provider="fake",
            input_tokens=640,
            output_tokens=0,
            total_tokens=640,
            raw_json='{"has_payload": false}',
        ),
    )


class FakeAdapter:
    """In-memory SPI driver used by boundary tests and local demos."""

    def __init__(
        self,
        config_dir: str = "",
        *,
        usage_events: Sequence[UsageEvent] | None = None,
        healthy: bool = True,
    ) -> None:
        self.config_dir = config_dir
        self._usage_events = tuple(
            _default_usage_events() if usage_events is None else usage_events
        )
        self._healthy = bool(healthy)
        self._current: Artifact | None = None
        self._history: dict[str, Artifact] = {}
        self._payloads: dict[str, LogPayload] = {}
        self._credentials: dict[str, str] = {}
        self._telemetry_app: Any = None
        self._telemetry_sink: AttemptSink | None = None
        self.pruned_retention_days: list[int] = []

    # --- core SPI ---------------------------------------------------------

    def describe(self) -> AdapterInfo:
        return AdapterInfo(
            adapter_id="fake",
            version=_FAKE_VERSION,
            capabilities=_FAKE_CAPABILITIES,
        )

    def validate(self, ir: GatewayIR) -> ValidationResult:
        return validate_gateway_ir(ir)

    def render(self, ir: GatewayIR) -> Artifact:
        payload: dict[str, Any] = {
            "revision": ir.revision,
            "providers": [
                {"id": upstream.id, "baseUrl": upstream.base_url}
                for upstream in ir.upstreams
            ],
            "models": [model.id for model in ir.models],
            "publicModels": [
                {"name": public.name, "targets": [target.id for target in public.targets]}
                for public in ir.public_models
            ],
            "apiKeys": [key.id for key in ir.api_keys],
        }
        return make_artifact(to_yaml(payload), revision=ir.revision)

    def apply(self, artifact: Artifact) -> ApplyResult:
        self._current = artifact
        if artifact.revision:
            self._history[artifact.revision] = artifact
        if self.config_dir:
            os.makedirs(self.config_dir, exist_ok=True)
            fd, tmp_path = tempfile.mkstemp(dir=self.config_dir, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(artifact.content)
            os.replace(tmp_path, os.path.join(self.config_dir, "config.yaml"))
        return ApplyResult(
            ok=True,
            applied_hash=artifact.hash,
            revision_id=artifact.revision or None,
            validation_note="fake adapter: no external validation gate",
        )

    def status(self) -> DataPlaneStatus:
        return DataPlaneStatus(
            config_hash=self._current.hash if self._current else None,
            process_version=_FAKE_VERSION,
            listening=self._current is not None,
            detail="in-memory fake adapter",
        )

    def usage(self, cursor: UsageCursor | None) -> UsagePage:
        start = int(cursor.value) if cursor is not None else 0
        window = list(self._usage_events[start : start + 50])
        next_index = start + len(window)
        next_cursor = (
            UsageCursor(value=str(next_index))
            if next_index < len(self._usage_events)
            else None
        )
        return UsagePage(events=tuple(window), next_cursor=next_cursor)

    def health(self) -> HealthSnapshot:
        return HealthSnapshot(
            healthy=self._healthy,
            detail="fake adapter healthy" if self._healthy else "fake adapter unhealthy",
            checked_at_ms=now_ms(),
        )

    def rollback(self, revision_id: str) -> ApplyResult:
        target = self._history.get(revision_id)
        if target is None:
            return ApplyResult(ok=False, message=f"unknown revision: {revision_id}")
        self._current = target
        return ApplyResult(ok=True, applied_hash=target.hash, revision_id=revision_id)

    # --- six W6 ports -----------------------------------------------------

    def read_log_payload(self, event_id: str) -> LogPayload | None:
        return self._payloads.get(event_id)

    def prune_logs(self, retention_days: int) -> dict[str, int]:
        days = max(1, int(retention_days))
        self.pruned_retention_days.append(days)
        removed = len(self._payloads)
        self._payloads.clear()
        return {"request_logs": 0, "request_log_payloads": removed}

    def preview_transforms(self, spec: TransformsSpec) -> TransformPreview:
        return TransformPreview(
            after={"fake": True, "rules": 0},
            notes=("fake adapter: transform preview is in-memory",),
        )

    def materialize_credentials(
        self, files: Sequence[CredentialFile], *, dry_run: bool = False
    ) -> MaterializationResult:
        requested = {file.ref: file.plaintext for file in files}
        stale = tuple(sorted(set(self._credentials) - set(requested)))
        if dry_run:
            return MaterializationResult(dry_run=True, stale=stale)
        self._credentials = requested
        return MaterializationResult(
            written=tuple(file.ref for file in files),
            stale=stale,
            deleted=stale,
        )

    def client_contract(self) -> ClientContract:
        return ClientContract(
            default_port=0,
            endpoints=(
                ClientEndpoint("/v1/chat/completions", ("POST",), "chat.completions"),
                ClientEndpoint("/v1/models", ("GET",), "models.list"),
                ClientEndpoint("/v1/embeddings", ("POST",), "embeddings.create"),
            ),
        )

    def capability_note(self, key: str) -> str:
        for capability in _FAKE_CAPABILITIES:
            if capability.key == key:
                return capability.note
        return ""

    # --- telemetry lifecycle ---------------------------------------------

    def start_telemetry(self, app: Any, sink: AttemptSink) -> TelemetryHandle | None:
        self._telemetry_app = app
        self._telemetry_sink = sink
        return self

    def stop_telemetry(self, handle: TelemetryHandle | None) -> None:
        if handle is not None:
            handle.stop()

    def stop(self) -> None:
        """Stop the in-memory telemetry attachment (idempotent)."""
        self._telemetry_sink = None

    @property
    def telemetry_sink(self) -> AttemptSink | None:
        return self._telemetry_sink

    # --- test helpers -----------------------------------------------------

    def seed_payload(
        self,
        event_id: str,
        *,
        request_prompt_json: str = "",
        response_completion_json: str = "",
    ) -> None:
        self._payloads[event_id] = LogPayload(
            event_id=event_id,
            request_prompt_json=request_prompt_json,
            response_completion_json=response_completion_json,
        )

    def seed_usage(self, events: Sequence[UsageEvent]) -> None:
        self._usage_events = tuple(events)

    def emit_attempts(self, attempts: Sequence[RequestAttempt]) -> int:
        """Test seam: hand normalized attempts to the attached sink (if any)."""
        if self._telemetry_sink is None:
            return 0
        return int(self._telemetry_sink(attempts))
