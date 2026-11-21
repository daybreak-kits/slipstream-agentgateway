"""Driver registry: l05_service asks for a driver by name, never by importing one."""

from __future__ import annotations

from typing import Any

from l01_core.errors import AppError, ErrorCode
from l03_adapters.spi import DataPlaneAdapter

_FACTORIES: dict[str, Any] = {}


def register(name: str, factory: Any) -> None:
    """Register a driver factory `factory(**kwargs) -> DataPlaneAdapter`."""
    _FACTORIES[name] = factory


def create(name: str, **kwargs: Any) -> DataPlaneAdapter:
    """Instantiate a registered driver; unknown names are a config error."""
    factory = _FACTORIES.get(name)
    if factory is None:
        if name == "mock":
            from l03_adapters.mock import MockAdapter

            register("mock", lambda **kw: MockAdapter(**kw))
            factory = _FACTORIES[name]
        elif name == "fake":
            from l03_adapters.fake import FakeAdapter

            register("fake", lambda **kw: FakeAdapter(**kw))
            factory = _FACTORIES[name]
        elif name == "agentgateway":
            from l03_adapters.agentgateway.adapter import AgentgatewayAdapter

            register("agentgateway", lambda **kw: AgentgatewayAdapter(**kw))
            factory = _FACTORIES[name]
        else:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, f"未知的数据面适配器: {name}", details={"adapter": name}
            )
    return factory(**kwargs)


def start_telemetry(app: Any, sink: Any, adapter: Any) -> Any:
    """Start the injected adapter's optional telemetry intake on the app lifespan.

    The registry owns the lifecycle seam, but the transport stays inside the
    adapter: no composition-root branch ever names a concrete driver (W6
    ticket 01; ADR-028/ADR-029). Each driver returns a stoppable handle or None.
    """
    return adapter.start_telemetry(app, sink)


__all__ = ["create", "register", "start_telemetry"]
