"""The generated web contract must be deterministic and reproducible from OpenAPI."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATOR = REPO_ROOT / "ops" / "contract" / "gen_ts.py"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_generated_contract_is_current() -> None:
    result = _run("--check")
    assert result.returncode == 0, result.stderr or result.stdout


def test_generator_is_deterministic_and_has_the_revision_enum() -> None:
    sys.path.insert(0, str(GENERATOR.parent))
    import gen_ts

    first = gen_ts.render()
    second = gen_ts.render()
    assert first == second
    assert first.startswith(gen_ts.HEADER)
    assert "export const RevisionStatus = {" in first
    assert '"superseded"' in first
    assert "export const PAGE_SIZE_TIERS = [25, 50, 100, 200] as const;" in first


def test_check_detects_a_stale_file(tmp_path: Path) -> None:
    output = tmp_path / "contract.ts"
    generated = _run("--output", str(output), "--check")
    assert generated.returncode == 1
    assert "web contract 过期" in generated.stderr

    write = _run("--output", str(output))
    assert write.returncode == 0, write.stderr
    checked = _run("--output", str(output), "--check")
    assert checked.returncode == 0, checked.stderr

    output.write_text(output.read_text(encoding="utf-8") + "// 手改\n", encoding="utf-8")
    stale = _run("--output", str(output), "--check")
    assert stale.returncode == 1
    assert "web contract 过期" in stale.stderr
