"""Layering rules: the core stays pure, web code stays in backend/api/ (CLAUDE.md engineering rules)."""
import ast
import subprocess
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


def test_no_source_file_is_hidden_from_git():
    """A broad .gitignore rule once swallowed frontend/src/lib/ (the whole calculation layer)."""
    root = BACKEND.parent
    sources = [p for pattern in ("backend/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx",
                                 "frontend/src/**/*.css", "tests/**/*.py")
               for p in root.glob(pattern) if "__pycache__" not in p.parts]
    assert len(sources) > 30  # the globs still match the tree

    rel = [str(p.relative_to(root)) for p in sources]
    done = subprocess.run(["git", "check-ignore", "--stdin"], cwd=root, input="\n".join(rel),
                          capture_output=True, text=True)
    assert done.stdout.splitlines() == []
