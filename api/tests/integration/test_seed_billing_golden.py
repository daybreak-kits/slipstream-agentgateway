"""seed 账单黄金（W7 t03）：删厂商后同一 mock 数据必须同价。

基线采集于厂商删除前的 seed（seed=42，同一 mock 数据）：成本/收费/日聚合与
本文件字面量逐一对齐。缓存价改挂 upstream_model_id 后，计费读键改变但价格
数值、token 口径与倍率不变，金额必须一字不差（ADR-030）。
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[2]

#: 厂商删除前 seed（seed=42）实测的账单黄金（单位：micro CNY）。
GOLDEN_COST_TOTAL = 1_338_531
GOLDEN_CHARGE_TOTAL = 1_606_240
GOLDEN_COST_DAILY_TOTAL = 1_338_531
GOLDEN_USER_DAILY_TOTAL = 1_606_240
GOLDEN_DAILY_AMOUNTS = sorted([232866, 182981, 194136, 212349, 124183, 175315, 216701])
GOLDEN_COST_OK_ROWS = 249
GOLDEN_COST_UNPRICED_ROWS = 3
GOLDEN_CACHE_PRICE_ROWS = 30
GOLDEN_EVENTS = 252


def _env(db_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "SLIPSTREAM_DATABASE_URL": "sqlite:///" + db_path.as_posix(),
        "SLIPSTREAM_SECRET_KEY": "test-secret",
        "SLIPSTREAM_AG_CONFIG_DIR": str(db_path.parent / "ag-config"),
    }


def _query(db_path: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(db_path)
    try:
        return list(connection.execute(sql).fetchall())
    finally:
        connection.close()


def test_seeded_billing_matches_the_pre_vendor_removal_golden(tmp_path: Path) -> None:
    db_path = tmp_path / "golden.db"
    env = _env(db_path)
    seeded = subprocess.run(
        [sys.executable, "scripts/seed_demo.py"],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert seeded.returncode == 0, seeded.stderr[-2000:]

    assert _query(db_path, "SELECT COUNT(*) FROM gateway_usage_events")[0][0] == GOLDEN_EVENTS

    cost_rows = _query(
        db_path, "SELECT status, COUNT(*) FROM cost_entries GROUP BY status"
    )
    assert dict(cost_rows) == {"ok": GOLDEN_COST_OK_ROWS, "unpriced": GOLDEN_COST_UNPRICED_ROWS}

    assert (
        _query(
            db_path,
            "SELECT COALESCE(SUM(amount_micro), 0) FROM cost_entries WHERE status = 'ok'",
        )[0][0]
        == GOLDEN_COST_TOTAL
    )
    assert (
        _query(
            db_path,
            "SELECT COALESCE(SUM(amount_micro), 0) FROM charge_entries "
            "WHERE status IN ('ok', 'free')",
        )[0][0]
        == GOLDEN_CHARGE_TOTAL
    )

    daily_amounts = _query(
        db_path, "SELECT day, SUM(amount_micro) FROM cost_daily GROUP BY day"
    )
    assert sorted(row[1] for row in daily_amounts) == GOLDEN_DAILY_AMOUNTS
    assert (
        _query(db_path, "SELECT COALESCE(SUM(amount_micro), 0) FROM cost_daily")[0][0]
        == GOLDEN_COST_DAILY_TOTAL
    )
    assert (
        _query(db_path, "SELECT COALESCE(SUM(amount_micro), 0) FROM user_daily")[0][0]
        == GOLDEN_USER_DAILY_TOTAL
    )


def test_seeded_cache_prices_hang_off_upstream_model_rows(tmp_path: Path) -> None:
    """ADR-030：seed 的缓存价全部挂 upstream_model_id，库内无厂商列。"""
    db_path = tmp_path / "cache-keys.db"
    env = _env(db_path)
    seeded = subprocess.run(
        [sys.executable, "scripts/seed_demo.py"],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert seeded.returncode == 0, seeded.stderr[-2000:]

    rows = _query(
        db_path,
        "SELECT upstream_model_id, item, unit_price_micro FROM upstream_prices",
    )
    assert len(rows) == GOLDEN_CACHE_PRICE_ROWS
    assert all(model_id and model_id.startswith("umdl") for model_id, _item, _micro in rows)
    assert all(micro == 500_000 for _model_id, _item, micro in rows)

    # 旧厂商键列在库内不存在（seed 重建的干净 schema）。
    columns = {
        row[1] for row in _query(db_path, "PRAGMA table_info(upstream_prices)")
    }
    assert "vendor_id" not in columns
    assert "upstream_model" not in columns

    tables = {
        row[0] for row in _query(db_path, "SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert "vendors" not in tables

    # seed 摘要行不再出现厂商计数。
    assert "厂商" not in seeded.stdout
