"""Ticket 08: GET /admin/config/status mirrors the data-plane truth (S5).

The detail strings are the contract (adapter-spi.md §4.1); the route adds the
active revision so the dashboard can explain what it is showing. These tests
drive the real config dir the conftest fixture prepared.
"""

from __future__ import annotations

import os
from pathlib import Path

from l03_adapters.agentgateway.apply import hash_normalized_text

HEADERS = {"X-Admin-Role": "owner"}
CONFIG = "llm:\n  port: 3600\n"


def _status(client) -> dict:
    resp = client.get("/admin/config/status", headers=HEADERS)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_config_status_without_apply_marker(client) -> None:
    body = _status(client)
    assert {"config_hash", "detail", "process_version", "listening", "active_revision"} <= set(body)
    assert body["active_revision"] is None
    assert body["config_hash"] is None
    assert body["detail"] == "no config applied yet"


def test_config_status_reports_marker_fallback_drift_and_match(client) -> None:
    config_dir = Path(os.environ["SLIPSTREAM_AG_CONFIG_DIR"])
    marker = config_dir / "config.yaml.hash"
    target = config_dir / "config.yaml"

    # Marker only: the file is gone, so the marker is the fallback hash.
    marker.write_text("a" * 64, encoding="utf-8")
    body = _status(client)
    assert body["detail"] == "config file missing; hash from last apply marker"
    assert body["config_hash"] == "a" * 64

    # Hand-written file vs a different marker: drift, never the marker echo.
    target.write_text(CONFIG, encoding="utf-8")
    body = _status(client)
    assert body["detail"].startswith("config drift: file ")
    assert body["config_hash"] == hash_normalized_text(CONFIG)
    assert body["config_hash"] != "a" * 64

    # Matching marker: the file on disk is what the last apply wrote.
    marker.write_text(hash_normalized_text(CONFIG), encoding="utf-8")
    body = _status(client)
    assert body["detail"] == "config file matches last applied hash"
    assert body["config_hash"] == hash_normalized_text(CONFIG)
