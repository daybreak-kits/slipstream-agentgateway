#!/usr/bin/env python3
"""System-boundary import lint (W6 ticket 01 baseline; ticket 06 made it the gate).

Run from the repository root:

    python ops/checks/import_lint.py            # the gate: findings are failures
    python ops/checks/import_lint.py --strict   # accepted alias of the default

Since ticket 06 the default mode IS strict: any finding exits 1. The W6 baseline
(2287de5) measured 8 known leaks; tickets 02/03/04/05 migrated the system layers
and ticket 06 cleared the frontend copy, so a clean boundary exits 0. Do not
re-add exceptions silently: new allowances must be registered in the explicit
whitelists below with a reason and reflected in docs/SYSTEM-BOUNDARY.md §5.

Scope: the system layers ``api/src/l02_domain``, ``l04_repo``, ``l05_service``,
``l06_api`` and ``l07_jobs`` plus ``web/src`` (including
``web/src/generated/contract.ts``). The adapter layer itself
(``api/src/l03_adapters``) is where concrete implementations belong and is not
scanned.

What counts as a concrete data-plane reference ("leak"):

* a Python import of a concrete adapter implementation module
  (``l03_adapters.agentgateway.*``) from a system layer;
* an adapter-name branch in a system composition module (``== "agentgateway"``);
* hardcoded data-plane client-contract facts in system code:
  ``ag_llm_port`` / ``data_plane_port`` or a concrete ``/v1/*`` endpoint literal;
* a frontend source reference to the concrete adapter module path;
* a ``raw_json`` reference in a system file outside the registered whitelist
  below (ticket 05/06: the attachment may ride along as storage and be searched
  internally, but no new system reader may appear).
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PY_LAYERS = ("l02_domain", "l04_repo", "l05_service", "l06_api", "l07_jobs")
WEB_ROOT = REPO_ROOT / "web" / "src"
WEB_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs")

CONCRETE_ADAPTER_MODULE = "l03_adapters.agentgateway"
ADAPTER_NAME = "agentgateway"
ENDPOINT_LITERALS = frozenset(
    {"/v1/chat/completions", "/v1/models", "/v1/embeddings"}
)
WEB_ADAPTER_PATH = re.compile(r"l03_adapters[\\/]+agentgateway")

#: Explicit raw_json whitelist (SYSTEM-BOUNDARY.md §5). Values are per-file
#: reasons; any other system-layer ``raw_json`` reference is a gate failure.
#: The four entries are the sanctioned paths:
#: * the attachment fact itself rides along (§2 system fact whitelist);
#: * routers_ops keeps the keyword-search haystack (ticket 05 Lead note) where
#:   raw_json is only scanned internally and never served or interpreted.
RAW_JSON_ALLOWLIST: dict[str, str] = {
    "api/src/l02_domain/models.py": "UsageEvent diagnostic-attachment field (§2 fact)",
    "api/src/l04_repo/orm.py": "diagnostic-attachment column definition (§2 fact)",
    "api/src/l05_service/usage_ingest.py": "ingest passthrough stores the attachment (§2 fact)",
    "api/src/l06_api/routers_ops.py": "keyword-search haystack, never served (ticket 05 Lead note)",
}


@dataclass(frozen=True, slots=True)
class Finding:
    """One concrete data-plane reference in a system-layer source file."""

    path: str
    line: int
    rule: str
    detail: str

    def render(self) -> str:
        return f"{self.path}:{self.line}: [{self.rule}] {self.detail}"


def _python_files() -> list[Path]:
    files: list[Path] = []
    for layer in PY_LAYERS:
        root = REPO_ROOT / "api" / "src" / layer
        if root.is_dir():
            files.extend(sorted(root.rglob("*.py")))
    return files


def _web_files() -> list[Path]:
    if not WEB_ROOT.is_dir():
        return []
    return sorted(
        path
        for path in WEB_ROOT.rglob("*")
        if path.is_file() and path.suffix in WEB_SUFFIXES
    )


def _relative(path: Path) -> str:
    """Repo-relative posix path; files outside the repo keep their own path."""
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _import_findings(path: Path, tree: ast.AST) -> list[Finding]:
    findings: list[Finding] = []
    for node in ast.walk(tree):
        modules: list[tuple[str, int]] = []
        if isinstance(node, ast.Import):
            modules.extend((alias.name, node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.append((node.module, node.lineno))
        for module, line in modules:
            if module == CONCRETE_ADAPTER_MODULE or module.startswith(
                CONCRETE_ADAPTER_MODULE + "."
            ):
                findings.append(
                    Finding(
                        _relative(path),
                        line,
                        "adapter-import",
                        f"imports concrete implementation module {module}",
                    )
                )
    return findings


def _adapter_name_findings(path: Path, tree: ast.AST) -> list[Finding]:
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Compare):
            continue
        values = [node.left, *node.comparators]
        if any(
            isinstance(value, ast.Constant) and value.value == ADAPTER_NAME
            for value in values
        ):
            findings.append(
                Finding(
                    _relative(path),
                    node.lineno,
                    "adapter-name-dispatch",
                    f'branches on the concrete adapter name "{ADAPTER_NAME}"',
                )
            )
    return findings


def _client_contract_findings(path: Path, tree: ast.AST) -> list[Finding]:
    lines: list[int] = []
    details: str = ""
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "ag_llm_port":
            lines.append(node.lineno)
            details = "uses the data-plane port from system settings"
        elif isinstance(node, ast.Constant):
            value = node.value
            if value in ENDPOINT_LITERALS:
                lines.append(node.lineno)
                details = "hardcodes a data-plane client endpoint"
            elif value == "data_plane_port":
                lines.append(node.lineno)
                details = "exposes the data-plane port as a system response field"
    if not lines:
        return []
    return [
        Finding(
            _relative(path),
            min(lines),
            "client-contract-hardcode",
            details,
        )
    ]


def _raw_json_findings(path: Path, tree: ast.AST) -> list[Finding]:
    """Flag raw_json readers that are not on the registered whitelist.

    Matches attribute access (``row.raw_json``), bare names and string keys
    (``{"raw_json": ...}``) — serving the attachment under any spelling is the
    same contract breach (SYSTEM-BOUNDARY §2: the API never returns it).
    """
    relative = _relative(path)
    if relative in RAW_JSON_ALLOWLIST:
        return []
    lines: list[int] = []
    for node in ast.walk(tree):
        hit = (
            (isinstance(node, ast.Attribute) and node.attr == "raw_json")
            or (isinstance(node, ast.Name) and node.id == "raw_json")
            or (isinstance(node, ast.Constant) and node.value == "raw_json")
        )
        if hit:
            lines.append(node.lineno)
    if not lines:
        return []
    return [
        Finding(
            relative,
            min(lines),
            "raw-json-read",
            "references raw_json outside the registered whitelist "
            "(docs/SYSTEM-BOUNDARY.md §5)",
        )
    ]


def _scan_python(path: Path) -> list[Finding]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError) as exc:  # pragma: no cover - broken checkout
        print(f"import-lint: cannot parse {path}: {exc}", file=sys.stderr)
        return []
    candidates = [
        *_import_findings(path, tree),
        *_adapter_name_findings(path, tree),
        *_client_contract_findings(path, tree),
        *_raw_json_findings(path, tree),
    ]
    # One finding per file/rule: the first offending line is enough to locate
    # the leak, and it keeps the report stable across small edits.
    grouped: dict[tuple[str, str], Finding] = {}
    for finding in candidates:
        key = (finding.path, finding.rule)
        current = grouped.get(key)
        if current is None or finding.line < current.line:
            grouped[key] = finding
    return sorted(grouped.values(), key=lambda item: (item.path, item.line, item.rule))


def _scan_web(path: Path) -> list[Finding]:
    text = path.read_text(encoding="utf-8", errors="replace")
    for number, line in enumerate(text.splitlines(), start=1):
        match = WEB_ADAPTER_PATH.search(line)
        if match:
            return [
                Finding(
                    _relative(path),
                    number,
                    "adapter-module-reference",
                    "references the concrete adapter implementation path",
                )
            ]
    return []


def scan() -> list[Finding]:
    """All concrete data-plane references in the configured system layers."""
    findings: list[Finding] = []
    for path in _python_files():
        findings.extend(_scan_python(path))
    for path in _web_files():
        findings.extend(_scan_web(path))
    findings.sort(key=lambda item: (item.path, item.line, item.rule))
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Enforce the system boundary: no concrete data-plane references."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="accepted alias: the default mode has been strict since ticket 06",
    )
    args = parser.parse_args(argv)

    findings = scan()
    print("import-lint: system boundary gate")
    for finding in findings:
        print(finding.render())
    print(f"findings: {len(findings)}")

    if findings:
        print("boundary violated: concrete data-plane references must be migrated "
              "(whitelists live in RAW_JSON_ALLOWLIST with a documented reason)")
        return 1
    print("boundary clean (EXIT=0)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
