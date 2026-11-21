"""Deployment-aware construction for the agentgateway driver.

The registry registers :func:`from_deployment` as this driver's factory, so the
composition root never shapes per-driver kwargs and never branches on the
adapter name (ADR-029, docs/SYSTEM-BOUNDARY.md section 5.2). Overrides keep the
direct-construction path (tests, embedders) working without env coupling.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from l01_core.settings import get_settings
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.agentgateway.deployment import (
    LOG_DB_FILENAME,
    get_deployment,
)


def from_deployment(**overrides: Any) -> AgentgatewayAdapter:
    """Build the agentgateway driver from its own namespace.

    ``config_dir`` comes from the neutral ``data_plane_config_dir`` setting (the
    only directory the control plane may write); the remaining knobs come from
    ``AgentGatewayDeployment``. Keyword overrides win for callers that must pin
    a value (tests, embedded uses).
    """
    settings = get_settings()
    deployment = get_deployment()
    config_dir = overrides.pop("config_dir", None) or settings.data_plane_config_dir
    explicit_db_path = overrides.pop("ag_db_path", None)
    return AgentgatewayAdapter(
        config_dir=config_dir,
        filename=overrides.pop("config_filename", deployment.config_filename),
        ag_db_path=(
            explicit_db_path
            or deployment.db_path
            or str(Path(config_dir) / LOG_DB_FILENAME)
        ),
        ag_binary=overrides.pop("ag_binary", deployment.binary),
        llm_port=overrides.pop("llm_port", deployment.llm_port),
    )
