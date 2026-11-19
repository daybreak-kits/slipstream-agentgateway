"""Settings 归一化：agentgateway 配置里的资源路径必须能按配置文件目录解析。"""

from __future__ import annotations

import os
from pathlib import Path

from l01_core.settings import get_settings, reset_settings_cache


def _with_env(value: str) -> None:
    os.environ["SLIPSTREAM_AG_CONFIG_DIR"] = value
    reset_settings_cache()


def _restore(previous: str | None) -> None:
    if previous is None:
        os.environ.pop("SLIPSTREAM_AG_CONFIG_DIR", None)
    else:
        os.environ["SLIPSTREAM_AG_CONFIG_DIR"] = previous
    reset_settings_cache()


def test_relative_config_dir_is_resolved_absolute() -> None:
    """默认 ./.data_store/ag-config 会被拼进渲染配置：不转绝对路径会出现两层目录。"""
    previous = os.environ.get("SLIPSTREAM_AG_CONFIG_DIR")
    try:
        _with_env("./.data_store/ag-config")
        config_dir = Path(get_settings().ag_config_dir)
        assert config_dir.is_absolute()
        assert config_dir.name == "ag-config"
    finally:
        _restore(previous)


def test_absolute_config_dir_is_kept() -> None:
    previous = os.environ.get("SLIPSTREAM_AG_CONFIG_DIR")
    try:
        absolute = str(Path.cwd() / ".tmp-ag-config-check")
        _with_env(absolute)
        assert Path(get_settings().ag_config_dir) == Path(absolute)
    finally:
        _restore(previous)


_ADMIN_KEYS = (
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "SLIPSTREAM_ADMIN_USERNAME",
    "SLIPSTREAM_ADMIN_PASSWORD",
)


def test_bootstrap_admin_env_has_no_slipstream_prefix() -> None:
    """ADR-019 引导：ADMIN_USERNAME/ADMIN_PASSWORD 去前缀，旧 SLIPSTREAM_ 名不再生效。"""
    previous = {key: os.environ.get(key) for key in _ADMIN_KEYS}
    try:
        os.environ.update(
            ADMIN_USERNAME="root",
            ADMIN_PASSWORD="s3cret",
            SLIPSTREAM_ADMIN_USERNAME="ignored",
            SLIPSTREAM_ADMIN_PASSWORD="ignored",
        )
        reset_settings_cache()
        settings = get_settings()
        assert settings.admin_username == "root"
        assert settings.admin_password == "s3cret"
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        reset_settings_cache()
