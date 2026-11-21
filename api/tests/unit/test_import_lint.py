"""W6 ticket 01: the import-lint baseline is executable and honest.

The default mode reports the current concrete-data-plane references without
blocking; --strict is the future gate and must fail while the baseline still has
findings. Ticket 06 will flip it on once the migrations land.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "ops" / "checks" / "import_lint.py"

#: Baseline locations the W6 recon identified; later tickets remove them one by
#: one and update this list with the strict flip (ticket 06).
BASELINE_PATHS = (
    "api/src/l06_api/routers_log_payload.py",
    "api/src/l06_api/routers_upstreams.py",
    "api/src/l07_jobs/log_cleanup.py",
    "api/src/l06_api/adapter_factory.py",
    "api/src/l06_api/routers_health.py",
    "api/src/l06_api/routers_meta.py",
    "api/src/l06_api/routers_ops.py",
    "web/src/lib/mock.ts",
)


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_baseline_mode_lists_known_leaks_and_exits_zero() -> None:
    result = _run()
    assert result.returncode == 0, result.stderr or result.stdout
    assert "findings: 8" in result.stdout
    for path in BASELINE_PATHS:
        assert path in result.stdout, path


def test_strict_mode_fails_while_baseline_leaks_exist() -> None:
    result = _run("--strict")
    assert result.returncode == 1
    assert "strict" in result.stdout.lower()
