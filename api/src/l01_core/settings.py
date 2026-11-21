"""Application settings (pydantic-settings).

Every knob is an SLIPSTREAM_* environment variable, including the bootstrap
admin pair (SLIPSTREAM_ADMIN_USERNAME / SLIPSTREAM_ADMIN_PASSWORD).
Configuration may also come from a .env file: the repository-root .env is
loaded first, then the current working directory .env (the closer file wins).
Real process environment variables always win over .env values.

ADR-029 namespace policy (W6 ticket 04): this model carries neutral run config
only. Data-plane-specific deployment knobs moved to the adapter namespace
(``l03_adapters.agentgateway.deployment``), which keeps the historical
environment names:

* ``SLIPSTREAM_DATA_PLANE_CONFIG_DIR`` - the one neutral deployment location
  (the only directory the control plane writes). ``SLIPSTREAM_AG_CONFIG_DIR``
  stays honoured as a deprecated alias so existing deployments keep working;
  the neutral name wins when both are set (migration, not rejection).
* ``SLIPSTREAM_AG_CONFIG_FILENAME`` / ``SLIPSTREAM_AG_LLM_PORT`` /
  ``SLIPSTREAM_AG_DB_PATH`` / ``SLIPSTREAM_AG_BINARY`` - unchanged names, now
  consumed by the adapter namespace instead of this model.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Fallback retention window when the operator setting is absent/invalid.
DEFAULT_LOG_RETENTION_DAYS = 30

#: Repository root, derived from this file (api/src/l01_core/settings.py).
_REPO_ROOT = Path(__file__).resolve().parents[3]


def dotenv_candidates() -> tuple[Path, ...]:
    """Return existing .env files in precedence order (lowest priority first).

    BaseSettings gives later files priority, so the CWD file is last. The real
    process environment is still consulted before any dotenv value, which is
    pydantic-settings default and is what the "system env > .env" rule requires.
    """
    candidates = [_REPO_ROOT / ".env", Path.cwd() / ".env"]
    seen: set[Path] = set()
    resolved: list[Path] = []
    for candidate in candidates:
        try:
            normalized = candidate.resolve()
        except OSError:
            continue
        if normalized in seen or not normalized.is_file():
            continue
        seen.add(normalized)
        resolved.append(normalized)
    return tuple(resolved)


class Settings(BaseSettings):
    """Control-plane settings; defaults match docs/PLAN.md section 3 (control plane on 3700)."""

    model_config = SettingsConfigDict(
        env_prefix="SLIPSTREAM_", extra="ignore", populate_by_name=True
    )

    def __init__(self, **data: object) -> None:
        # Load .env from the repo root and the process CWD. Passing an explicit
        # _env_file also makes direct Settings(...) calls in tests honour dotenv;
        # environment variables keep their higher priority.
        data.setdefault("_env_file", dotenv_candidates())
        super().__init__(**data)

    host: str = "127.0.0.1"
    port: int = 3700
    log_level: str = "INFO"

    # Local data root (gitignored): SQLite DB and agentgateway config live under .data_store.
    database_url: str = "sqlite:///./.data_store/slipstream.db"

    # Neutral data-plane deployment knobs (ADR-029): the adapter selection plus
    # the one directory the control plane may write. Data-plane-specific shapes
    # (config filename, client port, log DB path, binary) live in the adapter
    # namespace; see the module docstring for the env migration policy.
    data_plane_adapter: str = "agentgateway"
    data_plane_config_dir: str = Field(
        default="./.data_store/ag-config",
        validation_alias=AliasChoices(
            "SLIPSTREAM_DATA_PLANE_CONFIG_DIR", "SLIPSTREAM_AG_CONFIG_DIR"
        ),
    )

    # Single-port deployment: admin UI static assets; empty = auto-detect <repo>/web/dist.
    web_dist_dir: str = ""

    # At-rest encryption master secret; MUST be overridden in real deployments.
    secret_key: str = "dev-only-change-me"

    # Console auth: DB-backed session + httpOnly cookie. Session
    # lifetime is absolute (no sliding renewal); secure must be on behind TLS.
    session_ttl_seconds: int = 43_200  # 12h
    cookie_secure: bool = False
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 60

    # ADR-019 bootstrap: the initial full-permission admin is created from env
    # ONLY while no admin-role user with a password exists; afterwards the
    # account lives in the database and these values are never consulted again.
    # The defaults keep the local demo working (previously hardcoded in seed);
    # real deployments MUST override SLIPSTREAM_ADMIN_PASSWORD.
    admin_username: str = "admin"
    admin_password: str = "admin"

    # Client keys: sk- + N chars; canonical lengths use uppercase A-Z0-9._-.
    client_key_prefix: str = "sk-"
    client_key_length: int = 64

    # Billing (ADR-011): amounts are integer micro units; reports convert into
    # report_currency via manual fx_snapshots. The data-plane bucket is token
    # denominated, so rendering derives bucket tokens = balance_micro // micro_per_token.
    report_currency: str = "CNY"
    bucket_micro_per_token: int = 1000

    # Background job cadence (seconds). The app starts one JobRunner in-process
    # with these intervals; SLIPSTREAM_JOBS_ENABLED=0 disables it entirely (tests
    # and any deployment that runs the jobs as a separate worker).
    jobs_enabled: bool = True
    job_interval_seconds: float = 60.0

    # W4-H models.dev snapshot source. The URL is a knob so a mirror can be
    # pointed at without a code change; the adopt pass degrades to the last
    # stored snapshot whenever the fetch fails.
    models_dev_url: str = "https://models.dev/api.json"
    models_dev_timeout_seconds: float = 30.0

    @model_validator(mode="after")
    def _resolve_config_dir(self) -> Settings:
        """把数据面配置目录归一化为绝对路径。

        data_plane_config_dir 同时出现在两处：控制面写 key 文件与配置 artifact
        的落盘路径，以及适配器渲染进配置里的资源路径。具体数据面按「配置文件
        所在目录」解析相对路径时会出现双层目录，导致 --validate-only 直接拒绝、
        apply 返回 502。统一按进程 CWD 解析成绝对路径即可避免。
        """
        self.data_plane_config_dir = str(
            Path(self.data_plane_config_dir).expanduser().resolve()
        )
        return self


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton (env-backed)."""
    return Settings()


def reset_settings_cache() -> None:
    """Drop the cached settings singleton (tests and hot reloads)."""
    get_settings.cache_clear()
