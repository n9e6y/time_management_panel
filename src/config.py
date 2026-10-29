"""Load and validate the settings file (config.yaml, or config.example.yaml as a fallback).

Pure apart from reading the file: no Streamlit, no web framework. Spec: c-c-k/docs/stages/STAGE_2_syntax_and_config.md.
Every problem in a config is collected and reported at once, so one run shows everything to fix.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from ingest import WEEKDAYS, get_tz
from syntax import CATEGORY_NAME

ROOT_DIR = Path(__file__).resolve().parent.parent
TAG_NAME = re.compile(r"[A-Za-z0-9_-]+")
KNOWN_KEYS = {"timezone", "week_start", "days_off", "categories", "legacy_categories", "focus", "syntax", "tags"}


class ConfigError(ValueError):
    """A config that can't be used; the message lists every problem found."""


@dataclass(frozen=True)
class CategoryConfig:
    focus: bool = False


@dataclass(frozen=True)
class LegacyRule:
    map_to: str | None = None          # None keeps the legacy name as its own group
    add_tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class Config:
    timezone: str
    categories: dict[str, CategoryConfig]
    week_start: str = "Saturday"
    days_off: frozenset[str] = frozenset()
    legacy_categories: dict[str, LegacyRule] = field(default_factory=dict)
    focus_min_minutes: int = 90
    subcategory_separator: str = " - "
    known_tags: frozenset[str] = frozenset({"deep", "shallow", "unplanned"})
    source: str = ""                   # file the config was loaded from, if any

    @property
    def tz(self) -> ZoneInfo:
        return get_tz(self.timezone)

    @property
    def focus_categories(self) -> set[str]:
        return {name for name, cat in self.categories.items() if cat.focus}


# --- validation --------------------------------------------------------------------------------

def _weekday(value, where: str, errors: list[str]) -> str | None:
    if isinstance(value, str) and value.strip().capitalize() in WEEKDAYS:
        return value.strip().capitalize()
    errors.append(f"{where}: {value!r} is not a weekday (use one of {', '.join(WEEKDAYS)})")
    return None


def _mapping(value, where: str, errors: list[str]) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        errors.append(f"{where}: expected a mapping, got {value!r}")
        return {}
    return value


def _name_list(value, where: str, pattern: re.Pattern, errors: list[str]) -> list[str]:
    if not isinstance(value, list):
        errors.append(f"{where}: expected a list, got {value!r}")
        return []
    names = []
    for i, item in enumerate(value):
        if isinstance(item, str) and pattern.fullmatch(item.strip()):
            names.append(item.strip().lower())
        else:
            errors.append(f"{where}[{i}]: {item!r} is not a valid name")
    return names


def _categories(value, errors: list[str]) -> dict[str, CategoryConfig]:
    categories: dict[str, CategoryConfig] = {}
    for name, settings in _mapping(value, "categories", errors).items():
        if not isinstance(name, str) or not CATEGORY_NAME.fullmatch(name.strip()):
            errors.append(f"categories: {name!r} is not a valid category name (letters, digits, '_', spaces)")
            continue
        key = name.strip().upper()
        if key in categories:
            errors.append(f"categories: {name!r} is listed twice")
        settings = _mapping(settings, f"categories.{key}", errors)
        focus = settings.get("focus", False)
        if not isinstance(focus, bool):
            errors.append(f"categories.{key}.focus: expected true or false, got {focus!r}")
            focus = False
        categories[key] = CategoryConfig(focus=focus)
    if not categories and not any(e.startswith("categories") for e in errors):
        errors.append("categories: at least one category is required")
    return categories


def _legacy(value, categories: dict, errors: list[str]) -> dict[str, LegacyRule]:
    rules = {}
    for name, settings in _mapping(value, "legacy_categories", errors).items():
        if not isinstance(name, str) or not CATEGORY_NAME.fullmatch(name.strip()):
            errors.append(f"legacy_categories: {name!r} is not a valid category name")
            continue
        key = name.strip().upper()
        where = f"legacy_categories.{key}"
        if key in categories:
            errors.append(f"{where}: is also a current category; remove one of them")
        settings = _mapping(settings, where, errors)
        map_to = settings.get("map_to")
        if map_to is not None:
            if isinstance(map_to, str) and map_to.strip().upper() in categories:
                map_to = map_to.strip().upper()
            else:
                errors.append(f"{where}.map_to: {map_to!r} is not a configured category")
                map_to = None
        tags = _name_list(settings.get("add_tags", []), f"{where}.add_tags", TAG_NAME, errors)
        rules[key] = LegacyRule(map_to=map_to, add_tags=tuple(tags))
    return rules


def config_from_dict(data, source: str = "") -> Config:
    """Validate raw settings (as parsed from YAML) and build a Config. Raises ConfigError listing every problem."""
    errors: list[str] = []
    data = _mapping(data, "config", errors)
    for key in data:
        if key not in KNOWN_KEYS:
            errors.append(f"unknown setting {key!r} (known: {', '.join(sorted(KNOWN_KEYS))})")

    timezone = data.get("timezone")
    if not isinstance(timezone, str) or not timezone.strip():
        errors.append("timezone: required, e.g. 'Asia/Tehran'")
    else:
        try:
            get_tz(timezone.strip())
        except ValueError as exc:
            errors.append(f"timezone: {exc}")

    week_start = _weekday(data.get("week_start", "Saturday"), "week_start", errors)

    days_off = data.get("days_off", [])
    if not isinstance(days_off, list):
        errors.append(f"days_off: expected a list of weekdays, got {days_off!r}")
        days_off = []
    days_off = {_weekday(day, f"days_off[{i}]", errors) for i, day in enumerate(days_off)}

    categories = _categories(data.get("categories"), errors)
    legacy = _legacy(data.get("legacy_categories"), categories, errors)

    focus = _mapping(data.get("focus"), "focus", errors)
    min_minutes = focus.get("min_minutes", 90)
    if isinstance(min_minutes, bool) or not isinstance(min_minutes, int) or min_minutes < 0:
        errors.append(f"focus.min_minutes: expected a whole number of minutes >= 0, got {min_minutes!r}")

    syntax = _mapping(data.get("syntax"), "syntax", errors)
    separator = syntax.get("subcategory_separator", " - ")
    if not isinstance(separator, str) or not separator.strip():
        errors.append(f"syntax.subcategory_separator: expected visible text such as ' - ', got {separator!r}")

    tags = _mapping(data.get("tags"), "tags", errors)
    known_tags = _name_list(tags.get("known", ["deep", "shallow", "unplanned"]), "tags.known", TAG_NAME, errors)

    if errors:
        where = f" ({source})" if source else ""
        raise ConfigError(f"Invalid config{where}:\n" + "\n".join(f"  - {e}" for e in errors))
    return Config(timezone=timezone.strip(), categories=categories, week_start=week_start,
                  days_off=frozenset(days_off), legacy_categories=legacy, focus_min_minutes=min_minutes,
                  subcategory_separator=separator, known_tags=frozenset(known_tags), source=source)


# --- loading -----------------------------------------------------------------------------------

def find_config_file(root: Path = ROOT_DIR) -> Path:
    """config.yaml if it exists, else the committed config.example.yaml."""
    own = root / "config.yaml"
    return own if own.exists() else root / "config.example.yaml"


def load_config(path: str | Path | None = None, root: Path = ROOT_DIR) -> Config:
    """Read and validate a config file. Without a path, use config.yaml or fall back to config.example.yaml."""
    path = Path(path) if path is not None else find_config_file(root)
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}. Copy config.example.yaml to config.yaml.")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        line = f" (line {mark.line + 1})" if mark else ""
        raise ConfigError(f"{path} is not valid YAML{line}: {getattr(exc, 'problem', exc)}") from exc
    return config_from_dict(data, source=str(path))
