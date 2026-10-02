"""Turn an ICS calendar into correct time blocks and per-day segments.

Pure functions only: no Streamlit, no file writing. Spec: c-c-k/docs/stages/STAGE_1_parser_correctness.md.

Pipeline: load_calendar -> expand_instances -> build_blocks -> split_segments (or ``analyze`` for all of it).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
import recurring_ical_events
from icalendar import Calendar

DEFAULT_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")

BLOCK_COLUMNS = ["block_id", "uid", "title", "description", "start_utc", "end_utc", "start_local", "end_local",
                 "duration_min", "category", "subcategory", "is_focus"]
SEGMENT_COLUMNS = ["block_id", "uid", "title", "description", "category", "subcategory", "is_focus",
                   "date", "day_of_week", "day_type", "start_local", "end_local", "duration_min"]


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


# --- blocks ----------------------------------------------------------------------------------

def parse_title(title: str, cat_delimiter: str = ":") -> tuple[str, str]:
    """Temporary minimal title parse (Stage 2 replaces it): ``CATEGORY: rest`` -> (CATEGORY, rest).

    No delimiter: the whole title is the category and the subcategory is empty (same as the old behaviour).
    """
    if cat_delimiter and cat_delimiter in title:
        category, rest = title.split(cat_delimiter, 1)
        return category.strip().upper(), rest.strip()
    return title.strip().upper(), ""


def _to_utc(value: datetime, tz: ZoneInfo) -> datetime:
    """Aware values keep their instant; floating (naive) values are wall-clock time in ``tz``."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=tz)
    return value.astimezone(timezone.utc)


def _empty_blocks() -> pd.DataFrame:
    return pd.DataFrame({col: pd.Series(dtype="object") for col in BLOCK_COLUMNS})


def build_blocks(instances: list[Instance], tz: ZoneInfo, focus_categories=(), focus_minutes: int = 90,
                 cat_delimiter: str = ":") -> tuple[pd.DataFrame, IngestReport]:
    """One row per valid event instance, plus a report of skipped events and overlaps.

    Focus is decided here, on the whole block, before any splitting at midnight.
    """
    report = IngestReport()
    focus = {c.strip().casefold() for c in focus_categories}
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
            category, subcategory = parse_title(inst.title, cat_delimiter)
            minutes = (end_utc - start_utc).total_seconds() / 60
            rows.append({
                "uid": inst.uid, "title": inst.title, "description": inst.description,
                "start_utc": start_utc, "end_utc": end_utc, "duration_min": minutes,
                "category": category, "subcategory": subcategory,
                "is_focus": category.casefold() in focus and minutes >= focus_minutes,
            })

    if not rows:
        return _empty_blocks(), report

    blocks = pd.DataFrame(rows).sort_values(["start_utc", "end_utc"], kind="stable").reset_index(drop=True)
    blocks["start_utc"] = pd.to_datetime(blocks["start_utc"], utc=True)
    blocks["end_utc"] = pd.to_datetime(blocks["end_utc"], utc=True)
    blocks["start_local"] = blocks["start_utc"].dt.tz_convert(tz)
    blocks["end_local"] = blocks["end_utc"].dt.tz_convert(tz)
    blocks.insert(0, "block_id", range(len(blocks)))
    blocks = blocks[BLOCK_COLUMNS]
    report.overlaps = find_overlaps(blocks)
    return blocks, report


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


# --- segments --------------------------------------------------------------------------------

def split_segments(blocks: pd.DataFrame, tz: ZoneInfo, start_utc: datetime, end_utc: datetime,
                   weekdays=DEFAULT_WEEKDAYS) -> pd.DataFrame:
    """Split blocks at local midnight and clip them to [start_utc, end_utc).

    Durations are measured on UTC instants, so days with 23 or 25 hours stay correct.
    """
    weekdays = set(weekdays)
    utc = timezone.utc
    rows = []
    for block in blocks.itertuples(index=False):
        cursor = max(block.start_utc.to_pydatetime(), start_utc)
        block_end = min(block.end_utc.to_pydatetime(), end_utc)
        while cursor < block_end:
            local = cursor.astimezone(tz)
            next_midnight = _local_midnight_utc(local.date() + timedelta(days=1), tz)
            if next_midnight <= cursor:  # a zone that skips midnight: always make progress
                next_midnight = cursor + timedelta(hours=1)
            seg_end = min(block_end, next_midnight)
            day_name = local.strftime("%A")
            rows.append({
                "block_id": block.block_id, "uid": block.uid, "title": block.title,
                "description": block.description, "category": block.category,
                "subcategory": block.subcategory, "is_focus": block.is_focus,
                "date": local.date(), "day_of_week": day_name,
                "day_type": "Weekday" if day_name in weekdays else "Weekend",
                "start_local": cursor.astimezone(tz), "end_local": seg_end.astimezone(tz),
                "duration_min": (seg_end - cursor).total_seconds() / 60,
            })
            cursor = seg_end

    if not rows:
        return pd.DataFrame({col: pd.Series(dtype="object") for col in SEGMENT_COLUMNS})
    segments = pd.DataFrame(rows)[SEGMENT_COLUMNS]
    segments["start_local"] = pd.to_datetime(segments["start_local"], utc=True).dt.tz_convert(tz)
    segments["end_local"] = pd.to_datetime(segments["end_local"], utc=True).dt.tz_convert(tz)
    return segments


# --- convenience -----------------------------------------------------------------------------

def analyze(source: bytes | str | Path, first_day: date, last_day: date, tz_name: str,
            focus_categories=(), focus_minutes: int = 90, weekdays=DEFAULT_WEEKDAYS, cat_delimiter: str = ":",
            ) -> tuple[pd.DataFrame, pd.DataFrame, IngestReport]:
    """Whole pipeline for the local days first_day..last_day (inclusive). Returns (blocks, segments, report)."""
    tz = get_tz(tz_name)
    start_utc, end_utc = local_day_bounds(first_day, last_day, tz)
    instances = expand_instances(load_calendar(source), start_utc, end_utc)
    blocks, report = build_blocks(instances, tz, focus_categories, focus_minutes, cat_delimiter)
    return blocks, split_segments(blocks, tz, start_utc, end_utc, weekdays), report
