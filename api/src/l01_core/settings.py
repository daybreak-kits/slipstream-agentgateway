"""Application settings (pydantic-settings); every knob is an SLIPSTREAM_* env var."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # real deployments MUST override SLIPSTREAM_ADMIN_PASSWORD.
    admin_username: str = "admin"
    admin_password: str = "admin12345"

    # Client keys: sk- + N chars; canonical lengths use uppercase A-Z0-9._-.
    client_key_prefix: str = "sk-"
    client_key_length: int = 64

    # Billing (ADR-011): amounts are integer micro units; reports convert into
    # report_currency via manual fx_snapshots. The data-plane bucket is token
    # denominated, so rendering derives bucket tokens = balance_micro // micro_per_token.
    report_currency: str = "CNY"
    bucket_micro_per_token: int = 1000

    # Background job cadence (seconds).
    usage_poll_seconds: float = 30.0
    rerender_poll_seconds: float = 30.0

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


@lru_cache
def get_settings() -> Settings:
    """Process-wide settings singleton (env-backed)."""
    return Settings()


def reset_settings_cache() -> None:
    """Drop the cached settings singleton (tests and hot reloads)."""
    get_settings.cache_clear()
