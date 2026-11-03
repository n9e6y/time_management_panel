"""Goals: "is my time going where I want?" — the weekly and monthly targets the panel judges.

Pure apart from reading and writing ``goals.yaml``: no web framework. Every problem in a file is collected and
reported at once, so one load shows everything to fix.

A goal has a **scope** (a category, or ``"CATEGORY: sub-category"``), an **every** (``week``, following the config's
``week_start``, or ``month``, a calendar month) and a **type**:

=========  ==========================  ======================================
type       meaning                     statuses
=========  ==========================  ======================================
``floor``  at least ``hours``          met / close / missed  (on_pace / behind)
``cap``    at most ``hours``           within / close / over (on_pace / heading_over)
``range``  between ``min`` and ``max`` in_range / close / below / above
``fixed``  an external schedule        logged (never judged on hours)
=========  ==========================  ======================================

A running period is judged against its **expected-by-now**: the target times the elapsed share of the period
(linear). Unlogged time never counts toward a goal, and hours that come from a title split on " - " are estimates:
they are marked and never alone decide a miss.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yaml

from config import Config
from ingest import week_start_of
from syntax import clean_name

GOALS_FILE = "goals.yaml"
DEFAULT_TOLERANCE = 0.10         # IA §7 Q10: "close" is within 10% of the target
EVERY = ("week", "month")
TYPES = ("floor", "cap", "range", "fixed")
ID_NAME = re.compile(r"[A-Za-z0-9_-]+")


class GoalsError(ValueError):
    """A goals file that can't be used; the message lists every problem found."""


@dataclass(frozen=True)
class Goal:
    id: str
    scope: str                   # "LEARN" or "ME: scrolling"; stored as written, matched case-insensitively
    every: str                   # "week" | "month"
    type: str                    # "floor" | "cap" | "range" | "fixed"
    hours: float | None = None   # floor and cap
    min_hours: float | None = None   # range
    max_hours: float | None = None   # range
    tolerance: float = DEFAULT_TOLERANCE
    why: str = ""

    @property
    def category(self) -> str:
        return self.scope.split(":", 1)[0].strip()

    @property
    def subcategory(self) -> str | None:
        return self.scope.split(":", 1)[1].strip() if ":" in self.scope else None

    @property
    def label(self) -> str:
        """What the goal asks for, in words: "≥ 10 h", "≤ 5 h", "49-63 h", "fixed"."""
        if self.type == "floor":
            return f"≥ {self.hours:g} h"
        if self.type == "cap":
            return f"≤ {self.hours:g} h"
        if self.type == "range":
            return f"{self.min_hours:g}–{self.max_hours:g} h"
        return "fixed"


# --- validation --------------------------------------------------------------------------------

def _number(value, where: str, errors: list[str]) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        errors.append(f"{where}: expected a number of hours >= 0, got {value!r}")
        return None
    return float(value)


def _goal_from_dict(raw, index: int, known_scopes: set[str], errors: list[str]) -> Goal | None:
    where = f"goals[{index}]"
    if not isinstance(raw, dict):
        errors.append(f"{where}: expected a mapping, got {raw!r}")
        return None

    scope = raw.get("scope")
    if not isinstance(scope, str) or not scope.strip():
        errors.append(f"{where}.scope: expected a category or 'CATEGORY: sub-category', got {scope!r}")
        return None
    scope = scope.strip()
    category = clean_name(scope.split(":", 1)[0])
    if known_scopes and category.upper() not in known_scopes:
        errors.append(f"{where}.scope: {category!r} is not one of your categories "
                      f"({', '.join(sorted(known_scopes))})")

    every = raw.get("every", "week")
    if every not in EVERY:
        errors.append(f"{where}.every: expected one of {', '.join(EVERY)}, got {every!r}")
        every = "week"

    kind = raw.get("type")
    if kind not in TYPES:
        errors.append(f"{where}.type: expected one of {', '.join(TYPES)}, got {kind!r}")
        return None

    hours = min_hours = max_hours = None
    if kind in ("floor", "cap"):
        hours = _number(raw.get("hours"), f"{where}.hours", errors)
    elif kind == "range":
        min_hours = _number(raw.get("min"), f"{where}.min", errors)
        max_hours = _number(raw.get("max"), f"{where}.max", errors)
        if min_hours is not None and max_hours is not None and min_hours > max_hours:
            errors.append(f"{where}: min ({min_hours:g}) is above max ({max_hours:g})")

    tolerance = raw.get("tolerance", DEFAULT_TOLERANCE)
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not 0 <= tolerance <= 1:
        errors.append(f"{where}.tolerance: expected a share between 0 and 1, got {tolerance!r}")
        tolerance = DEFAULT_TOLERANCE

    goal_id = raw.get("id") or f"{category.lower()}-{every}"
    if not isinstance(goal_id, str) or not ID_NAME.fullmatch(goal_id.strip()):
        errors.append(f"{where}.id: {goal_id!r} may only hold letters, digits, '-' and '_'")
        goal_id = f"goal-{index}"

    sub = scope.split(":", 1)[1].strip() if ":" in scope else None
    full = f"{category.upper()}: {sub}" if sub else category.upper()
    return Goal(id=goal_id.strip(), scope=full, every=every, type=kind, hours=hours, min_hours=min_hours,
                max_hours=max_hours, tolerance=float(tolerance),
                why=str(raw.get("why", "")).strip())


def goals_from_dict(data, config: Config | None = None, source: str = "") -> list[Goal]:
    """Validate plain data (as read from goals.yaml or sent by the app) into goals, or raise GoalsError."""
    errors: list[str] = []
    if data is None:
        return []
    if isinstance(data, list):
        data = {"goals": data}
    if not isinstance(data, dict):
        raise GoalsError(f"Invalid goals file: expected a mapping with a 'goals' list, got {data!r}")
    raw_goals = data.get("goals") or []
    if not isinstance(raw_goals, list):
        raise GoalsError(f"Invalid goals: 'goals' must be a list, got {raw_goals!r}")

    known = {name.upper() for name in config.categories} | {name.upper() for name in config.legacy_categories} \
        if config else set()
    goals: list[Goal] = []
    for i, raw in enumerate(raw_goals):
        goal = _goal_from_dict(raw, i, known, errors)
        if goal is not None:
            goals.append(goal)
    seen: dict[str, int] = {}
    for i, goal in enumerate(goals):  # ids must be unique: the app edits and deletes by id
        if goal.id in seen:
            goals[i] = replace(goal, id=f"{goal.id}-{i}")
        seen[goal.id] = i
    pairs = [(g.scope.upper(), g.every) for g in goals]
    for pair in {p for p in pairs if pairs.count(p) > 1}:
        errors.append(f"two goals for {pair[0]} every {pair[1]}: keep one")
    if errors:
        where = f" ({source})" if source else ""
        raise GoalsError(f"Invalid goals{where}:\n" + "\n".join(f"  - {e}" for e in errors))
    return goals


def goals_to_dict(goals: list[Goal]) -> dict:
    """The goals as plain data, in the shape of goals.yaml (inverse of ``goals_from_dict``)."""
    out = []
    for g in goals:
        item: dict = {"id": g.id, "scope": g.scope, "every": g.every, "type": g.type}
        if g.type in ("floor", "cap"):
            item["hours"] = g.hours
        elif g.type == "range":
            item["min"] = g.min_hours
            item["max"] = g.max_hours
        if g.tolerance != DEFAULT_TOLERANCE:
            item["tolerance"] = g.tolerance
        if g.why:
            item["why"] = g.why
        out.append(item)
    return {"goals": out}


# --- loading and saving ------------------------------------------------------------------------

SAVED_HEADER = ("# Time Analyzer goals, saved by the app (Settings -> Goals). Hand-written comments are not kept.\n"
                "# scope: a category or \"CATEGORY: sub-category\" | every: week | month\n"
                "# type: floor (hours) | cap (hours) | range (min, max) | fixed\n")


def load_goals(path: str | Path, config: Config | None = None) -> list[Goal]:
    """Read and validate goals.yaml. A missing file means no goals yet, not an error."""
    path = Path(path)
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        line = f" (line {mark.line + 1})" if mark else ""
        raise GoalsError(f"{path} is not valid YAML{line}: {getattr(exc, 'problem', exc)}") from exc
    return goals_from_dict(data, config, source=str(path))


def save_goals(goals: list[Goal], path: str | Path) -> Path:
    """Write the goals as YAML (a plain rewrite) and return the path."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(goals_to_dict(goals), sort_keys=False, allow_unicode=True, default_flow_style=None)
    path.write_text(SAVED_HEADER + text, encoding="utf-8")
    return path


# --- periods -----------------------------------------------------------------------------------

def period_of(day: date, every: str, config: Config) -> tuple[date, date]:
    """The week (following ``week_start``) or calendar month that ``day`` falls in, as (first, last)."""
    if every == "week":
        first = week_start_of(day, config.week_start)
        return first, first + timedelta(days=6)
    first = day.replace(day=1)
    next_month = (first + timedelta(days=31)).replace(day=1)
    return first, next_month - timedelta(days=1)


def elapsed_share(first: date, last: date, as_of: date) -> float:
    """How much of the period is over, by whole days: 0 before it starts, 1 once it has ended (IA §7 Q9)."""
    days = (last - first).days + 1
    if as_of < first:
        return 0.0
    if as_of > last:
        return 1.0
    return ((as_of - first).days + 1) / days


# --- evaluation --------------------------------------------------------------------------------

#: Statuses for a period that is over, and for one still running.
FINISHED = {"floor": ("met", "close", "missed"), "cap": ("within", "close", "over"),
            "range": ("in_range", "close", "below", "above"), "fixed": ("logged",)}
RUNNING = ("on_pace", "behind", "heading_over", "logged")
LOW_COVERAGE = 0.70  # below this, the numbers are too thin to judge (IA §7)


@dataclass(frozen=True)
class GoalProgress:
    """One goal measured over one period. Hours are always hours, never percentages."""
    goal: Goal
    first_day: date
    last_day: date
    running: bool
    elapsed: float            # share of the period that is over (0-1)
    actual: float
    estimated: float          # part of ``actual`` that comes from titles split on " - "
    blocks: int
    coverage: float           # share of the period's hours that are logged at all
    status: str
    expected: float | None    # target by now (floor, cap); None for range and fixed
    expected_min: float | None
    expected_max: float | None
    gap: float                # hours still needed (floor/below) or hours past the line (cap/above); else 0
    projected: float | None   # at this rate, hours by the end of the period

    @property
    def low_coverage(self) -> bool:
        return bool(self.coverage < LOW_COVERAGE)


def _hours(segments: pd.DataFrame, goal: Goal) -> tuple[float, float, int]:
    """Hours in scope, how many of them are estimates, and the number of blocks behind them."""
    if segments.empty:
        return 0.0, 0.0, 0
    rows = segments[segments["category"].str.upper() == goal.category.upper()]
    sub = goal.subcategory
    if sub is not None:
        rows = rows[rows["subcategory"].fillna("").str.strip().str.casefold() == sub.casefold()]
    if rows.empty:
        return 0.0, 0.0, 0
    parts = segments.groupby("block_id")["part_index"].nunique()
    split = set(parts[parts > 1].index)
    estimated = rows[rows["block_id"].isin(split)]["duration_min"].sum() / 60
    return float(rows["duration_min"].sum() / 60), float(estimated), int(rows["block_id"].nunique())


def _coverage(segments: pd.DataFrame, first: date, last: date, as_of: date, config: Config) -> float:
    """Logged share of the hours of the period that are over; 1.0 before the period starts."""
    from ingest import day_length_hours

    end = min(last, as_of)
    if end < first:
        return 1.0
    days = [first + timedelta(days=i) for i in range((end - first).days + 1)]
    available = sum(day_length_hours(day, config.tz) for day in days)
    if not available:
        return 1.0
    logged = 0.0
    if not segments.empty:
        wanted = {day.isoformat() for day in days}
        in_period = segments[segments["date"].astype(str).isin(wanted)]
        logged = float(in_period["duration_min"].sum() / 60)
    return min(1.0, logged / available)


def _status(goal: Goal, actual: float, estimated: float, running: bool, elapsed: float,
            expected: float | None, expected_min: float | None, expected_max: float | None) -> str:
    if goal.type == "fixed":
        return "logged"
    if running:
        if goal.type == "floor":
            return "on_pace" if actual >= (expected or 0) else "behind"
        if goal.type == "cap":
            projected = actual / elapsed if elapsed else actual
            return "on_pace" if projected <= (goal.hours or 0) else "heading_over"
        if actual < (expected_min or 0):
            return "behind"
        return "heading_over" if expected_max is not None and actual > expected_max else "on_pace"

    tolerance = goal.tolerance
    if goal.type == "floor":
        target = goal.hours or 0
        if actual >= target:
            return "met"
        return "close" if actual >= target * (1 - tolerance) or _decided_by_estimate(actual, target, estimated) \
            else "missed"
    if goal.type == "cap":
        target = goal.hours or 0
        if actual <= target:
            return "within"
        return "close" if actual <= target * (1 + tolerance) or _decided_by_estimate(actual, target, estimated) \
            else "over"
    low, high = goal.min_hours or 0, goal.max_hours or 0
    if low <= actual <= high:
        return "in_range"
    if actual < low:
        return "close" if actual >= low * (1 - tolerance) or _decided_by_estimate(actual, low, estimated) else "below"
    return "close" if actual <= high * (1 + tolerance) or _decided_by_estimate(actual, high, estimated) else "above"


def _decided_by_estimate(actual: float, boundary: float, estimated: float) -> bool:
    """True when estimated hours alone put the goal on the wrong side of the line (IA §7).

    An even split on " - " is a guess, so a verdict that rests on it is reported as "close", never as missed or over.
    """
    return estimated > 0 and abs(actual - boundary) <= estimated + 1e-9


def evaluate(goals: list[Goal], segments: pd.DataFrame, config: Config, as_of: date) -> list[GoalProgress]:
    """Measure every goal over the period ``as_of`` falls in.

    ``segments`` must cover each goal's whole period (the API analyses that range). ``as_of`` is the last day with
    real data: today, or the calendar's export day when that is earlier, so a stale file does not look like a
    bad week.
    """
    out: list[GoalProgress] = []
    for goal in goals:
        first, last = period_of(as_of, goal.every, config)
        elapsed = elapsed_share(first, last, as_of)
        running = elapsed < 1.0
        wanted = {(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)}
        in_period = segments[segments["date"].astype(str).isin(wanted)] if not segments.empty else segments
        actual, estimated, blocks = _hours(in_period, goal)

        expected = expected_min = expected_max = None
        if goal.type in ("floor", "cap"):
            expected = (goal.hours or 0) * elapsed
        elif goal.type == "range":
            expected_min = (goal.min_hours or 0) * elapsed
            expected_max = (goal.max_hours or 0) * elapsed
        status = _status(goal, actual, estimated, running, elapsed, expected, expected_min, expected_max)

        if goal.type == "floor":
            gap = max(0.0, (goal.hours or 0) - actual)
        elif goal.type == "cap":
            gap = max(0.0, actual - (goal.hours or 0))
        elif goal.type == "range":
            gap = max(0.0, (goal.min_hours or 0) - actual, actual - (goal.max_hours or 0))
        else:
            gap = 0.0

        out.append(GoalProgress(
            goal=goal, first_day=first, last_day=last, running=running, elapsed=elapsed, actual=actual,
            estimated=estimated, blocks=blocks, coverage=_coverage(in_period, first, last, as_of, config),
            status=status, expected=expected, expected_min=expected_min, expected_max=expected_max, gap=gap,
            projected=(actual / elapsed if running and elapsed else None),
        ))
    return out


def progress_to_dict(item: GoalProgress) -> dict:
    """One measured goal as plain data for the API."""
    goal = item.goal
    return {
        "id": goal.id, "scope": goal.scope, "every": goal.every, "type": goal.type, "label": goal.label,
        "hours": goal.hours, "min": goal.min_hours, "max": goal.max_hours, "tolerance": goal.tolerance,
        "why": goal.why,
        "first_day": item.first_day.isoformat(), "last_day": item.last_day.isoformat(),
        "running": item.running, "elapsed": round(item.elapsed, 4),
        "actual": round(item.actual, 4), "estimated": round(item.estimated, 4), "blocks": item.blocks,
        "coverage": round(item.coverage, 4), "low_coverage": item.low_coverage, "status": item.status,
        "expected": None if item.expected is None else round(item.expected, 4),
        "expected_min": None if item.expected_min is None else round(item.expected_min, 4),
        "expected_max": None if item.expected_max is None else round(item.expected_max, 4),
        "gap": round(item.gap, 4),
        "projected": None if item.projected is None else round(item.projected, 4),
    }
