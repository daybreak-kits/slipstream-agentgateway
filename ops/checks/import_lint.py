#!/usr/bin/env python3
"""System-boundary import lint (W6 ticket 01 baseline).

Run from the repository root:

    python ops/checks/import_lint.py            # report only, always EXIT=0
    python ops/checks/import_lint.py --strict   # findings are failures, EXIT=1

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
* a frontend source reference to the concrete adapter module path.

Known baseline leaks (8, expected on the W6 baseline 2287de5). This ticket
reports them without blocking; tickets 02/03/04/06 migrate the call sites and
then turn ``--strict`` into a gate. Do not add new exceptions here: the list is
documentation of the debt this baseline measured.

1. api/src/l06_api/routers_log_payload.py:16  adapter-import
   System API imports the concrete usage reader to serve log payloads.
2. api/src/l06_api/routers_upstreams.py:15   adapter-import
   System API imports the concrete transform compiler for previews.
3. api/src/l07_jobs/log_cleanup.py:28        adapter-import
   System job imports the concrete retention helper.
4. api/src/l06_api/adapter_factory.py:24     adapter-name-dispatch
   Composition factory branches on the concrete adapter name and its knobs.
5. api/src/l06_api/routers_health.py:21      client-contract-hardcode
   System health exposes the data-plane port instead of a client contract.
6. api/src/l06_api/routers_meta.py:150       client-contract-hardcode
   System connection info hardcodes the data-plane endpoint list.
7. api/src/l06_api/routers_ops.py:986        client-contract-hardcode
   Playground hardcodes the data-plane base URL/port.
8. web/src/lib/mock.ts:606                   adapter-module-reference
   The frontend mock copies the concrete adapter's capability matrix.

Usage with the future closeout gate (ticket 06):
    python ops/checks/import_lint.py --strict
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

#: Baseline leak count. Kept in the output so the ticket-01 acceptance is
#: visible; ticket 06 removes the final references and flips --strict on.
BASELINE_LEAK_COUNT = 8


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
    return path.relative_to(REPO_ROOT).as_posix()


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
    ]
    # One finding per file/rule: the first offending line is enough to locate
    # the leak, and it keeps the baseline stable across small edits.
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
        description="Report concrete data-plane references in system-layer sources."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 1 when any finding remains (the future ticket-06 gate)",
    )
    args = parser.parse_args(argv)

    findings = scan()
    print("import-lint: system boundary baseline")
    for finding in findings:
        print(finding.render())
    print(f"findings: {len(findings)} (baseline: {BASELINE_LEAK_COUNT})")

    if args.strict:
        if findings:
            print("strict mode: findings are failures (EXIT=1)")
            return 1
        print("strict mode: clean (EXIT=0)")
        return 0

    print("baseline mode: findings are reported, not blocking (EXIT=0)")
    print("run with --strict to enforce the boundary")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
