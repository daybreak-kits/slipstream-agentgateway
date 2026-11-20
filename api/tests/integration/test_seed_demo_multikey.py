"""Ticket 15: the demo seed models ONE upstream channel with several keys.

ADR-026 multi-key: an upstream owns N equal-peer credentials and the renderer
expands every row into its own AG provider ("{upstream_id}#{seq}"). The seed
used to fake multi-key by creating three same-base_url upstreams instead, which
also made the billing attribution degenerate (every same-named model row landed
on the first upstream). These tests pin the new demo shape and the ledger it
produces, and they pin the migration trigger path for a freshly created DB.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parents[2]
ZAI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"


def _env(db_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )


def _query(db_path: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(db_path)
    try:
        return list(connection.execute(sql).fetchall())
    finally:
        connection.close()


def _seed(db_path: Path) -> tuple[dict[str, str], subprocess.CompletedProcess[str]]:
    env = _env(db_path)
    seeded = _run(["scripts/seed_demo.py"], env)
    assert seeded.returncode == 0, seeded.stderr[-2000:]
    return env, seeded


@pytest.fixture(scope="module")
def seeded_demo(tmp_path_factory) -> tuple[Path, dict[str, str], subprocess.CompletedProcess[str]]:
    """One real seed run shared by the read-only tests in this module."""
    db_path = tmp_path_factory.mktemp("seed-multikey") / "demo.db"
    env, seeded = _seed(db_path)
    return db_path, env, seeded


def test_seed_is_one_zai_channel_with_three_equal_keys(seeded_demo) -> None:
    db_path, _env_value, seeded = seeded_demo
    channels = _query(
        db_path, "SELECT id, name, base_url, api_key_enc FROM upstreams ORDER BY name"
    )
    assert [row[1] for row in channels] == ["local-01", "local-02", "nebula-01", "zai-01"]
    # ADR-026: no vendor is split into several channels sharing one address.
    assert len({row[2] for row in channels}) == 4

    zai_id = next(row[0] for row in channels if row[2] == ZAI_BASE_URL)
    # The retired mirror column must stay empty: key rows are the only home.
    assert all(row[3] == "" for row in channels), "seed must not write api_key_enc"

    keys = _query(
        db_path,
        "SELECT upstream_id, label, key_suffix FROM upstream_keys"
        " ORDER BY upstream_id, created_at_ms, id",
    )
    per_channel = Counter(row[0] for row in keys)
    zai_suffixes = [row[2] for row in keys if row[0] == zai_id]
    assert len(zai_suffixes) == 3, "one zai channel must own three equal keys"
    assert len(set(zai_suffixes)) == 3 and all(zai_suffixes)
    # 3 + 1 + 1 + 1 rows: every channel stays usable, one channel is multi-key.
    assert per_channel[zai_id] == 3
    assert len(keys) == 6
    assert set(per_channel) == {row[0] for row in channels}

    counts = {
        table: _query(db_path, f"SELECT COUNT(*) FROM {table}")[0][0]
        for table in (
            "vendors",
            "upstreams",
            "upstream_models",
            "public_models",
            "model_targets",
        )
    }
    assert counts == {
        "vendors": 3,
        "upstreams": 4,
        "upstream_models": 16,
        "public_models": 8,
        "model_targets": 16,
    }
    # The operator-facing summary line must quote the same numbers as the DB.
    assert "上游 4" in seeded.stdout
    assert "上游模型 16" in seeded.stdout
    assert "目标 16" in seeded.stdout


def test_seeded_ledger_attributes_every_event_to_its_own_channel(seeded_demo) -> None:
    db_path, _env_value, _seeded = seeded_demo
    events = _query(db_path, "SELECT event_id, provider FROM gateway_usage_events")
    assert events
    # Real AG rows carry the ADR-026 expanded provider name; the demo data must
    # exercise the same shape so the ledger path is the production one.
    assert all("#" in provider for _event_id, provider in events)

    attributed = _query(
        db_path,
        """
        SELECT e.provider, e.upstream_model, ce.upstream_model_id, um.upstream_id
        FROM gateway_usage_events e
        JOIN cost_entries ce ON ce.gateway_event_id = e.event_id
        LEFT JOIN upstream_models um ON um.id = ce.upstream_model_id
        """,
    )
    assert len(attributed) == len(events)
    for provider, upstream_model, model_row_id, upstream_id in attributed:
        assert model_row_id is not None, (provider, upstream_model)
        assert upstream_id == provider.split("#", 1)[0], (provider, upstream_model, upstream_id)

    # Both local instances expose llama-3.3-70b: their traffic must keep its own
    # cost rows instead of collapsing onto the first same-named upstream.
    dual = _query(
        db_path,
        """
        SELECT DISTINCT um.upstream_id
        FROM cost_entries ce
        JOIN gateway_usage_events e ON e.event_id = ce.gateway_event_id
        JOIN upstream_models um ON um.id = ce.upstream_model_id
        WHERE e.upstream_model = 'llama-3.3-70b'
        """,
    )
    assert len(dual) == 2, dual


def test_new_database_needs_no_multikey_migration(tmp_path: Path) -> None:
    """New-DB trigger path: init_db creates upstream_keys from the start and the
    seed writes rows only, so the bulk migration has nothing to move - it just
    records the v2 marker once and is a no-op afterwards."""
    db_path = tmp_path / "fresh.db"
    env, _seeded = _seed(db_path)

    dry = _migrate(db_path, env)
    assert dry["applied"] is False
    assert dry["already_v2"] is False
    assert dry["materialize"] == []
    assert dry["clear_mirror"] == []

    applied = _migrate(db_path, env, "--apply")
    assert applied["applied"] is True
    assert applied["stored_semantics"] == "v2"


def _migrate(db_path: Path, env: dict[str, str], *extra: str) -> dict:
    run = _run(
        [
            "scripts/migrate_multikey_v2.py",
            "--database-url",
            "sqlite:///" + db_path.as_posix(),
            "--json",
            *extra,
        ],
        env,
    )
    assert run.returncode == 0, run.stderr[-2000:]
    return json.loads(run.stdout)
