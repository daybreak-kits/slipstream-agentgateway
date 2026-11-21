"""Adapter construction for the composition layers (routers + jobs).

l05_service renders and applies configurations but must not import a concrete
driver (S2: no reverse dependency), so the deployment wiring lives here and the
resulting adapter is injected into build_render_plan and Rollout.apply/rollback.

Both l06_api and l07_jobs may import this module (downward: 6 < 7).

ADR-029 (ticket 04): the factory names no concrete driver and shapes no
per-driver kwargs. The registry resolves the configured adapter and each driver
reads its own deployment namespace; the composition root only supplies the
neutral selection knob (``data_plane_adapter``).
"""

from __future__ import annotations

from l01_core.settings import Settings, get_settings
from l03_adapters.registry import create
from l03_adapters.spi import DataPlaneAdapter


def get_adapter() -> DataPlaneAdapter:
    """Default composition-layer driver for request dependencies and jobs."""
    return make_adapter(get_settings())


def make_adapter(settings: Settings) -> DataPlaneAdapter:
    """Instantiate the configured data-plane driver via the registry.

    Only neutral facts cross the boundary: the driver selection plus the one
    writable deployment directory. Every driver accepts ``config_dir``; the
    data-plane-specific knobs (config filename, client port, log DB path,
    binary) are resolved inside the adapter namespace (ADR-029 ticket 04).
    """
    return create(
        settings.data_plane_adapter,
        config_dir=settings.data_plane_config_dir,
    )
