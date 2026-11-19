"""AgentgatewayAdapter contract tests: adapter-spi.md §4 (atomic apply) and §5.

Real filesystem under a repo-local temp dir (the host sandbox denies the system
temp area), real sha256 marker, real read-back. Only the gateway process is
absent: the driver never starts or stops it (adapter-spi.md preamble).
"""

from __future__ import annotations

import dataclasses
import os
import shutil
import sqlite3
import time
import uuid
from pathlib import Path

import pytest

from l02_domain.ir import (
    ClientKeySpec,
    GatewayIR,
    PublicModelSpec,
    TargetSpec,
    UpstreamModelSpec,
    UpstreamSpec,
    UserBalanceSpec,
)
from l03_adapters.agentgateway import apply as apply_module
from l03_adapters.agentgateway.adapter import AgentgatewayAdapter
from l03_adapters.agentgateway.usage import (
    EXPECTED_REQUEST_LOG_COLUMNS,
    fetch_events,
    open_readonly,
)
from l03_adapters.spi import UsageCursor


def _make_dir(prefix: str = ".tmp-ag-contract-") -> Path:
    api_root = Path(__file__).resolve().parents[2]
    path = api_root / (prefix + uuid.uuid4().hex[:8])
    os.makedirs(path)
    return path


def _rmtree(path: Path) -> None:
    """Remove a repo-local temp tree; Windows may hold a handle briefly."""
    for attempt in range(12):
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        try:
            path.rmdir()
        except OSError:
            pass
        if not path.exists():
            return
        time.sleep(min(0.05 * (attempt + 1), 0.5))


@pytest.fixture()
def config_dir():
    directory = _make_dir()
    try:
        yield directory
    finally:
        _rmtree(directory)


@pytest.fixture()
def adapter(config_dir: Path) -> AgentgatewayAdapter:
    # This fixture's IR points at keys that do not exist here, so the binary
    # gate is explicitly disabled; the gate itself is covered elsewhere.
    return AgentgatewayAdapter(str(config_dir), ag_binary="")


def _ir(revision: str = "rev_1", *, public_name: str = "flagship") -> GatewayIR:
    return GatewayIR(
        revision=revision,
        upstreams=(
            UpstreamSpec("ups_a", "https://x.example/v1", "openai_chat", "./k/ups_a.key"),
        ),
        models=(UpstreamModelSpec("um_a", "ups_a", "glm-5.3", "chat"),),
        public_models=(
            PublicModelSpec(public_name, (TargetSpec("mt_a", "um_a", 1),)),
        ),
        api_keys=(
            ClientKeySpec("key_1", "sha256:" + "a" * 64, user_id="u1", key_suffix="abcd"),
        ),
        users=(UserBalanceSpec("u1", 1000),),
    )


def _config_text(config_dir: Path) -> str:
    return (config_dir / "config.yaml").read_text(encoding="utf-8")


def test_describe_is_stable_and_capabilities_unique(adapter: AgentgatewayAdapter) -> None:
    first = adapter.describe()
    second = adapter.describe()
    assert first.adapter_id == "agentgateway"
    assert first.version == second.version
    keys = [capability.key for capability in first.capabilities]
    assert len(keys) == len(set(keys))
    assert {"routing.priority_failover", "config.hot_reload", "usage.read_events"} <= set(keys)
    # Contract: the matrix is explicit and every row carries a verified flag.
    assert all(isinstance(capability.verified, bool) for capability in first.capabilities)
    assert {"mcp.targets", "policies.retry", "policies.health", "llm.modelAliases"} <= set(keys)
    # M3 (ADR-024): retry renders as a top-level route policy, so the management
    # surface reopens; health marks + eviction are configurable per model.
    assert next(c for c in first.capabilities if c.key == "policies.retry").supported is True
    assert next(c for c in first.capabilities if c.key == "policies.health").supported is True


def test_validate_accepts_good_ir_and_rejects_illegal_ir(
    adapter: AgentgatewayAdapter, config_dir: Path
) -> None:
    assert adapter.validate(_ir()).ok

    good = _ir()
    duplicate_public = dataclasses.replace(
        good, public_models=(good.public_models[0], good.public_models[0])
    )
    missing_model = dataclasses.replace(
        good,
        public_models=(
            PublicModelSpec("flagship", (TargetSpec("mt_a", "umdl_missing", 1),)),
        ),
    )
    bad_priority = dataclasses.replace(
        good,
        public_models=(PublicModelSpec("flagship", (TargetSpec("mt_a", "um_a", -1),)),),
    )
    duplicate_upstream = dataclasses.replace(
        good, upstreams=(good.upstreams[0], good.upstreams[0])
    )

    cases = (
        (duplicate_public, "重复的对外模型名"),
        (missing_model, "指向不存在的上游模型"),
        (bad_priority, "priority 必须为 >= 0 的整数"),
        (duplicate_upstream, "重复的上游 id"),
    )
    for ir, fragment in cases:
        result = adapter.validate(ir)
        assert not result.ok, fragment
        assert any(fragment in error for error in result.errors), result.errors
    # Validation is pure: it never writes a config the data plane could pick up.
    assert list(config_dir.iterdir()) == []


def test_render_is_deterministic_and_covers_ir(adapter: AgentgatewayAdapter) -> None:
    first = adapter.render(_ir())
    second = adapter.render(_ir())
    assert first.content == second.content
    assert first.hash == second.hash
    assert first.revision == "rev_1"
    content = first.content
    assert "flagship" in content  # the only client-visible alias
    assert "ups_a" in content and "glm-5.3" in content
    # ADR-010 default actions are composed even when the upstream has no rules.
    assert "server" in content and "x-powered-by" in content


def test_render_rejects_unmapped_api_style(adapter: AgentgatewayAdapter) -> None:
    ir = dataclasses.replace(
        _ir(), upstreams=(UpstreamSpec("ups_a", "https://x.example/v1", "mystery", "./k/a.key"),)
    )
    with pytest.raises(ValueError):
        adapter.render(ir)


def test_apply_then_status_reports_applied_hash(
    adapter: AgentgatewayAdapter, config_dir: Path
) -> None:
    artifact = adapter.render(_ir())
    result = adapter.apply(artifact)
    assert result.ok and result.applied_hash == artifact.hash
    assert _config_text(config_dir) == artifact.content
    assert (config_dir / "config.yaml.hash").read_text(encoding="utf-8") == artifact.hash
    status = adapter.status()
    assert status.config_hash == artifact.hash
    assert "matches" in status.detail
    assert adapter.health().healthy is True
    # §4: apply is atomic - no stray temp files may survive.
    assert sorted(path.name for path in config_dir.iterdir()) == ["config.yaml", "config.yaml.hash"]


def test_apply_write_failure_keeps_previous_config(
    adapter: AgentgatewayAdapter, config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good = adapter.render(_ir("rev_good"))
    assert adapter.apply(good).ok
    before = _config_text(config_dir)
    bad = adapter.render(_ir("rev_bad", public_name="other"))

    def exploding_replace(src, dst):  # pragma: no cover - injected failure
        raise OSError("disk full")

    monkeypatch.setattr(apply_module.os, "replace", exploding_replace)
    result = adapter.apply(bad)
    assert not result.ok and result.rolled_back
    assert _config_text(config_dir) == before
    monkeypatch.undo()
    assert adapter.status().config_hash == good.hash


def test_read_back_mismatch_restores_previous_config(
    adapter: AgentgatewayAdapter, config_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good = adapter.render(_ir("rev_good"))
    assert adapter.apply(good).ok
    before = _config_text(config_dir)
    bad = adapter.render(_ir("rev_bad", public_name="other"))

    calls = {"count": 0}

    def drifting_strip(text: str) -> list[str]:
        calls["count"] += 1
        return ["read-" + str(calls["count"])]

    monkeypatch.setattr(apply_module, "strip_session_fields", drifting_strip)
    result = adapter.apply(bad)
    assert not result.ok and result.rolled_back
    assert "回滚" in result.message
    assert _config_text(config_dir) == before


def test_rollback_reapplies_stored_revision(
    adapter: AgentgatewayAdapter, config_dir: Path
) -> None:
    first = adapter.render(_ir("rev_1"))
    second = adapter.render(_ir("rev_2", public_name="other"))
    assert adapter.apply(first).ok
    assert adapter.apply(second).ok

    result = adapter.rollback("rev_1")
    assert result.ok and result.applied_hash == first.hash
    assert _config_text(config_dir) == first.content

    unknown = adapter.rollback("rev_does_not_exist")
    assert not unknown.ok and not unknown.rolled_back


def test_status_detects_hand_edited_config(
    adapter: AgentgatewayAdapter, config_dir: Path
) -> None:
    artifact = adapter.render(_ir())
    assert adapter.apply(artifact).ok
    path = config_dir / "config.yaml"
    path.write_text(path.read_text(encoding="utf-8") + "\n# edited by hand\n", encoding="utf-8")
    status = adapter.status()
    assert status.config_hash != artifact.hash
    assert "drift" in status.detail


def test_status_without_apply_is_empty(adapter: AgentgatewayAdapter) -> None:
    assert adapter.status().config_hash is None
    assert adapter.health().healthy is False


def test_usage_without_database_is_empty_and_idempotent(adapter: AgentgatewayAdapter) -> None:
    first = adapter.usage(None)
    assert first.events == () and first.next_cursor is None
    cursor = UsageCursor(value="any-cursor")
    second = adapter.usage(cursor)
    assert second.events == () and second.next_cursor == cursor


def _create_request_logs_db(path: Path, rows: list[tuple[str, str]]) -> None:
    columns = ", ".join('"' + name + '" TEXT' for name in sorted(EXPECTED_REQUEST_LOG_COLUMNS))
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE request_logs (" + columns + ")")
        for event_id, started_at in rows:
            connection.execute(
                "INSERT INTO request_logs (id, started_at, http_status) VALUES (?, ?, ?)",
                (event_id, started_at, "200"),
            )
        connection.commit()
    finally:
        connection.close()


def test_usage_column_contract_unchanged_after_m2_full_form() -> None:
    """E17-T2-c: hybrid/full form and simplified llm mode emit the same request_logs shape.

    E17 pinned 26 request_logs columns on the full form; usage.py maps
    input_tokens/output_tokens/time_to_first_token_ms straight through. The M2
    migration must keep both the column contract and that mapping byte-identical.
    """
    e17_t2c_columns = {
        "id",
        "started_at",
        "completed_at",
        "duration_ms",
        "trace_id",
        "span_id",
        "http_status",
        "error",
        "gen_ai_operation_name",
        "gen_ai_provider_name",
        "gen_ai_request_model",
        "gen_ai_response_model",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cost",
        "agentgateway_user",
        "agentgateway_group",
        "user_agent_name",
        "has_payload",
        "attributes_json",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "reasoning_tokens",
        "time_to_first_token_ms",
        "time_per_output_token_ms",
    }
    assert EXPECTED_REQUEST_LOG_COLUMNS == e17_t2c_columns

    temp_dir = _make_dir()
    try:
        db_path = temp_dir / "ag.db"
        _create_request_logs_db(db_path, [])
        connection = sqlite3.connect(db_path)
        try:
            connection.execute(
                "INSERT INTO request_logs (id, started_at, http_status, "
                "gen_ai_request_model, gen_ai_response_model, gen_ai_provider_name, "
                "input_tokens, output_tokens, total_tokens, reasoning_tokens, "
                "time_to_first_token_ms, time_per_output_token_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "evt_t2c",
                    "2026-11-19T10:00:00Z",
                    "200",
                    "nvidia/nemotron-3.5-lightning-30b-a3b",
                    "nvidia/nemotron-3.5-lightning-30b-a3b",
                    "openai",
                    "19",
                    "32",
                    "51",
                    "32",
                    "1237",
                    "4.74",
                ),
            )
            connection.commit()
        finally:
            connection.close()

        connection = open_readonly(str(db_path))
        try:
            page = fetch_events(connection, None)
        finally:
            connection.close()
    finally:
        _rmtree(temp_dir)

    assert len(page.events) == 1
    event = page.events[0]
    assert event.input_tokens == 19
    assert event.output_tokens == 32
    assert event.total_tokens == 51
    assert event.time_to_first_token_ms == 1237
    assert event.public_model == "nvidia/nemotron-3.5-lightning-30b-a3b"


def test_usage_cursor_is_incremental_and_idempotent(config_dir: Path) -> None:
    db_path = config_dir / "ag.db"
    _create_request_logs_db(
        db_path,
        [
            ("evt_1", "2026-11-16T10:00:00Z"),
            ("evt_2", "2026-11-16T10:00:01Z"),
            ("evt_3", "2026-11-16T10:00:02Z"),
        ],
    )
    adapter = AgentgatewayAdapter(str(config_dir / "cfg"), ag_db_path=str(db_path))
    page = adapter.usage(None)
    assert [event.event_id for event in page.events] == ["evt_1", "evt_2", "evt_3"]
    cursor = page.next_cursor
    assert cursor is not None
    # Pulling the same cursor twice must never duplicate events.
    again = adapter.usage(cursor)
    assert again.events == () and again.next_cursor == cursor

    connection = open_readonly(str(db_path))
    try:
        first_page = fetch_events(connection, None, limit=2)
        same_page = fetch_events(connection, None, limit=2)
        assert [event.event_id for event in first_page.events] == ["evt_1", "evt_2"]
        assert [event.event_id for event in same_page.events] == ["evt_1", "evt_2"]
        rest = fetch_events(connection, first_page.next_cursor, limit=2)
        assert [event.event_id for event in rest.events] == ["evt_3"]
    finally:
        connection.close()


def test_usage_reports_missing_database_as_schema_mismatch(config_dir: Path) -> None:
    from l01_core.errors import AppError

    adapter = AgentgatewayAdapter(str(config_dir / "cfg"), ag_db_path=str(config_dir / "nope.db"))
    with pytest.raises(AppError):
        adapter.usage(None)
