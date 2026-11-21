"""Settings 归一化：agentgateway 配置路径与 .env 加载优先级。"""

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
        config_dir = Path(get_settings().data_plane_config_dir)
        assert config_dir.is_absolute()
        assert config_dir.name == "ag-config"
    finally:
        _restore(previous)


def test_absolute_config_dir_is_kept() -> None:
    previous = os.environ.get("SLIPSTREAM_AG_CONFIG_DIR")
    try:
        absolute = str(Path.cwd() / ".tmp-ag-config-check")
        _with_env(absolute)
        assert Path(get_settings().data_plane_config_dir) == Path(absolute)
    finally:
        _restore(previous)


_ADMIN_KEYS = (
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "SLIPSTREAM_ADMIN_USERNAME",
    "SLIPSTREAM_ADMIN_PASSWORD",
)


def test_bootstrap_admin_env_uses_slipstream_prefix() -> None:
    """引导账号只认 SLIPSTREAM_ 前缀，旧的去前缀变量不再生效。"""
    previous = {key: os.environ.get(key) for key in _ADMIN_KEYS}
    try:
        for key in _ADMIN_KEYS:
            os.environ.pop(key, None)
        os.environ.update(
            ADMIN_USERNAME="ignored-root",
            ADMIN_PASSWORD="ignored-secret",
            SLIPSTREAM_ADMIN_USERNAME="root",
            SLIPSTREAM_ADMIN_PASSWORD="s3cret",
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


def test_dotenv_file_supplies_settings(tmp_path: Path, monkeypatch: object) -> None:
    """没有进程环境变量时，从 CWD 的 .env 读取配置。"""
    monkeypatch.chdir(tmp_path)  # type: ignore[attr-defined]
    (tmp_path / ".env").write_text(
        "SLIPSTREAM_PORT=3111\nSLIPSTREAM_ADMIN_PASSWORD=dotenv-pass\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("SLIPSTREAM_PORT", raising=False)  # type: ignore[attr-defined]
    monkeypatch.delenv("SLIPSTREAM_ADMIN_PASSWORD", raising=False)  # type: ignore[attr-defined]
    reset_settings_cache()
    settings = get_settings()
    assert settings.port == 3111
    assert settings.admin_password == "dotenv-pass"
    reset_settings_cache()


def test_environment_wins_over_dotenv(tmp_path: Path, monkeypatch: object) -> None:
    """优先级：真实进程环境变量 > .env。"""
    monkeypatch.chdir(tmp_path)  # type: ignore[attr-defined]
    (tmp_path / ".env").write_text("SLIPSTREAM_PORT=3111\n", encoding="utf-8")
    monkeypatch.setenv("SLIPSTREAM_PORT", "3222")  # type: ignore[attr-defined]
    reset_settings_cache()
    assert get_settings().port == 3222
    reset_settings_cache()
