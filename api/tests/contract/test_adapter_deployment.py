"""W6 ticket 04: the adapter deployment namespace and registry-driven construction.

Core Settings keeps neutral run config only (ADR-029). The agentgateway
deployment knobs keep their SLIPSTREAM_AG_* environment names but are read by
the adapter namespace itself, and the composition root asks the registry for
the configured driver instead of branching on the adapter name
(docs/SYSTEM-BOUNDARY.md section 4, rule 4).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from l01_core.settings import Settings, get_settings, reset_settings_cache
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.agentgateway.deployment import reset_deployment_cache
from l03_adapters.fake import FakeAdapter
from l03_adapters.mock import MockAdapter
from l03_adapters.registry import create
from l06_api.adapter_factory import make_adapter

_API_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def fresh_settings(monkeypatch):
    """Env-mutable settings; caches reset before and after so no state leaks."""
    reset_settings_cache()
    reset_deployment_cache()
    yield
    reset_settings_cache()
    reset_deployment_cache()


def test_agentgateway_driver_builds_from_its_own_namespace(monkeypatch, fresh_settings, tmp_path):
    """The SLIPSTREAM_AG_* env surface drives the adapter the registry builds."""
    monkeypatch.setenv("SLIPSTREAM_AG_LLM_PORT", "4599")
    adapter = create("agentgateway")
    assert isinstance(adapter, AgentgatewayAdapter)
    assert adapter.client_contract().default_port == 4599


def test_agentgateway_driver_defaults_stay_byte_stable(monkeypatch, fresh_settings):
    """Without AG env knobs the built driver matches the pinned deployment."""
    monkeypatch.delenv("SLIPSTREAM_AG_LLM_PORT", raising=False)
    adapter = make_adapter(get_settings())
    assert isinstance(adapter, AgentgatewayAdapter)
    assert adapter.client_contract().default_port == 3600


def test_composition_factory_never_branches_on_the_driver_name(monkeypatch, fresh_settings):
    """make_adapter delegates to the registry for every configured driver."""
    monkeypatch.setenv("SLIPSTREAM_DATA_PLANE_ADAPTER", "fake")
    reset_settings_cache()
    assert isinstance(make_adapter(get_settings()), FakeAdapter)
    monkeypatch.setenv("SLIPSTREAM_DATA_PLANE_ADAPTER", "mock")
    reset_settings_cache()
    assert isinstance(make_adapter(get_settings()), MockAdapter)


def test_neutral_config_dir_feeds_every_driver(monkeypatch, fresh_settings, tmp_path):
    """The one neutral deployment dir replaces ag_config_dir for all drivers."""
    target = tmp_path / "dp-config"
    monkeypatch.setenv("SLIPSTREAM_DATA_PLANE_CONFIG_DIR", str(target))
    reset_settings_cache()
    assert create("fake").config_dir == str(target.resolve())
    assert create("mock").config_dir == str(target.resolve())


def test_legacy_ag_config_dir_env_still_resolves(monkeypatch, fresh_settings, tmp_path):
    """Migration policy: SLIPSTREAM_AG_CONFIG_DIR stays a deprecated alias."""
    target = tmp_path / "alias-config"
    monkeypatch.setenv("SLIPSTREAM_AG_CONFIG_DIR", str(target))
    reset_settings_cache()
    assert get_settings().data_plane_config_dir == str(target.resolve())


def test_neutral_config_dir_env_wins_over_the_deprecated_alias(
    monkeypatch, fresh_settings, tmp_path
):
    """SLIPSTREAM_DATA_PLANE_CONFIG_DIR takes precedence once operators migrate."""
    monkeypatch.setenv(
        "SLIPSTREAM_DATA_PLANE_CONFIG_DIR", str(tmp_path / "new-config")
    )
    monkeypatch.setenv("SLIPSTREAM_AG_CONFIG_DIR", str(tmp_path / "old-config"))
    reset_settings_cache()
    assert get_settings().data_plane_config_dir == str((tmp_path / "new-config").resolve())


def test_core_settings_carry_no_data_plane_shapes():
    """The core settings model exposes neutral fields only (ADR-029 吸收清单)."""
    settings = Settings()
    for legacy in (
        "ag_config_dir",
        "ag_config_filename",
        "ag_llm_port",
        "ag_db_path",
        "ag_binary",
    ):
        assert not hasattr(settings, legacy)
    assert settings.data_plane_config_dir
    from l01_core import settings as settings_module

    assert not hasattr(settings_module, "DEFAULT_AG_DB_FILENAME")
    assert settings.data_plane_adapter == "agentgateway"
    assert _API_ROOT.exists()  # keep the repo-root anchor honest for readers
