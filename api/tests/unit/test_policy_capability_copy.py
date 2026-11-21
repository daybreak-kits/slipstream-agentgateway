"""Capability copy comes from the adapter port (W6 ticket 05, ADR-029).

The system may decide *whether* a capability is supported (neutral key lookup),
but the user-facing wording is adapter knowledge: a data-plane version statement
like "AG 1.7 ..." must never be hardcoded in a system service. The stub driver
here declares its own copy and the service must pass it through verbatim.
"""

from __future__ import annotations

from l02_domain.validation import ValidationResult, validate_gateway_ir
from l03_adapters.fake import FakeAdapter
from l03_adapters.spi import AdapterInfo, Capability, DataPlaneAdapter
from l05_service.policies import MCP_NOTE, mcp_spec

_STUB_NOTE = "stub: mcp targets live top-level; sse/stdio verified"


class _StubAdapter(DataPlaneAdapter):
    """Minimal driver whose mcp.targets note differs from every built-in copy."""

    def describe(self) -> AdapterInfo:
        return AdapterInfo(
            adapter_id="stub",
            version="stub-1.0.0",
            capabilities=(Capability("mcp.targets", True, "1.0.0", _STUB_NOTE),),
        )

    def validate(self, ir) -> ValidationResult:  # pragma: no cover - not used here
        return validate_gateway_ir(ir)

    def capability_note(self, key: str) -> str:
        for capability in self.describe().capabilities:
            if capability.key == key:
                return capability.note
        return ""


def test_mcp_note_without_an_adapter_stays_the_neutral_fallback() -> None:
    spec = mcp_spec(None)
    assert spec.supported is False
    assert spec.note == MCP_NOTE
    assert "AG" not in spec.note


def test_mcp_note_comes_from_the_adapter_capability_note_port() -> None:
    spec = mcp_spec(_StubAdapter())
    assert spec.supported is True
    # The copy is the adapter's own wording, not a system-side constant.
    assert spec.note == _STUB_NOTE


def test_fake_adapter_serves_its_own_capability_copy() -> None:
    adapter = FakeAdapter()
    spec = mcp_spec(adapter)
    assert spec.supported is True
    assert spec.note == adapter.capability_note("mcp.targets")
    assert spec.note  # the fake must provide a non-empty copy through the port
