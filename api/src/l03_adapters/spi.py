"""DataPlaneAdapter SPI (docs/contracts/adapter-spi.md).

Upper layers (l05_service/l07_jobs) program against this Protocol only; concrete
drivers (mock, agentgateway) register themselves in l03_adapters.registry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from l02_domain.ir import IR_VERSION, GatewayIR

# Re-exported: the result type is gateway-agnostic, so it lives in l02 (l02 may
# not import l03). Drivers and tests keep importing it from here.
from l02_domain.validation import ValidationResult


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


@runtime_checkable
class DataPlaneAdapter(Protocol):
    """The eight SPI methods; semantics per docs/contracts/adapter-spi.md §2."""

    def describe(self) -> AdapterInfo: ...

    def validate(self, ir: GatewayIR) -> ValidationResult: ...

    def render(self, ir: GatewayIR) -> Artifact: ...

    def apply(self, artifact: Artifact) -> ApplyResult: ...

    def status(self) -> DataPlaneStatus: ...

    def usage(self, cursor: UsageCursor | None) -> UsagePage: ...

    def health(self) -> HealthSnapshot: ...

    def rollback(self, revision_id: str) -> ApplyResult: ...


def make_artifact(
    content: str, *, media_type: str = "application/yaml", revision: str = ""
) -> Artifact:
    """Build an Artifact, computing the sha256 hash drivers must report back on status."""
    import hashlib

    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return Artifact(content=content, hash=digest, media_type=media_type, revision=revision)
