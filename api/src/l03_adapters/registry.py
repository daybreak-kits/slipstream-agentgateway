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
        elif name == "agentgateway":
            from l03_adapters.agentgateway.adapter import AgentgatewayAdapter

            register("agentgateway", lambda **kw: AgentgatewayAdapter(**kw))
            factory = _FACTORIES[name]
        else:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, f"未知的数据面适配器: {name}", details={"adapter": name}
            )
    return factory(**kwargs)



def start_telemetry(app: Any, sink: Any, settings: Any) -> Any:
    """Start the selected adapter's optional telemetry intake on the app lifespan.

    The composition root knows the adapter name but not its telemetry transport;
    each driver owns its collection mechanism and returns a handle (or None).
    """
    name = getattr(settings, "data_plane_adapter", "")
    if name == "agentgateway":
        from l03_adapters.agentgateway.telemetry import wire_telemetry

        return wire_telemetry(app, sink)
    return None


__all__ = ["create", "register", "start_telemetry"]
