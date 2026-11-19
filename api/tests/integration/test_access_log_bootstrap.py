"""ADR-021 bootstrap: an unset logging switch still renders a log DB source.

The data-plane request log is the ingestion source for usage and billing, so an
operator who never opens the setting must still get config.logging.database.url
(with the conservative metadata mode). Explicit values keep winning.
"""

from __future__ import annotations

from l01_core.settings import Settings
from l01_core.timeutil import now_ms
from l04_repo.orm import AppSettingORM
from l05_service.rendering import ACCESS_LOG_LLM_KEY, _access_log_spec


def _store_mode(session, value_json: str) -> None:
    session.add(
        AppSettingORM(
            key=ACCESS_LOG_LLM_KEY, value_json=value_json, updated_at_ms=now_ms()
        )
    )
    session.commit()


def test_unset_switch_defaults_to_metadata_and_ag_db(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    settings = Settings(ag_config_dir=str(tmp_path / "ag-config"), ag_db_path=None)
    with factory() as session:
        spec = _access_log_spec(session, settings)
    assert spec.llm == "metadata"
    assert spec.database_url == "ag-data.db"


def test_explicit_values_override_the_defaults(engine_and_sessionmaker, tmp_path):
    _, factory = engine_and_sessionmaker
    with factory() as session:
        _store_mode(session, '"full"')
    settings = Settings(ag_config_dir=str(tmp_path / "ag-config"), ag_db_path="/tmp/custom-ag.db")
    with factory() as session:
        spec = _access_log_spec(session, settings)
    assert spec.llm == "full"
    assert spec.database_url == "/tmp/custom-ag.db"
