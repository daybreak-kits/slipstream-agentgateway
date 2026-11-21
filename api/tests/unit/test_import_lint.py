"""W6 ticket 06: the boundary gate is strict by default and honest about exceptions.

Tickets 02/03/04/05 migrated every system-side concrete-adapter reference and
ticket 06 clears the frontend copy, so the default mode must enforce (EXIT=1 on
any finding) instead of reporting. Historical exceptions are explicit whitelists
in the script, not silent allowances: the raw_json keyword-search haystack in
routers_ops (ticket 05 Lead note) is registered, and any new raw_json reader in
the system layers fails the gate.
"""

from __future__ import annotations

import ast
import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "ops" / "checks" / "import_lint.py"

#: Ticket-02/03/04/06 migrations: system files that must never reappear as
#: concrete-adapter importers, client-contract hardcodes or frontend copies.
CLEARED_PATHS = (
    "api/src/l06_api/routers_log_payload.py",
    "api/src/l07_jobs/log_cleanup.py",
    "api/src/l06_api/routers_upstreams.py",
    "api/src/l06_api/adapter_factory.py",
    "api/src/l06_api/routers_health.py",
    "api/src/l06_api/routers_meta.py",
    "api/src/l06_api/routers_ops.py",
    "web/src/lib/mock.ts",
)


def _load_module():
    spec = importlib.util.spec_from_file_location("import_lint_gate", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    # Dataclass machinery resolves globals through sys.modules during exec.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def test_clean_boundary_passes_in_default_mode() -> None:
    """Ticket 06: default mode IS the gate; the zero-leak boundary exits 0."""
    result = _run()
    assert result.returncode == 0, result.stderr or result.stdout
    assert "findings: 0" in result.stdout
    for path in CLEARED_PATHS:
        assert path not in result.stdout, path


def test_strict_flag_is_kept_as_the_documented_alias() -> None:
    """Docs and gate chains call --strict; it must keep working (same verdict)."""
    result = _run("--strict")
    assert result.returncode == 0, result.stderr or result.stdout
    assert "findings: 0" in result.stdout


def test_default_mode_fails_on_a_new_finding() -> None:
    """A fresh leak must block by default, with no extra flag needed."""
    import_lint = _load_module()
    planted = import_lint.Finding(
        "api/src/l05_service/planted_leak.py",
        7,
        "adapter-import",
        "imports concrete implementation module l03_adapters.agentgateway.usage",
    )
    original_scan = import_lint.scan
    import_lint.scan = lambda: [planted]
    try:
        assert import_lint.main([]) == 1
        assert import_lint.main(["--strict"]) == 1
    finally:
        import_lint.scan = original_scan


def test_raw_json_in_a_new_system_file_is_a_violation(tmp_path) -> None:
    """The raw_json haystack exception is per-file: a new reader fails the gate."""
    import_lint = _load_module()
    source = tmp_path / "new_reader.py"
    source.write_text(
        'def peek(row):\n    return row.raw_json\n',
        encoding="utf-8",
    )
    findings = import_lint._raw_json_findings(source, ast.parse(source.read_text(encoding="utf-8")))
    assert len(findings) == 1
    assert findings[0].rule == "raw-json-read"
    assert findings[0].line == 2


def test_raw_json_string_keys_are_caught_too(tmp_path) -> None:
    """Serving the attachment through a dict key is the same violation."""
    import_lint = _load_module()
    source = tmp_path / "new_responder.py"
    source.write_text(
        'def body(row):\n    return {"raw_json": row.raw_json}\n',
        encoding="utf-8",
    )
    findings = import_lint._raw_json_findings(source, ast.parse(source.read_text(encoding="utf-8")))
    assert findings, "the dict-key raw_json must be caught"
    assert findings[0].rule == "raw-json-read"


def test_raw_json_haystack_in_routers_ops_is_whitelisted() -> None:
    """Ticket 05 Lead note: the keyword-search haystack is the registered exception."""
    import_lint = _load_module()
    path = REPO_ROOT / "api" / "src" / "l06_api" / "routers_ops.py"
    findings = import_lint._raw_json_findings(path, ast.parse(path.read_text(encoding="utf-8")))
    assert findings == []


def test_raw_json_storage_path_stays_whitelisted() -> None:
    """§2 whitelist facts: the domain field, ORM column and ingest passthrough."""
    import_lint = _load_module()
    for relative in (
        "api/src/l02_domain/models.py",
        "api/src/l04_repo/orm.py",
        "api/src/l05_service/usage_ingest.py",
    ):
        path = REPO_ROOT / relative
        findings = import_lint._raw_json_findings(
            path, ast.parse(path.read_text(encoding="utf-8"))
        )
        assert findings == [], relative
