"""Turn an ICS calendar into correct time blocks and per-day segments.

Pure functions only: no web framework, no file writing. Specs: c-c-k/docs/stages/STAGE_1_parser_correctness.md
and STAGE_2_syntax_and_config.md.

Pipeline: load_calendar -> expand_instances -> build_blocks -> split_parts -> split_segments
(or ``analyze`` for all of it). Settings come from a ``config.Config``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
import recurring_ical_events
from icalendar import Calendar

import syntax

if TYPE_CHECKING:
    from config import Config

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
UNCATEGORIZED = "UNCATEGORIZED"  # a string, not None: pandas groupby silently drops None keys

BLOCK_COLUMNS = ["block_id", "uid", "title", "description", "comment", "start_utc", "end_utc", "start_local",
                 "end_local", "duration_min", "category", "task", "subcategories", "tags", "projects", "score",
                 "issues", "is_focus"]
# Block details copied onto each of its parts and segments.
_BLOCK_DETAILS = ["block_id", "uid", "title", "category", "task", "tags", "projects", "score", "comment", "is_focus"]
_PART_DETAILS = ["part_index", "subcategory", *_BLOCK_DETAILS]
PART_COLUMNS = [*_PART_DETAILS, "start_utc", "end_utc"]
SEGMENT_COLUMNS = [*_PART_DETAILS, "date", "day_of_week", "is_day_off", "day_type", "week_start",
                   "start_local", "end_local", "duration_min"]


@dataclass(frozen=True)
class Instance:
    """One occurrence of a calendar event, as returned by the recurrence expansion (not yet validated)."""
    uid: str
    title: str
    description: str
    start: date | datetime | None
    end: date | datetime | None
    cancelled: bool


@dataclass
class IngestReport:
    """What was left out and what looks suspicious. Nothing is silently dropped."""
    skipped: list[dict] = field(default_factory=list)   # uid, title, start, reason
    overlaps: list[dict] = field(default_factory=list)  # block_a, block_b, minutes
    title_issues: dict[str, list[dict]] = field(default_factory=dict)  # issue code -> blocks (validation report)
    calendar_first: date | None = None  # first local day any event in the file starts
    calendar_last: date | None = None   # last local day an event starts or a recurrence ends


# --- timezone helpers ------------------------------------------------------------------------

def get_tz(name: str) -> ZoneInfo:
    """Return the timezone, or raise a ValueError that names the bad value."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError, OSError) as exc:
        raise ValueError(f"Unknown timezone: {name!r}. Use a TZ database name such as 'Asia/Tehran'.") from exc


def _local_midnight_utc(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


def local_day_bounds(first_day: date, last_day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """UTC bounds covering whole local days: [midnight of first_day, midnight after last_day)."""
    return _local_midnight_utc(first_day, tz), _local_midnight_utc(last_day + timedelta(days=1), tz)


def day_length_hours(day: date, tz: ZoneInfo) -> float:
    """Real length of a local day in hours (23 or 25 on daylight-saving changes)."""
    start, end = local_day_bounds(day, day, tz)
    return (end - start).total_seconds() / 3600


def week_start_of(day: date, week_start: str) -> date:
    """First day of the week containing ``day``, for weeks starting on ``week_start`` (e.g. 'Saturday')."""
    return day - timedelta(days=(day.weekday() - WEEKDAYS.index(week_start)) % 7)


# --- loading and expansion -------------------------------------------------------------------

def load_calendar(source: bytes | str | Path) -> Calendar:
    """Parse ICS content (bytes or text) or read it from a path."""
    if isinstance(source, Path):
        source = source.read_bytes()
    return Calendar.from_ical(source)


def expand_instances(cal: Calendar, start_utc: datetime, end_utc: datetime) -> list[Instance]:
    """Expand recurring events into instances overlapping [start_utc, end_utc).

    Uses recurring-ical-events, which applies EXDATE and RECURRENCE-ID overrides. It still returns
    cancelled instances, so they are flagged here and reported later.
    """
    # With neither DTEND nor DURATION the expansion fills in end == start, so remember which events lacked both.
    endless_uids = {str(c.get("UID", "")) for c in cal.walk("VEVENT") if "DTEND" not in c and "DURATION" not in c}
    instances = []
    for event in recurring_ical_events.of(cal).between(start_utc, end_utc):
        end = event.end  # DTEND, or DTSTART + DURATION
        if end == event.start and str(event.get("UID", "")) in endless_uids:
            end = None
        instances.append(Instance(
            uid=str(event.get("UID", "")),
            title=str(event.get("SUMMARY", "")).strip(),
            description=str(event.get("DESCRIPTION", "")).strip(),
            start=event.start,
            end=end,
            cancelled=str(event.get("STATUS", "")).upper() == "CANCELLED",
        ))
    return instances


def calendar_span(cal: Calendar, tz: ZoneInfo) -> tuple[date | None, date | None]:
    """The local days the whole file covers, regardless of the analysis range (open-ended rules count their start)."""
    days = []
    for event in cal.walk("VEVENT"):
        rule = event.get("RRULE") or {}
        for value in [event.get("DTSTART"), *rule.get("UNTIL", [])]:
            value = getattr(value, "dt", value)
            if isinstance(value, datetime):
                days.append(_to_utc(value, tz).astimezone(tz).date())
            elif isinstance(value, date):
                days.append(value)
    return (min(days), max(days)) if days else (None, None)


# --- blocks ----------------------------------------------------------------------------------

def _to_utc(value: datetime, tz: ZoneInfo) -> datetime:
    """Aware values keep their instant; floating (naive) values are wall-clock time in ``tz``."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=tz)
    return value.astimezone(timezone.utc)


def _empty_blocks() -> pd.DataFrame:
    return pd.DataFrame({col: pd.Series(dtype="object") for col in BLOCK_COLUMNS})


def build_blocks(instances: list[Instance], config: Config) -> tuple[pd.DataFrame, IngestReport]:
    """One row per valid event instance with its parsed title, plus a report of skipped events, overlaps
    and title issues.

    Focus is decided here, on the whole block, before splitting into parts or at midnight.
    """
    tz = config.tz
    report = IngestReport()
    focus = {c.casefold() for c in config.focus_categories}
    rows = []

    for inst in instances:
        def skip(reason: str):
            report.skipped.append({"uid": inst.uid, "title": inst.title, "start": inst.start, "reason": reason})

        if inst.cancelled:
            skip("cancelled")
        elif inst.start is None or not isinstance(inst.start, datetime):
            skip("all_day")  # date-only events are reminders, not time blocks
        elif inst.end is None:
            skip("no_end")
        elif not isinstance(inst.end, datetime):
            skip("all_day")
        else:
            start_utc, end_utc = _to_utc(inst.start, tz), _to_utc(inst.end, tz)
            if end_utc <= start_utc:
                skip("non_positive_duration")
                continue
            parsed = syntax.parse_title(inst.title, config)
            category = parsed.category or UNCATEGORIZED
            minutes = (end_utc - start_utc).total_seconds() / 60
            rows.append({
                "uid": inst.uid, "title": inst.title, "description": inst.description,
                "comment": syntax.clean_description(inst.description),
                "start_utc": start_utc, "end_utc": end_utc, "duration_min": minutes,
                "category": category, "task": parsed.task, "subcategories": parsed.subcategories,
                "tags": parsed.tags, "projects": parsed.projects, "score": parsed.score, "issues": parsed.issues,
                "is_focus": category.casefold() in focus and minutes >= config.focus_min_minutes,
            })

    if not rows:
        return _empty_blocks(), report

    blocks = pd.DataFrame(rows).sort_values(["start_utc", "end_utc"], kind="stable").reset_index(drop=True)
    blocks["start_utc"] = pd.to_datetime(blocks["start_utc"], utc=True)
    blocks["end_utc"] = pd.to_datetime(blocks["end_utc"], utc=True)
    blocks["start_local"] = blocks["start_utc"].dt.tz_convert(tz)
    blocks["end_local"] = blocks["end_utc"].dt.tz_convert(tz)
    blocks["score"] = blocks["score"].astype("Int64")  # missing stays <NA>, so averages skip it
    blocks.insert(0, "block_id", range(len(blocks)))
    blocks = blocks[BLOCK_COLUMNS]
    report.overlaps = find_overlaps(blocks)
    report.title_issues = validation_report(blocks)
    return blocks, report


def validation_report(blocks: pd.DataFrame) -> dict[str, list[dict]]:
    """Blocks whose titles have issues, grouped by issue code, so they can be fixed in the calendar.

    Only time blocks are checked: all-day events and other skipped events are never listed.
    """
    report: dict[str, list[dict]] = {}
    for row in blocks.itertuples(index=False):
        for code in row.issues:
            report.setdefault(code, []).append({"block_id": row.block_id, "title": row.title,
                                                "start_local": row.start_local, "issues": list(row.issues)})
    return report


def find_overlaps(blocks: pd.DataFrame) -> list[dict]:
    """Pairs of blocks that cover the same moment, with the overlap length in minutes."""
    overlaps = []
    ordered = blocks.sort_values("start_utc")
    ids, starts, ends = ordered["block_id"].tolist(), ordered["start_utc"].tolist(), ordered["end_utc"].tolist()
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if starts[j] >= ends[i]:
                break  # sorted by start: nothing later can overlap block i
            minutes = (min(ends[i], ends[j]) - starts[j]).total_seconds() / 60
            if minutes > 0:
                overlaps.append({"block_a": ids[i], "block_b": ids[j], "minutes": minutes})
    return overlaps


# --- parts and segments ----------------------------------------------------------------------

def split_parts(blocks: pd.DataFrame) -> pd.DataFrame:
    """One row per subcategory: the block's time cut into equal back-to-back slices, in title order.

    ``ME: chill - youtube`` at 09:00-11:00 gives chill 09:00-10:00 and youtube 10:00-11:00. The last slice ends
    exactly at the block's end, so totals are preserved. A block with no subcategory is one part.
    """
    rows = []
    for block in blocks.itertuples(index=False):
        names = block.subcategories or [""]
        start, end = block.start_utc.to_pydatetime(), block.end_utc.to_pydatetime()
        step = (end - start) / len(names)
        details = {col: getattr(block, col) for col in _BLOCK_DETAILS}
        for i, name in enumerate(names):
            part_end = end if i == len(names) - 1 else start + step * (i + 1)
            rows.append({"part_index": i, "subcategory": name, **details,
                         "start_utc": start + step * i, "end_utc": part_end})
    if not rows:
        return pd.DataFrame({col: pd.Series(dtype="object") for col in PART_COLUMNS})
    return pd.DataFrame(rows)[PART_COLUMNS]


def split_segments(parts: pd.DataFrame, config: Config, start_utc: datetime, end_utc: datetime) -> pd.DataFrame:
    """Split parts at local midnight and clip them to [start_utc, end_utc).

    Durations are measured on UTC instants, so days with 23 or 25 hours stay correct. Day labels follow the
    user's ``days_off`` and ``week_start``.
    """
    tz = config.tz
    rows = []
    for part in parts.itertuples(index=False):
        details = {col: getattr(part, col) for col in _PART_DETAILS}
        cursor = max(_as_datetime(part.start_utc), start_utc)
        part_end = min(_as_datetime(part.end_utc), end_utc)
        while cursor < part_end:
            local = cursor.astimezone(tz)
            next_midnight = _local_midnight_utc(local.date() + timedelta(days=1), tz)
            if next_midnight <= cursor:  # a zone that skips midnight: always make progress
                next_midnight = cursor + timedelta(hours=1)
            seg_end = min(part_end, next_midnight)
            day_name = WEEKDAYS[local.weekday()]
            day_off = day_name in config.days_off
            rows.append({
                **details,
                "date": local.date(), "day_of_week": day_name, "is_day_off": day_off,
                "day_type": "Day off" if day_off else "Workday",
                "week_start": week_start_of(local.date(), config.week_start),
                "start_local": cursor.astimezone(tz), "end_local": seg_end.astimezone(tz),
                "duration_min": (seg_end - cursor).total_seconds() / 60,
            })
            cursor = seg_end

    if not rows:
        return pd.DataFrame({col: pd.Series(dtype="object") for col in SEGMENT_COLUMNS})
    segments = pd.DataFrame(rows)[SEGMENT_COLUMNS]
    segments["start_local"] = pd.to_datetime(segments["start_local"], utc=True).dt.tz_convert(tz)
    segments["end_local"] = pd.to_datetime(segments["end_local"], utc=True).dt.tz_convert(tz)
    segments["score"] = segments["score"].astype("Int64")
    return segments


def _as_datetime(value) -> datetime:
    return value.to_pydatetime() if isinstance(value, pd.Timestamp) else value


# --- convenience -----------------------------------------------------------------------------

def analyze(source: bytes | str | Path, first_day: date, last_day: date, config: Config,
            ) -> tuple[pd.DataFrame, pd.DataFrame, IngestReport]:
    """Whole pipeline for the local days first_day..last_day (inclusive). Returns (blocks, segments, report)."""
    tz = config.tz
    start_utc, end_utc = local_day_bounds(first_day, last_day, tz)
    cal = load_calendar(source)
    blocks, report = build_blocks(expand_instances(cal, start_utc, end_utc), config)
    report.calendar_first, report.calendar_last = calendar_span(cal, tz)
    return blocks, split_segments(split_parts(blocks), config, start_utc, end_utc), report
