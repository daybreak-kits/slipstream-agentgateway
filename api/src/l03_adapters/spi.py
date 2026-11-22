"""DataPlaneAdapter SPI (docs/SYSTEM-BOUNDARY.md, docs/contracts/adapter-spi.md).

Upper layers (l05_service/l06_api/l07_jobs) program against this Protocol only;
concrete drivers (mock, fake, agentgateway) register themselves in
l03_adapters.registry. The standard ports added in W6 ticket 01 keep every
data-plane-specific fact behind the adapter boundary: log payload reads, log
retention, transform compile previews, transform sample replay, credential
materialization, the client contract and capability copy. AttemptSink and the
telemetry lifecycle are part of this same contract (ADR-028/ADR-029).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from l02_domain.ir import IR_VERSION, GatewayIR, TransformsSpec
from l02_domain.models import AttemptSink, RequestAttempt
from l02_domain.validation import ValidationResult

# Re-exported: the result type is gateway-agnostic, so it lives in l02 (l02 may
# not import l03). Drivers and tests keep importing it from here.
__all__ = [
    "AdapterInfo",
    "ApplyResult",
    "Artifact",
    "AttemptSink",
    "Capability",
    "ClientContract",
    "ClientEndpoint",
    "CredentialFile",
    "DataPlaneAdapter",
    "DataPlaneStatus",
    "HealthSnapshot",
    "LogPayload",
    "MaterializationResult",
    "RequestAttempt",
    "TelemetryHandle",
    "TransformPreview",
    "TransformSampleResult",
    "UsageCursor",
    "UsagePage",
    "ValidationResult",
    "make_artifact",
]


@dataclass(frozen=True, slots=True)
class Capability:
    """Declarative capability entry; unverified capabilities must render as greyed out."""

    key: str
    supported: bool
    since_version: str
    note: str = ""
    verified: bool = False


@dataclass(frozen=True, slots=True)
class AdapterInfo:
    adapter_id: str
    version: str
    ir_versions: tuple[str, ...] = (IR_VERSION,)
    capabilities: tuple[Capability, ...] = ()


@dataclass(frozen=True, slots=True)
class Artifact:
    """Rendered configuration payload plus its content hash (sha256 hex of `content`)."""

    content: str
    hash: str
    media_type: str = "application/yaml"
    encoding: str = "utf-8"
    revision: str = ""


@dataclass(frozen=True, slots=True)
class ApplyResult:
    ok: bool
    applied_hash: str | None = None
    message: str = ""
    rolled_back: bool = False
    revision_id: str | None = None
    # Ticket 08: displayable binary/validation errors (APPLY_FAILED details), the
    # real on-disk sha256 recorded after apply, and the recorded gate note (a
    # skipped --validate-only is never silent).
    errors: tuple[str, ...] = ()
    file_hash: str | None = None
    validation_note: str = ""


@dataclass(frozen=True, slots=True)
class DataPlaneStatus:
    config_hash: str | None
    process_version: str = "unknown"
    listening: bool = False
    detail: str = ""


@dataclass(frozen=True, slots=True)
class UsageCursor:
    """Opaque position inside the data plane's append-only usage log."""

    value: str


@dataclass(frozen=True, slots=True)
class UsagePage:
    events: tuple[Any, ...] = ()
    next_cursor: UsageCursor | None = None


@dataclass(frozen=True, slots=True)
class HealthSnapshot:
    healthy: bool
    detail: str = ""
    checked_at_ms: int = 0


# ---------------------------------------------------------------------------
# W6 ticket 01: the six standard ports. The shapes below are deliberately
# data-plane neutral; concrete wire formats never appear in a system contract.


@dataclass(frozen=True, slots=True)
class LogPayload:
    """Stored request/response bodies for one usage-event id (adapter-owned store)."""

    event_id: str
    request_prompt_json: str = ""
    response_completion_json: str = ""

    def as_dict(self) -> dict[str, str]:
        """The wire shape the existing logs-payload API exposes."""
        return {
            "event_id": self.event_id,
            "request_prompt_json": self.request_prompt_json,
            "response_completion_json": self.response_completion_json,
        }


@dataclass(frozen=True, slots=True)
class TransformPreview:
    """A compiled transform preview; `after` stays adapter-shaped but JSON-safe."""

    after: dict[str, Any] = field(default_factory=dict)
    skipped: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TransformSampleResult:
    """A read-only sample replay; the neutral before/after snapshots plus field diffs."""

    before: dict[str, Any] = field(default_factory=dict)
    after: dict[str, Any] = field(default_factory=dict)
    diff: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True, slots=True)
class CredentialFile:
    """One credential the adapter may materialize into its own managed location.

    `ref` is the neutral domain reference (e.g. provider/key sequence); `path`
    is an adapter-owned destination hint and empty means "adapter chooses".
    Plaintext is handed to the adapter only at this boundary and is never
    persisted by the system layer.
    """

    ref: str
    plaintext: str = ""
    path: str = ""


@dataclass(frozen=True, slots=True)
class MaterializationResult:
    """Audit of one credential materialize/prune pass (dry-run friendly)."""

    dry_run: bool = False
    written: tuple[str, ...] = ()
    stale: tuple[str, ...] = ()
    deleted: tuple[str, ...] = ()
    failed: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ClientEndpoint:
    """One endpoint a system client may call; purpose is a neutral capability key."""

    path: str
    methods: tuple[str, ...] = ("POST",)
    purpose: str = ""


@dataclass(frozen=True, slots=True)
class ClientContract:
    """The adapter-owned client-side facts for connection/health/playground."""

    default_port: int = 0
    scheme: str = "http"
    base_url_hint: str = ""
    endpoints: tuple[ClientEndpoint, ...] = ()
    health_path: str = ""

    def endpoint_paths(self) -> tuple[str, ...]:
        return tuple(endpoint.path for endpoint in self.endpoints)

    def endpoint_for(self, purpose: str) -> ClientEndpoint | None:
        """First endpoint declared for one neutral purpose key (None when absent)."""
        for endpoint in self.endpoints:
            if endpoint.purpose == purpose:
                return endpoint
        return None

    def base_url(self) -> str:
        """The client-callable data-plane root.

        Adapters that do not share the control-plane host set ``base_url_hint``;
        the co-location default keeps system code from building addresses.
        """
        if self.base_url_hint:
            return self.base_url_hint.rstrip("/")
        return f"{self.scheme}://127.0.0.1:{self.default_port}"

    def health_fields(self) -> dict[str, int]:
        """Legacy /admin/health wire fields sourced from this contract.

        The ``data_plane_port`` key predates ADR-029 and the console renders it,
        so the wire shape stays byte-stable while the value moves to the adapter;
        the key is owned here at the adapter boundary, not in a system router.
        """
        return {"data_plane_port": self.default_port}


@runtime_checkable
class TelemetryHandle(Protocol):
    """Lifecycle handle returned by an adapter telemetry attachment."""

    def stop(self) -> None: ...


@runtime_checkable
class DataPlaneAdapter(Protocol):
    """The eight business methods plus the standard ports and telemetry lifecycle."""

    def describe(self) -> AdapterInfo: ...

    def validate(self, ir: GatewayIR) -> ValidationResult: ...

    def render(self, ir: GatewayIR) -> Artifact: ...

    def apply(self, artifact: Artifact) -> ApplyResult: ...

    def status(self) -> DataPlaneStatus: ...

    def usage(self, cursor: UsageCursor | None) -> UsagePage: ...

    def health(self) -> HealthSnapshot: ...

    def rollback(self, revision_id: str) -> ApplyResult: ...

    # --- W6 ticket 01 ports -------------------------------------------------

    def read_log_payload(self, event_id: str) -> LogPayload | None:
        """Read one stored request payload; None when the adapter has none."""
        ...

    def prune_logs(self, retention_days: int) -> dict[str, int]:
        """Apply the adapter-owned log retention pass; returns per-table counts."""
        ...

    def preview_transforms(self, spec: TransformsSpec) -> TransformPreview:
        """Compile a transform spec inside the adapter; no data plane write."""
        ...

    def replay_transform_sample(
        self,
        spec: TransformsSpec,
        *,
        request: dict[str, Any] | None = None,
        response: dict[str, Any] | None = None,
    ) -> TransformSampleResult:
        """Replay a transform spec against pasted samples; read-only, no upstream call.

        The replay semantics are adapter-owned (they mirror the compiled behavior
        documented in docs/contracts/transforms-compiler.md); the system layer sees
        only the neutral before/after snapshots and field diffs.
        """
        ...

    def materialize_credentials(
        self,
        files: Sequence[CredentialFile],
        *,
        dry_run: bool = False,
        prune: bool = True,
        prune_only: bool = False,
    ) -> MaterializationResult:
        """Write/prune adapter-managed credential files; system keeps metadata only.

        Three pass shapes: the default writes the whitelist and prunes managed
        files outside it; ``prune=False`` writes only, so a rollout can
        materialize the credentials the candidate config references before its
        apply gate runs; ``prune_only=True`` runs the whitelist cleanup WITHOUT
        writing any file -- the bytes are already on disk from the write phase,
        so the post-apply cleanup must not rewrite them (W6 review P2-1).
        prune_only implies pruning.
        """
        ...

    def client_contract(self) -> ClientContract:
        """Endpoint/port facts connection, health and playground must not hardcode."""
        ...

    def capability_note(self, key: str) -> str:
        """Adapter-provided copy for one neutral capability key ('' when unknown)."""
        ...

    def start_telemetry(self, app: Any, sink: AttemptSink) -> TelemetryHandle | None:
        """Attach the adapter-owned telemetry intake; returns a stoppable handle."""
        ...

    def stop_telemetry(self, handle: TelemetryHandle | None) -> None:
        """Release one telemetry handle (idempotent; None is a no-op)."""
        ...


def make_artifact(
    content: str, *, media_type: str = "application/yaml", revision: str = ""
) -> Artifact:
    """Build an Artifact, computing the sha256 hash drivers must report back on status."""
    import hashlib

    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return Artifact(content=content, hash=digest, media_type=media_type, revision=revision)
