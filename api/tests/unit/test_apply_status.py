"""S5: status() reports the file the data plane serves, not the apply marker."""

from __future__ import annotations

import os
import shutil
import time
import uuid
from pathlib import Path

from l03_adapters.agentgateway.apply import ConfigApplier
from l03_adapters.spi import make_artifact

TMP_ROOT = Path(__file__).resolve().parents[2]
CONTENT = "llm:\n  port: 3600\n"


def _rmtree_retry(path: Path, attempts: int = 12, delay: float = 0.05) -> None:
    for attempt in range(attempts):
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        try:
            path.rmdir()
        except OSError:
            pass
        if not path.exists():
            return
        time.sleep(min(delay * (attempt + 1), 0.5))


def _workdir() -> Path:
    path = TMP_ROOT / f".tmp-status-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    return path


def test_status_matches_applied_file():
    directory = _workdir()
    try:
        applier = ConfigApplier(str(directory), "config.yaml")
        assert applier.status().config_hash is None  # nothing applied yet
        artifact = make_artifact(CONTENT, revision="rev_1")
        result = applier.apply(artifact)
        assert result.ok and result.applied_hash == artifact.hash
        status = applier.status()
        assert status.config_hash == artifact.hash
        assert "matches last applied hash" in status.detail
    finally:
        _rmtree_retry(directory)


def test_status_reports_drift_after_external_edit():
    directory = _workdir()
    try:
        applier = ConfigApplier(str(directory), "config.yaml")
        applier.apply(make_artifact(CONTENT, revision="rev_1"))
        (directory / "config.yaml").write_text("llm:\n  port: 9999\n", encoding="utf-8")
        status = applier.status()
        assert status.config_hash is not None
        assert status.config_hash != make_artifact(CONTENT).hash
        assert "drift" in status.detail
    finally:
        _rmtree_retry(directory)


def test_status_ignores_gateway_written_session_block():
    # AG rewrites its own session.* state on load; that must not look like drift.
    directory = _workdir()
    try:
        applier = ConfigApplier(str(directory), "config.yaml")
        artifact = make_artifact(CONTENT, revision="rev_1")
        applier.apply(artifact)
        (directory / "config.yaml").write_text(
            CONTENT + "session:\n  key: abc\nsession.key: xyz\n", encoding="utf-8"
        )
        status = applier.status()
        assert status.config_hash == artifact.hash
        assert "matches" in status.detail
    finally:
        _rmtree_retry(directory)


def test_status_falls_back_to_marker_when_file_gone():
    directory = _workdir()
    try:
        applier = ConfigApplier(str(directory), "config.yaml")
        artifact = make_artifact(CONTENT, revision="rev_1")
        applier.apply(artifact)
        os.remove(directory / "config.yaml")
        status = applier.status()
        assert status.config_hash == artifact.hash
        assert "missing" in status.detail
    finally:
        _rmtree_retry(directory)
