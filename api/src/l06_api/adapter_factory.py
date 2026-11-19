"""Adapter construction for the composition layers (routers + jobs).

l05_service renders and applies configurations but must not import a concrete
driver (S2: no reverse dependency), so the deployment wiring lives here and the
resulting adapter is injected into build_render_plan and Rollout.apply/rollback.

Both l06_api and l07_jobs may import this module (downward: 6 < 7).
"""

from __future__ import annotations

from l01_core.settings import Settings, get_settings
from l03_adapters.registry import create
from l03_adapters.spi import DataPlaneAdapter


def get_adapter() -> DataPlaneAdapter:
    """Default composition-layer driver for request dependencies and jobs."""
    return make_adapter(get_settings())


def make_adapter(settings: Settings) -> DataPlaneAdapter:
    """Instantiate the configured data-plane driver with its deployment kwargs."""
    if settings.data_plane_adapter == "agentgateway":
        return create(
            "agentgateway",
            config_dir=settings.ag_config_dir,
            filename=settings.ag_config_filename,
            ag_db_path=settings.ag_log_db_path,
            ag_binary=settings.ag_binary,
        )
    return create(settings.data_plane_adapter, config_dir=settings.ag_config_dir)
