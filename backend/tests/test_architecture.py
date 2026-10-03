"""Hexagonal layering rules, enforced on imports (brief §4.2)."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

import cc_platform

PACKAGE_ROOT = Path(cc_platform.__file__).parent

FRAMEWORKS = ("fastapi", "starlette", "sqlalchemy", "pydantic", "pydantic_settings", "structlog",
              "jwt", "argon2", "uvicorn", "aiosqlite")  # fmt: skip

RULES: dict[str, tuple[str, ...]] = {
    # layer: forbidden import prefixes
    "domain": (
        *FRAMEWORKS,
        "cc_platform.application",
        "cc_platform.infrastructure",
        "cc_platform.api",
        "cc_platform.bootstrap",
    ),
    "application": (
        *FRAMEWORKS,
        "cc_platform.infrastructure",
        "cc_platform.api",
        "cc_platform.bootstrap",
    ),
    "infrastructure": ("cc_platform.api", "cc_platform.bootstrap", "fastapi"),
    # The API talks to use cases through ``ApiContext``, never to adapters or the container.
    "api": ("cc_platform.infrastructure", "cc_platform.bootstrap"),
}


def imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module)
    return modules


@pytest.mark.parametrize("layer", sorted(RULES))
def test_layer_does_not_import_outer_layers_or_frameworks(layer: str) -> None:
    forbidden = RULES[layer]
    violations = [
        f"{path.relative_to(PACKAGE_ROOT)} imports {module}"
        for path in (PACKAGE_ROOT / layer).rglob("*.py")
        for module in imported_modules(path)
        if any(module == f or module.startswith(f"{f}.") for f in forbidden)
    ]
    assert violations == []


@pytest.mark.parametrize(
    "removed",
    [
        "application/ports/ai.py",
        "application/copilot",
        "application/tools",
        "application/automation",
        "application/routing",
        "application/audit/ports.py",
        "domain/routing",
        "infrastructure/routing",
    ],
)
def test_removed_scope_stays_removed(removed: str) -> None:
    """Slice 2 scope cut (brief §1): these packages must not come back."""
    assert not (PACKAGE_ROOT / removed).exists()
