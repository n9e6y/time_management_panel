"""Date ranges for an analysis: the single definition used by the API and the CLI (CODE_REVIEW M6).

A range is a pair of local calendar days (first, last), both inclusive. Pure functions: "today" is passed in.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from ingest import week_start_of

ROLLING_DAYS = {"1w": 7, "2w": 14, "1m": 30, "3m": 90, "6m": 182, "1y": 365, "2y": 730, "5y": 1825}
_ROLLING_LABELS = {"1w": "Last 7 days", "2w": "Last 14 days", "1m": "Last 30 days", "3m": "Last 90 days",
                   "6m": "Last 6 months", "1y": "Last 12 months", "2y": "Last 2 years", "5y": "Last 5 years"}
_CALENDAR_LABELS = {"this_week": "This week", "last_week": "Last week", "this_month": "This month",
                    "last_month": "Last month", "this_year": "This year"}

PRESETS = ([{"id": k, "label": v, "kind": "rolling"} for k, v in _ROLLING_LABELS.items()]
           + [{"id": k, "label": v, "kind": "calendar"} for k, v in _CALENDAR_LABELS.items()])


class PeriodError(ValueError):
    """A period that can't be resolved; the message says what to change."""


def _parse_day(value: date | str, what: str) -> date:
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except ValueError:
        raise PeriodError(f"Invalid {what} date {value!r}. Please use YYYY-MM-DD.") from None


def _calendar(preset: str, today: date, week_start: str) -> tuple[date, date]:
    if preset == "this_week":
        return week_start_of(today, week_start), today
    if preset == "last_week":
        first = week_start_of(today, week_start) - timedelta(days=7)
        return first, first + timedelta(days=6)
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        return last.replace(day=1), last
    return today.replace(month=1, day=1), today  # this_year


def resolve_period(preset: str | None = None, start: date | str | None = None, end: date | str | None = None, *,
                   today: date, week_start: str = "Saturday") -> tuple[date, date]:
    """Resolve a preset id (see PRESETS) or custom start/end dates into (first_day, last_day), inclusive.

    Rolling presets are the last N days up to today. Calendar presets follow ``week_start``; "this ..." periods
    run up to today.
    """
    custom = start is not None or end is not None
    if bool(preset) == custom:
        raise PeriodError("Give either a period or custom dates (start and end), not both or neither.")
    if custom:
        if start is None or end is None:
            raise PeriodError("Custom dates need both a start and an end date.")
        first, last = _parse_day(start, "start"), _parse_day(end, "end")
        if first > last:
            raise PeriodError(f"The start date is after the end date ({first} > {last}).")
        return first, last
    if preset in ROLLING_DAYS:
        return today - timedelta(days=ROLLING_DAYS[preset] - 1), today
    if preset in _CALENDAR_LABELS:
        return _calendar(preset, today, week_start)
    raise PeriodError(f"Unknown period {preset!r}. Use one of: {', '.join(p['id'] for p in PRESETS)}.")
