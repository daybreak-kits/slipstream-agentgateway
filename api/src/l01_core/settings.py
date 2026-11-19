"""Application settings (pydantic-settings); every knob is an SLIPSTREAM_* env var
except the bootstrap admin pair (ADMIN_USERNAME / ADMIN_PASSWORD)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: File name of the agentgateway log SQLite DB inside ag_config_dir. AG resolves the
#: rendered relative "ag-data.db" URL next to its config file; retention and the
#: payload API point at the same file.
DEFAULT_AG_DB_FILENAME = "ag-data.db"

#: Fallback retention window when the operator setting is absent/invalid.
DEFAULT_LOG_RETENTION_DAYS = 30


class Settings(BaseSettings):
    """Control-plane settings; defaults match docs/PLAN.md §3 (control plane on 3700)."""

    model_config = SettingsConfigDict(env_prefix="SLIPSTREAM_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 3700
    log_level: str = "INFO"

    # 本地数据根目录（gitignored）：SQLite 库与 agentgateway 配置都在 .data_store 下。
    database_url: str = "sqlite:///./.data_store/slipstream.db"

    # Data plane adapter selection and its deployment knobs. The control plane only
    # ever writes inside ag_config_dir (the apply whitelist).
    data_plane_adapter: str = "agentgateway"
    ag_config_dir: str = "./.data_store/ag-config"
    ag_config_filename: str = "config.yaml"
    ag_llm_port: int = 3600
    ag_db_path: str | None = None
    # Official binary used for the pre-apply --validate-only gate: unset
    # auto-detects the pinned path, "" disables the gate (recorded on apply).
    ag_binary: str | None = None

    # 单端口部署：管理台静态资源目录；空 = 自动探测 <repo>/web/dist。
    web_dist_dir: str = ""

    # At-rest encryption master secret; MUST be overridden in real deployments.
    secret_key: str = "dev-only-change-me"

    # Console auth (ticket 02): DB-backed session + httpOnly cookie. Session
    # lifetime is absolute (no sliding renewal); secure must be on behind TLS.
    session_ttl_seconds: int = 43_200  # 12h
    cookie_secure: bool = False
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 60

    # ADR-019 bootstrap: the initial full-permission admin is created from .env
    # ONLY while no admin-role user with a password exists; afterwards the
    # account lives in the database and these values are never consulted again.
    # The defaults keep the local demo working (previously hardcoded in seed);
    # real deployments MUST override ADMIN_PASSWORD. These two are the only
    # un-prefixed knobs (validation_alias bypasses env_prefix): a single
    # account/password pair needs no SLIPSTREAM_ namespace.
    admin_username: str = Field(default="admin", validation_alias="ADMIN_USERNAME")
    admin_password: str = Field(default="admin", validation_alias="ADMIN_PASSWORD")

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

        ag_config_dir 同时出现在两处：控制面写 key 文件的落盘路径，以及渲染进
        agentgateway 配置里的资源路径（upstream.apiKey.file）。后者由 agentgateway
        按「配置文件所在目录」解析，相对路径会被拼成 <config_dir>/.data_store/ag-config/...
        的双层路径，--validate-only 直接拒绝、apply 返回 502。统一按进程 CWD 解析成
        绝对路径即可避免。
        """
        self.ag_config_dir = str(Path(self.ag_config_dir).expanduser().resolve())
        return self

    @property
    def ag_log_db_path(self) -> str:
        """Filesystem path of the data-plane request-log DB.

        Explicit ag_db_path wins; otherwise the AG default file inside the
        resolved config dir (the file agentgateway creates for the rendered
        "sqlite:///ag-data.db" URL). Usage ingestion, the payload API and the
        retention job share this one source.
        """
        if self.ag_db_path:
            return self.ag_db_path
        return str(Path(self.ag_config_dir) / DEFAULT_AG_DB_FILENAME)


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton (env-backed)."""
    return Settings()


def reset_settings_cache() -> None:
    """Drop the cached settings singleton (tests and hot reloads)."""
    get_settings.cache_clear()
