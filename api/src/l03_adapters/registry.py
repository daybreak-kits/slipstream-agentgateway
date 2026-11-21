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
    """Instantiate a registered driver; unknown names are a config error.

    Factories are self-configured (ADR-029 ticket 04): each driver pulls its own
    deployment namespace, so callers never shape per-driver kwargs and the
    composition root never branches on the adapter name. Optional kwargs stay
    as explicit overrides for direct construction (tests, embedders).
    """
    factory = _FACTORIES.get(name)
    if factory is None:
        if name == "mock":
            from l03_adapters.mock import MockAdapter

            register("mock", _deployment_backed(MockAdapter))
            factory = _FACTORIES[name]
        elif name == "fake":
            from l03_adapters.fake import FakeAdapter

            register("fake", _deployment_backed(FakeAdapter))
            factory = _FACTORIES[name]
        elif name == "agentgateway":
            from l03_adapters.agentgateway.factory import from_deployment

            register("agentgateway", from_deployment)
            factory = _FACTORIES[name]
        else:
            raise AppError(
                ErrorCode.VALIDATION_ERROR, f"未知的数据面适配器: {name}", details={"adapter": name}
            )
    return factory(**kwargs)


def _deployment_backed(driver_class: Any) -> Any:
    """Wrap a config-dir driver so the neutral setting feeds construction.

    ``data_plane_config_dir`` is the one neutral deployment knob (core
    settings); drivers that take ``config_dir`` default to it here, keeping the
    pre-namespace behavior for mock/fake deployments.
    """

    def factory(**kwargs: Any) -> Any:
        from l01_core.settings import get_settings

        kwargs.setdefault("config_dir", get_settings().data_plane_config_dir)
        return driver_class(**kwargs)

    return factory


def start_telemetry(app: Any, sink: Any, adapter: Any) -> Any:
    """Start the injected adapter's optional telemetry intake on the app lifespan.

    The registry owns the lifecycle seam, but the transport stays inside the
    adapter: no composition-root branch ever names a concrete driver (W6
    ticket 01; ADR-028/ADR-029). Each driver returns a stoppable handle or None.
    """
    return adapter.start_telemetry(app, sink)


__all__ = ["create", "register", "start_telemetry"]
