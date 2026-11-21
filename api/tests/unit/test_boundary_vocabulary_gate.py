"""W6 ticket 06: the vocabulary gate covers the system contract surface.

ADR-029 §6 / SYSTEM-BOUNDARY §6: data-plane column names, wire attributes and
receiver ports must not enter the contract output. The gate lives in
ops/checks/terminology_audit.mjs (boundary section); these tests drive it
through its CLI seam: a seeded fixture must fail, the real repo must pass.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "ops" / "checks" / "terminology_audit.mjs"


def _run_boundary(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(SCRIPT), "--boundary-only", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        shell=False,
    )


def _make_fixture(tmp_path: Path, body: str) -> Path:
    src = tmp_path / "web" / "src"
    src.mkdir(parents=True)
    (src / "fixture.ts").write_text(body, encoding="utf-8")
    return tmp_path


def test_data_plane_column_name_in_a_literal_fails_the_gate(tmp_path) -> None:
    root = _make_fixture(tmp_path, 'const note = "joins on trace_id and span_id";\n')
    result = _run_boundary("--root", str(root))
    assert result.returncode == 1, result.stdout
    assert "fixture.ts" in result.stdout


def test_wire_attribute_and_receiver_port_fail_the_gate(tmp_path) -> None:
    root = _make_fixture(
        tmp_path,
        'const a = "gen_ai.prompt tokens via agw.row";\n'
        'const b = "OTLP receiver on 4318";\n'
        'const c = "keyHash + virtualModels";\n'
        'const d = {"raw_json": "*"};\n',
    )
    result = _run_boundary("--root", str(root))
    assert result.returncode == 1, result.stdout
    for rule in ("gen_ai", "OTLP", "keyHash", "raw_json"):
        assert rule in result.stdout, rule


def test_adapter_id_audit_value_is_not_a_violation(tmp_path) -> None:
    """adapter_id is sanctioned audit metadata (SYSTEM-BOUNDARY §6.2 exception)."""
    root = _make_fixture(
        tmp_path,
        'const revision = { adapter_id: "agentgateway", status: "active" };\n',
    )
    result = _run_boundary("--root", str(root))
    assert result.returncode == 0, result.stdout


def test_comments_and_import_paths_are_not_copy(tmp_path) -> None:
    """§6.2 exception: historical notes in comments are documentation, not copy."""
    root = _make_fixture(
        tmp_path,
        '// history: the legacy trace_id column retired in ticket 06\n'
        'import { api } from "./api";\n'
        'export const ok = true;\n',
    )
    result = _run_boundary("--root", str(root))
    assert result.returncode == 0, result.stdout


def test_real_repo_contract_surface_is_clean() -> None:
    """The shipped contract surface (generated contract + mock) passes the gate."""
    result = _run_boundary()
    assert result.returncode == 0, result.stdout
    assert "findings: 0" in result.stdout
