"""Stage 1 acceptance tests for src/ingest.py (spec: c-c-k/docs/stages/STAGE_1_parser_correctness.md)."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

import ingest

FIXTURE_ICS = Path(__file__).parent / "fixtures" / "google_export_sample.ics"
FOCUS = ["JOB", "CLASS", "LEARN", "RESEARCH"]
FIRST_DAY, LAST_DAY = date(2025, 9, 1), date(2025, 9, 8)


def make_ics(*events: str) -> str:
    """Build a tiny synthetic calendar from raw VEVENT bodies (for edge-case tests)."""
    body = "\n".join(f"BEGIN:VEVENT\n{e.strip()}\nEND:VEVENT" for e in events)
    return f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\n{body}\nEND:VCALENDAR\n"


def run(source, tz_name="Asia/Tehran", first=FIRST_DAY, last=LAST_DAY, focus=FOCUS, focus_minutes=90):
    return ingest.analyze(source, first, last, tz_name, focus_categories=focus, focus_minutes=focus_minutes)


@pytest.fixture(scope="module")
def result():
    return run(FIXTURE_ICS)


def block(blocks, text):
    rows = blocks[blocks["title"].str.contains(text, case=False)]
    assert len(rows) == 1, f"expected one block matching {text!r}, got {len(rows)}"
    return rows.iloc[0]


# --- fixture acceptance criteria -------------------------------------------------------------

def test_fixture_has_10_blocks_and_2_skipped(result):
    blocks, _, report = result

    assert len(blocks) == 10
    skipped = {(s["title"], s["reason"]) for s in report.skipped}
    assert skipped == {("Birthday reminder", "all_day"), ("SOCIAL: family dinner [5]", "cancelled")}
    assert [s["start"].date() for s in report.skipped if s["reason"] == "cancelled"] == [date(2025, 9, 8)]


def test_four_sleep_blocks_with_exact_times(result):
    blocks, _, _ = result

    sleep = blocks[blocks["category"] == "SLEEP"].sort_values("start_local")
    got = [(s.strftime("%d %H:%M"), e.strftime("%d %H:%M")) for s, e in zip(sleep["start_local"], sleep["end_local"])]
    assert got == [("01 23:00", "02 07:00"), ("02 23:00", "03 07:00"),
                   ("05 01:00", "05 08:00"), ("05 23:00", "06 07:00")]  # none on 3->4 Sep (EXDATE)


def test_recurring_family_dinner_on_1_sep(result):
    blocks, _, _ = result

    dinner = block(blocks, "family dinner")
    assert dinner["start_local"].strftime("%Y-%m-%d %H:%M") == "2025-09-01 19:00"
    assert dinner["duration_min"] == 120


def test_duration_event_has_60_minutes(result):
    blocks, _, _ = result

    lunch = block(blocks, "lunch")
    assert (lunch["start_local"].strftime("%Y-%m-%d %H:%M"), lunch["end_local"].strftime("%H:%M")) == (
        "2025-09-02 14:00", "15:00")
    assert lunch["duration_min"] == 60


def test_learn_is_one_focus_block_with_description(result):
    blocks, segments, _ = result

    learn = block(blocks, "calculus")
    assert learn["duration_min"] == 120
    assert bool(learn["is_focus"]) is True
    assert learn["description"] == "got stuck on limits, review chapter 3"
    assert learn["start_local"].strftime("%H:%M") == "09:00"
    assert len(segments[segments["block_id"] == learn["block_id"]]) == 1


def test_no_time_split_on_hyphens(result):
    blocks, _, _ = result

    learn = block(blocks, "calculus")
    assert learn["category"] == "LEARN"
    assert learn["subcategory"] == "calculus ch.4 #deep +exam-prep [4]"  # minimal parse; Stage 2 replaces


def test_utc_class_block_is_split_at_local_midnight(result):
    blocks, segments, _ = result

    lab = block(blocks, "lab report")
    segs = segments[segments["block_id"] == lab["block_id"]].sort_values("start_local")
    assert [(s["date"], s["start_local"].strftime("%H:%M"), s["end_local"].strftime("%H:%M"), s["duration_min"])
            for _, s in segs.iterrows()] == [(date(2025, 9, 6), "23:00", "00:00", 60),
                                             (date(2025, 9, 7), "00:00", "01:00", 60)]


def test_exactly_three_focus_blocks(result):
    blocks, _, _ = result

    focus = blocks[blocks["is_focus"]]
    assert sorted(focus["duration_min"]) == [90, 120, 120]
    assert set(focus["category"]) == {"LEARN", "CLASS", "RESEARCH"}


def test_hours_per_local_date(result):
    _, segments, _ = result

    hours = (segments.groupby("date")["duration_min"].sum() / 60).to_dict()
    assert hours == {date(2025, 9, 1): 3.0, date(2025, 9, 2): 11.0, date(2025, 9, 3): 8.5,
                     date(2025, 9, 4): 1.5, date(2025, 9, 5): 8.0, date(2025, 9, 6): 8.0, date(2025, 9, 7): 1.0}
    assert sum(hours.values()) == 41.0


def test_invariants(result):
    blocks, segments, report = result
    tz = ingest.get_tz("Asia/Tehran")

    assert segments["duration_min"].sum() == blocks["duration_min"].sum()
    assert (segments["end_local"] > segments["start_local"]).all()
    assert report.overlaps == []
    for day, minutes in segments.groupby("date")["duration_min"].sum().items():
        assert minutes / 60 <= ingest.day_length_hours(day, tz)


def test_columns_follow_the_spec(result):
    blocks, segments, _ = result

    for col in ["uid", "title", "description", "start_utc", "end_utc", "start_local", "end_local",
                "duration_min", "category", "subcategory", "is_focus"]:
        assert col in blocks.columns
    for col in ["block_id", "date", "day_of_week", "day_type", "start_local", "end_local", "duration_min"]:
        assert col in segments.columns
    assert str(blocks["start_utc"].dt.tz) == "UTC"


def test_day_type_uses_weekdays(result):
    _, segments, _ = result

    by_date = segments.drop_duplicates("date").set_index("date")["day_type"]
    assert by_date[date(2025, 9, 1)] == "Weekday"  # Monday
    assert by_date[date(2025, 9, 6)] == "Weekend"  # Saturday


# --- edge cases on small synthetic calendars -------------------------------------------------

def test_overlaps_are_reported_not_hidden():
    ics = make_ics(
        "UID:a\nDTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:ME: a",
        "UID:b\nDTSTART:20250902T103000Z\nDTEND:20250902T113000Z\nSUMMARY:ME: b",
        "UID:c\nDTSTART:20250902T113000Z\nDTEND:20250902T120000Z\nSUMMARY:ME: c",  # adjacent, not overlapping
    )

    blocks, segments, report = run(ics, "UTC")

    assert len(report.overlaps) == 1
    overlap = report.overlaps[0]
    assert overlap["minutes"] == 30
    assert {blocks.loc[blocks["block_id"] == overlap[k], "title"].iloc[0] for k in ("block_a", "block_b")} == {
        "ME: a", "ME: b"}
    assert segments["duration_min"].sum() == 150  # totals are not silently reduced


def test_dst_spring_forward_day_is_23_hours_and_event_is_measured_in_real_time():
    tz = ingest.get_tz("Europe/Berlin")
    assert ingest.day_length_hours(date(2025, 3, 30), tz) == 23.0
    assert ingest.day_length_hours(date(2025, 3, 29), tz) == 24.0

    ics = make_ics(
        # 01:00 CET -> 04:00 CEST local wall clock, but only 2 real hours (the 02:00-03:00 hour does not exist)
        "UID:a\nDTSTART:20250330T000000Z\nDTEND:20250330T020000Z\nSUMMARY:JOB: across the gap",
        # 22:00 CET on the 29th -> 08:00 CEST on the 30th: 9 real hours, split at local midnight
        "UID:b\nDTSTART:20250329T210000Z\nDTEND:20250330T060000Z\nSUMMARY:SLEEP: night",
    )

    blocks, segments, _ = run(ics, "Europe/Berlin", date(2025, 3, 29), date(2025, 3, 30))

    gap = block(blocks, "across the gap")
    assert gap["duration_min"] == 120
    assert gap["start_local"].strftime("%H:%M") == "01:00" and gap["end_local"].strftime("%H:%M") == "04:00"
    night = segments[segments["title"] == "SLEEP: night"].sort_values("start_local")
    assert list(night["date"]) == [date(2025, 3, 29), date(2025, 3, 30)]
    assert list(night["duration_min"]) == [120, 420]


def test_unknown_timezone_gives_a_readable_error():
    with pytest.raises(ValueError, match="Mars/Olympus"):
        ingest.get_tz("Mars/Olympus")
    with pytest.raises(ValueError, match="Mars/Olympus"):
        run(make_ics("UID:a\nDTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:ME: a"), "Mars/Olympus")


def test_event_without_end_is_skipped_and_reported():
    ics = make_ics(
        "UID:a\nDTSTART:20250902T100000Z\nSUMMARY:ME: no end",
        "UID:b\nDTSTART:20250902T120000Z\nDTEND:20250902T120000Z\nSUMMARY:ME: zero length",
        "UID:c\nDTSTART:20250902T130000Z\nDTEND:20250902T140000Z\nSUMMARY:ME: fine",
    )

    blocks, _, report = run(ics, "UTC")

    assert list(blocks["title"]) == ["ME: fine"]
    assert {(s["title"], s["reason"]) for s in report.skipped} == {
        ("ME: no end", "no_end"), ("ME: zero length", "non_positive_duration")}


def test_floating_time_means_wall_clock_in_the_analysis_timezone():
    ics = make_ics("UID:a\nDTSTART:20250902T090000\nDTEND:20250902T100000\nSUMMARY:ME: floating")

    blocks, _, _ = run(ics, "Asia/Tehran")

    row = block(blocks, "floating")
    assert row["start_local"].strftime("%H:%M") == "09:00"  # not 12:30 (which UTC-as-local would give)
    assert row["start_utc"] == pd.Timestamp("2025-09-02 05:30", tz="UTC")


def test_focus_matching_is_case_insensitive_and_needs_minimum_duration():
    ics = make_ics(
        "UID:a\nDTSTART:20250902T100000Z\nDTEND:20250902T113000Z\nSUMMARY:learn: long enough",
        "UID:b\nDTSTART:20250902T120000Z\nDTEND:20250902T123000Z\nSUMMARY:LEARN: too short",
    )

    blocks, _, _ = run(ics, "UTC", focus=["learn"])

    assert bool(block(blocks, "long enough")["is_focus"]) is True
    assert bool(block(blocks, "too short")["is_focus"]) is False


def test_title_without_colon_keeps_whole_title_as_category():
    ics = make_ics("UID:a\nDTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:Sleep")

    blocks, _, _ = run(ics, "UTC")

    row = blocks.iloc[0]
    assert (row["category"], row["subcategory"]) == ("SLEEP", "")


def test_empty_calendar_returns_empty_frames_with_columns():
    blocks, segments, report = run(make_ics(), "UTC")

    assert blocks.empty and segments.empty
    assert "duration_min" in blocks.columns and "block_id" in segments.columns
    assert report.skipped == [] and report.overlaps == []


def test_event_outside_range_is_excluded_and_edges_are_clipped():
    ics = make_ics(
        "UID:a\nDTSTART:20250815T100000Z\nDTEND:20250815T110000Z\nSUMMARY:ME: far before",
        "UID:b\nDTSTART:20250831T200000Z\nDTEND:20250831T230000Z\nSUMMARY:ME: straddles start",  # 31 Aug 23:30 -> 02:30 local
    )

    blocks, segments, _ = run(ics, "Asia/Tehran")

    assert list(blocks["title"]) == ["ME: straddles start"]
    assert blocks.iloc[0]["duration_min"] == 180  # block keeps its full length
    assert list(segments["date"]) == [date(2025, 9, 1)]
    assert segments["duration_min"].sum() == 150  # only the part inside the range is counted
