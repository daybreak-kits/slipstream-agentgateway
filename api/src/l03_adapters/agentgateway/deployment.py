"""Agentgateway deployment settings (the adapter's own config namespace).

ADR-029 keeps core Settings neutral: the data-plane-specific knobs live here,
in the adapter namespace, while their environment surface stays stable for
operators (the W6 ticket 04 migration policy):

* ``SLIPSTREAM_AG_CONFIG_DIR`` - deprecated alias of the neutral
  ``SLIPSTREAM_DATA_PLANE_CONFIG_DIR``; still honoured, documented in
  ``l01_core.settings``;
* ``SLIPSTREAM_AG_CONFIG_FILENAME`` / ``SLIPSTREAM_AG_LLM_PORT`` /
  ``SLIPSTREAM_AG_DB_PATH`` / ``SLIPSTREAM_AG_BINARY`` - unchanged names, now
  consumed by this module instead of core Settings.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from l01_core.settings import dotenv_candidates

#: File name of the agentgateway log SQLite DB inside the config dir. AG
#: resolves the rendered relative URL next to its config file; the adapter
#: namespace owns this format, system layers never spell it.
LOG_DB_FILENAME = "ag-data.db"


class AgentGatewayDeployment(BaseSettings):
    """Deployment knobs only the agentgateway driver (and its renderer) consume."""

    model_config = SettingsConfigDict(env_prefix="SLIPSTREAM_AG_", extra="ignore")

    def __init__(self, **data: object) -> None:
        # Same dotenv policy as core settings: repo-root .env then CWD .env,
        # with real environment variables still winning.
        data.setdefault("_env_file", dotenv_candidates())
        super().__init__(**data)

    config_filename: str = "config.yaml"
    llm_port: int = 3600
    # Explicit log DB path override; None/"" means "AG default next to config".
    db_path: str | None = None
    # Official binary for the pre-apply --validate-only gate: None auto-detects
    # the pinned path, "" disables the gate explicitly.
    binary: str | None = None

    @property
    def render_log_db_url(self) -> str:
        """The database.url rendered into the config artifact.

        An explicit SLIPSTREAM_AG_DB_PATH wins; otherwise the AG-relative file
        name is rendered exactly as before the namespace migration.
        """
        return self.db_path or LOG_DB_FILENAME


@lru_cache
def get_deployment() -> AgentGatewayDeployment:
    """Process-wide deployment settings singleton (env-backed)."""
    return AgentGatewayDeployment()


def reset_deployment_cache() -> None:
    """Drop the cached deployment singleton (tests and hot reloads)."""
    get_deployment.cache_clear()
