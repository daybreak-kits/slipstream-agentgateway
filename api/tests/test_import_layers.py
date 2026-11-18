"""Import-lint: layers import only downward; AG nouns stay inside l03_adapters."""

from __future__ import annotations

import ast
import re
from collections.abc import Iterable
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"

# "provider" was dropped: gen_ai_provider_name is a legitimate usage/billing
# column name (E6), not an AG leakage; the rest are adapter-layer nouns.
AG_NOUNS = {"agentgateway", "cel", "keyhash", "virtualmodel"}


LAYER_RE = re.compile(r"^l(\d{2})_")


def _layer_of(path: Path) -> int | None:
    """Layer number from a path component like l04_repo (regex, not brittle slicing)."""
    for part in path.parts:
        match = LAYER_RE.match(part)
        if match:
            return int(match.group(1))
    return None


def _violations_for(layer: int, modules: Iterable[str]) -> list[str]:
    """Pure lint core: offending imports for one file's own layer.

    ADR-006 rule: an import may point only at a STRICTLY LOWER layer. Same-layer
    imports are legal (l01_core/crypto.py -> l01_core.errors is normal), as are
    downward imports; only target_layer > own_layer violates the layering.
    Modules that are not layer packages (stdlib, third-party) are ignored.
    """
    offending: list[str] = []
    for module in modules:
        match = LAYER_RE.match(module)
        if match is None:
            continue
        if int(match.group(1)) > layer:
            offending.append(module)
    return offending


def _violations(root: Path) -> list[str]:
    """Filesystem scan (integration): every upward import under root, with file names."""
    violations: list[str] = []
    for path in root.rglob("*.py"):
        layer = _layer_of(path)
        if layer is None:
            continue
        for module in _violations_for(layer, _imports_of(path)):
            violations.append(f"{path.name} imports {module}")
    return violations


def _imports_of(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.append(node.module)
    return modules


def test_layers_import_only_downward():
    assert _violations(SRC) == []


def test_layer_parser_handles_real_packages():
    # Regression guard for the original bug: slicing-based parsing returned None
    # for every real package ("l01_core"[2:] == "1_core"), so the lint was always true.
    assert _layer_of(SRC / "l01_core" / "errors.py") == 1
    assert _layer_of(SRC / "l04_repo" / "orm.py") == 4
    assert _layer_of(SRC / "l06_api" / "app.py") == 6


def test_layer_violation_rules_cover_three_cases():
    """Self-check on the pure core: upward flags, same-layer and downward pass."""
    assert _violations_for(1, ["l05_service.prices", "l07_jobs.runner"]) == [
        "l05_service.prices",
        "l07_jobs.runner",
    ]
    assert _violations_for(1, ["l01_core.errors"]) == []  # same layer is legal
    assert _violations_for(6, ["l01_core.errors", "l04_repo.orm"]) == []  # downward is legal
    assert _violations_for(6, ["l06_api.deps"]) == []  # same layer, any package: legal per ADR-006
    assert _violations_for(3, ["json", "os", "sqlalchemy"]) == []  # non-layer modules ignored


def test_ag_nouns_absent_from_l04_l05_identifiers():
    violations = []
    for layer in ("l04_repo", "l05_service"):
        for path in (SRC / layer).glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Name):
                    names.append(node.id.lower())
                elif isinstance(node, ast.Attribute):
                    names.append(node.attr.lower())
                for name in names:
                    for noun in AG_NOUNS:
                        if noun in name:
                            violations.append(f"{path.name}: {name}")
    assert violations == []


def test_transforms_cel_words_only_in_l03():
    # The compiler (CEL emission) must live in l03_adapters, not in l05_service.
    assert (SRC / "l03_adapters" / "agentgateway" / "transforms.py").exists()
    assert not (SRC / "l05_service" / "transforms_compiler.py").exists()
