"""migrate_multikey_v2 on a real sqlite file (CLI, subprocess).

Proves the ADR-026 upgrade path: a dry-run writes nothing, --apply materializes
the legacy inline credential as the first key row BEFORE clearing the mirror
column, records the ``multikey_semantics=v2`` marker, and a second run is a
no-op. The database here is created fresh in tmp_path - never a developer DB.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from l01_core.crypto import SecretBox
from l04_repo.base import init_db, make_engine, make_sessionmaker
from l04_repo.orm import UpstreamKeyORM, UpstreamORM

API_ROOT = Path(__file__).resolve().parents[2]

LEGACY_KEY = "sk-legacy-9999"


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


def _make_db(db_path: Path) -> dict[str, str]:
    """One legacy upstream (mirror only, no rows) and one modern one (row + mirror)."""
    engine = make_engine("sqlite:///" + db_path.as_posix())
    init_db(engine)
    factory = make_sessionmaker(engine)
    box = SecretBox("test-secret")
    with factory() as session:
        legacy = UpstreamORM(
            id="ups_legacy",
            name="legacy-upstream",
            base_url="https://legacy.example/v1",
            api_style="openai_chat",
            api_key_enc=box.encrypt(LEGACY_KEY),
            created_at_ms=1700000000000,
        )
        session.add(legacy)
        modern = UpstreamORM(
            id="ups_modern",
            name="modern-upstream",
            base_url="https://modern.example/v1",
            api_style="openai_chat",
            api_key_enc=box.encrypt("sk-modern-1111"),
            created_at_ms=1700000000001,
        )
        session.add(modern)
        session.add(
            UpstreamKeyORM(
                id="upk_modern",
                upstream_id=modern.id,
                label="密钥 1",
                key_enc=box.encrypt("sk-modern-1111"),
                key_suffix="1111",
                created_at_ms=1700000000001,
            )
        )
        session.commit()
    engine.dispose()
    return {"legacy_mirror": legacy.api_key_enc}


def _snapshot(db_path: Path) -> tuple[list[tuple], list[tuple], str]:
    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        upstreams = list(
            connection.execute("SELECT id, api_key_enc FROM upstreams ORDER BY id")
        )
        keys = list(
            connection.execute(
                "SELECT upstream_id, label, key_suffix FROM upstream_keys ORDER BY id"
            )
        )
        marker = connection.execute(
            "SELECT value_json FROM app_settings WHERE key = 'multikey_semantics'"
        ).fetchone()
        return upstreams, keys, marker[0] if marker else ""
    finally:
        connection.close()


def test_dry_run_reports_and_writes_nothing(tmp_path: Path) -> None:
    db_path = tmp_path / "demo.db"
    _make_db(db_path)
    env = _env(db_path)
    before = _snapshot(db_path)

    plan = _migrate(db_path, env)

    assert plan["applied"] is False
    assert plan["already_v2"] is False
    assert [entry["upstream_id"] for entry in plan["materialize"]] == ["ups_legacy"]
    assert plan["materialize"][0]["suffix"] == "9999"
    assert plan["clear_mirror"] == ["ups_legacy", "ups_modern"]
    assert _snapshot(db_path) == before  # a dry-run is a read-only pass


def test_apply_materializes_then_clears_and_marks_v2(tmp_path: Path) -> None:
    db_path = tmp_path / "demo.db"
    mirror = _make_db(db_path)
    env = _env(db_path)

    result = _migrate(db_path, env, "--apply")

    assert result["applied"] is True
    assert result["stored_semantics"] == "v2"
    upstreams, keys, marker = _snapshot(db_path)
    by_id = {row[0]: row[1] for row in upstreams}
    # the mirror is retired everywhere, including the modern upstream
    assert by_id["ups_legacy"] == "" and by_id["ups_modern"] == ""
    # the legacy credential was materialized into a real key row, ciphertext intact
    assert [row[1] for row in keys if row[0] == "ups_legacy"] == ["密钥 1"]
    assert [row[2] for row in keys if row[0] == "ups_legacy"] == ["9999"]
    # app_settings stores JSON-encoded values (put_setting)
    assert json.loads(marker) == "v2"

    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        stored = connection.execute(
            "SELECT key_enc FROM upstream_keys WHERE upstream_id = 'ups_legacy'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert stored == mirror["legacy_mirror"]
    assert SecretBox("test-secret").decrypt(stored) == LEGACY_KEY

    # the modern upstream keeps its original row untouched (no duplicate)
    legacy_rows = sum(1 for row in keys if row[0] == "ups_legacy")
    modern_rows = sum(1 for row in keys if row[0] == "ups_modern")
    assert (legacy_rows, modern_rows) == (1, 1)


def test_second_run_is_a_no_op(tmp_path: Path) -> None:
    db_path = tmp_path / "demo.db"
    _make_db(db_path)
    env = _env(db_path)
    _migrate(db_path, env, "--apply")
    after_first = _snapshot(db_path)

    again = _migrate(db_path, env)
    assert again["already_v2"] is True
    assert again["materialize"] == [] and again["clear_mirror"] == []

    reapplied = _migrate(db_path, env, "--apply")
    assert reapplied["already_v2"] is True
    assert _snapshot(db_path) == after_first
