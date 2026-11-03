"""Stage 3 date ranges: one definition used by the API and the CLI (CODE_REVIEW M6)."""
from datetime import date

import pytest

import periods
from periods import PeriodError

TODAY = date(2025, 9, 10)  # a Wednesday


def resolve(preset=None, start=None, end=None, week_start="Saturday", today=TODAY):
    return periods.resolve_period(preset, start, end, today=today, week_start=week_start)


@pytest.mark.parametrize("preset, days", [("1w", 7), ("2w", 14), ("1m", 30), ("3m", 90), ("1y", 365), ("5y", 1825)])
def test_rolling_presets_cover_exactly_n_days_up_to_today(preset, days):
    first, last = resolve(preset)

    assert last == TODAY
    assert (last - first).days + 1 == days


def test_this_week_follows_week_start():
    assert resolve("this_week", week_start="Saturday") == (date(2025, 9, 6), TODAY)
    assert resolve("this_week", week_start="Monday") == (date(2025, 9, 8), TODAY)


def test_last_week_is_the_full_previous_week():
    assert resolve("last_week", week_start="Saturday") == (date(2025, 8, 30), date(2025, 9, 5))
    assert resolve("last_week", week_start="Monday") == (date(2025, 9, 1), date(2025, 9, 7))


def test_calendar_months_and_year():
    assert resolve("this_month") == (date(2025, 9, 1), TODAY)
    assert resolve("last_month") == (date(2025, 8, 1), date(2025, 8, 31))
    assert resolve("last_month", today=date(2026, 1, 15)) == (date(2025, 12, 1), date(2025, 12, 31))
    assert resolve("this_year") == (date(2025, 1, 1), TODAY)


def test_custom_dates_accept_dates_or_iso_text():
    assert resolve(start="2025-09-01", end="2025-09-08") == (date(2025, 9, 1), date(2025, 9, 8))
    assert resolve(start=date(2025, 9, 1), end=date(2025, 9, 1)) == (date(2025, 9, 1), date(2025, 9, 1))


@pytest.mark.parametrize("kwargs, message", [
    ({"preset": "1d"}, "Unknown period '1d'"),
    ({"start": "2025-09-08", "end": "2025-09-01"}, "start date is after the end date"),
    ({"start": "2025-09-01"}, "both a start and an end date"),
    ({"start": "01/09/2025", "end": "2025-09-08"}, "YYYY-MM-DD"),
    ({"preset": "1w", "start": "2025-09-01", "end": "2025-09-08"}, "either a period or custom dates"),
    ({}, "either a period or custom dates"),
])
def test_bad_input_gives_a_readable_error(kwargs, message):
    with pytest.raises(PeriodError, match=message):
        resolve(**kwargs)


def test_presets_list_is_what_the_frontend_shows():
    ids = [p["id"] for p in periods.PRESETS]

    assert ids == ["1w", "2w", "1m", "3m", "6m", "1y", "2y", "5y",
                   "this_week", "last_week", "this_month", "last_month", "this_year"]
    assert all(p["label"] and p["kind"] in ("rolling", "calendar") for p in periods.PRESETS)
