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
