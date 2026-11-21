"""ADR-021 bootstrap: an unset logging switch still renders a log DB source.

The data-plane request log is the ingestion source for usage and billing, so an
operator who never opens the setting must still get config.logging.database.url
(with the conservative metadata mode). Ticket 04 (ADR-029) moved WHERE the log
DB lives into the adapter namespace: the system resolves only the metadata/full
switch and leaves database_url empty; the adapter renderer falls back to its
deployment default, and an explicit SLIPSTREAM_AG_DB_PATH keeps winning.
"""

from __future__ import annotations

from l01_core.timeutil import now_ms
from l02_domain.ir import (
    AccessLogSpec,
    ClientKeySpec,
    GatewayIR,
    PoliciesSpec,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
)
from l03_adapters.agentgateway.deployment import reset_deployment_cache
from l03_adapters.agentgateway.render import render_config
from l04_repo.orm import AppSettingORM
from l05_service.rendering import ACCESS_LOG_LLM_KEY, _access_log_spec


def _store_mode(session, value_json: str) -> None:
    session.add(
        AppSettingORM(
            key=ACCESS_LOG_LLM_KEY, value_json=value_json, updated_at_ms=now_ms()
        )
    )
    session.commit()


def _ir(access_log: AccessLogSpec) -> GatewayIR:
    """A minimal renderable IR with the access-log block under test."""
    return GatewayIR(
        revision="rev_bootstrap",
        upstreams=(
            UpstreamSpec(
                id="ups_a",
                base_url="https://api.example.com/v1",
                api_style="openai_chat",
                key_file="keys/ups_a.key",
            ),
        ),
        models=(
            UpstreamModelSpec(
                id="m1",
                upstream_id="ups_a",
                upstream_model_name="glm-5.3",
                model_type="chat",
            ),
        ),
        public_models=(
            PublicModelSpec(
                name="flagship",
                targets=(TargetSpec(id="t1", upstream_model_id="m1", priority=10),),
            ),
        ),
        api_keys=(
            ClientKeySpec(id="key_a", key_hash="sha256:" + "a" * 64, user_id="usr_a"),
        ),
        policies=PoliciesSpec(access_log=access_log),
    )


def test_unset_switch_defaults_to_metadata_and_leaves_the_url_to_the_adapter(
    engine_and_sessionmaker,
):
    """System side: only the switch is resolved; the URL is no longer system-owned."""
    _, factory = engine_and_sessionmaker
    with factory() as session:
        spec = _access_log_spec(session)
    assert spec.llm == "metadata"
    # ADR-029 ticket 04: the log DB location is an adapter deployment fact.
    assert spec.database_url == ""


def test_explicit_mode_selection_still_wins(engine_and_sessionmaker):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        _store_mode(session, '"full"')
        spec = _access_log_spec(session)
    assert spec.llm == "full"


def test_adapter_renders_its_default_log_db_when_the_system_leaves_it_unset(
    engine_and_sessionmaker,
):
    """Bootstrap guarantee: config.logging.database.url is always present."""
    reset_deployment_cache()
    cfg = render_config(_ir(AccessLogSpec(database_url="", llm="metadata")), 3600)
    assert cfg["config"]["logging"]["database"]["url"] == "ag-data.db"
    assert cfg["frontendPolicies"]["accessLog"]["database"]["llm"] == "metadata"


def test_explicit_ag_db_path_env_wins_in_the_adapter_namespace(
    engine_and_sessionmaker, monkeypatch
):
    """SLIPSTREAM_AG_DB_PATH keeps its historical override semantics."""
    monkeypatch.setenv("SLIPSTREAM_AG_DB_PATH", "/tmp/custom-ag.db")
    reset_deployment_cache()
    try:
        cfg = render_config(_ir(AccessLogSpec(database_url="", llm="full")), 3600)
        assert cfg["config"]["logging"]["database"]["url"] == "/tmp/custom-ag.db"
        assert cfg["frontendPolicies"]["accessLog"]["database"]["llm"] == "full"
    finally:
        reset_deployment_cache()


def test_explicit_system_provided_url_is_rendered_verbatim(engine_and_sessionmaker):
    """An IR that carries a URL (golden fixtures) is rendered unchanged."""
    reset_deployment_cache()
    cfg = render_config(
        _ir(AccessLogSpec(database_url="./.data_store/ag-data.db", llm="full")), 3600
    )
    assert cfg["config"]["logging"]["database"]["url"] == "./.data_store/ag-data.db"
