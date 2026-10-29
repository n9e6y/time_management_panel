"""Layering rules: the core stays pure, web code stays in backend/api/ (CLAUDE.md engineering rules)."""
import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
WEB_PACKAGES = {"fastapi", "starlette", "uvicorn", "streamlit"}


def imported_packages(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


def test_core_modules_do_not_import_web_frameworks():
    core = [p for p in BACKEND.glob("*.py")]
    assert {p.stem for p in core} >= {"ingest", "syntax", "config", "periods", "runner"}

    offenders = {p.name: imported_packages(p) & WEB_PACKAGES for p in core}
    assert {name: pkgs for name, pkgs in offenders.items() if pkgs} == {}


def test_core_modules_do_not_import_the_api_layer():
    offenders = [p.name for p in BACKEND.glob("*.py") if "api" in imported_packages(p)]
    assert offenders == []
