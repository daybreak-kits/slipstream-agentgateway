"""S2 guards: the service layer never reaches into the driver package.

tests/test_import_layers.py owns the generic downward-import rule; these
assertions name the specific dependency the S2 refactor removed, so a regression
reports itself instead of hiding inside a generic list.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "src"
SERVICE = SRC / "l05_service"
ALLOWED_ADAPTER_MODULES = {"l03_adapters.spi"}


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.append(node.module)
    return modules


def test_service_layer_imports_only_spi_from_adapters():
    violations = [
        f"{path.name} imports {module}"
        for path in SERVICE.glob("*.py")
        for module in _imports(path)
        if module.startswith("l03_adapters") and module not in ALLOWED_ADAPTER_MODULES
    ]
    assert violations == []


def test_domain_layer_has_no_adapter_imports():
    violations = [
        f"{path.name} imports {module}"
        for path in (SRC / "l02_domain").glob("*.py")
        for module in _imports(path)
        if module.startswith("l03_adapters")
    ]
    assert violations == []


def test_adapter_construction_lives_in_composition_layer():
    factory = SRC / "l06_api" / "adapter_factory.py"
    assert factory.exists()
    assert "def make_adapter" in factory.read_text(encoding="utf-8")
    rendering = (SERVICE / "rendering.py").read_text(encoding="utf-8")
    assert "adapter_factory" not in rendering  # l05 must never import the factory


def test_ir_validation_lives_in_domain():
    assert (SRC / "l02_domain" / "validation.py").exists()
    assert not (SRC / "l03_adapters" / "validation.py").exists()


def test_service_takes_the_driver_as_a_parameter():
    rendering = (SERVICE / "rendering.py").read_text(encoding="utf-8")
    rollout = (SERVICE / "rollout.py").read_text(encoding="utf-8")
    assert "adapter: DataPlaneAdapter" in rendering
    assert "build_render_plan(session, revision=revision, adapter=adapter)" in rollout
