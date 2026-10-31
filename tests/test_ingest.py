"""Acceptance tests for backend/ingest.py (specs: c-c-k/docs/stages/STAGE_1_parser_correctness.md and STAGE_2)."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest
import yaml

import config
import ingest

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ICS = ROOT / "tests" / "fixtures" / "google_export_sample.ics"
EXAMPLE_CONFIG = yaml.safe_load((ROOT / "config.example.yaml").read_text())
FIRST_DAY, LAST_DAY = date(2025, 9, 1), date(2025, 9, 8)


def make_ics(*events: str) -> str:
    """Build a tiny synthetic calendar from raw VEVENT bodies (for edge-case tests)."""
    body = "\n".join(f"BEGIN:VEVENT\n{e.strip()}\nEND:VEVENT" for e in events)
    return f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//EN\n{body}\nEND:VCALENDAR\n"


def make_config(tz_name="Asia/Tehran", focus_minutes=90, **changes) -> config.Config:
    """The committed example config, with the analysis timezone and any other settings changed."""
    return config.config_from_dict({**EXAMPLE_CONFIG, "timezone": tz_name, "focus": {"min_minutes": focus_minutes},
                                    **changes})


def run(source, tz_name="Asia/Tehran", first=FIRST_DAY, last=LAST_DAY, **changes):
    return ingest.analyze(source, first, last, make_config(tz_name, **changes))


@pytest.fixture(scope="module")
def result():
    return run(FIXTURE_ICS)


def block(blocks, text):
    rows = blocks[blocks["title"].str.contains(text, case=False, regex=False)]
    assert len(rows) == 1, f"expected one block matching {text!r}, got {len(rows)}"
    return rows.iloc[0]


def times(segments):
    return [(s.strftime("%H:%M"), e.strftime("%H:%M")) for s, e in zip(segments["start_local"], segments["end_local"])]


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
    assert dinner["score"] == 5


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
    assert learn["comment"] == "got stuck on limits, review chapter 3"
    assert learn["start_local"].strftime("%H:%M") == "09:00"
    assert len(segments[segments["block_id"] == learn["block_id"]]) == 1


def test_learn_title_is_parsed_with_the_full_grammar(result):
    blocks, segments, _ = result

    learn = block(blocks, "calculus")
    assert (learn["category"], learn["task"], learn["subcategories"]) == ("LEARN", "calculus ch.4", ["calculus ch.4"])
    assert (learn["tags"], learn["projects"], learn["score"], learn["issues"]) == (["deep"], ["exam-prep"], 4, [])
    seg = segments[segments["block_id"] == learn["block_id"]].iloc[0]
    assert (seg["subcategory"], seg["tags"], seg["score"]) == ("calculus ch.4", ["deep"], 4)


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

    for col in ["uid", "title", "description", "comment", "start_utc", "end_utc", "start_local", "end_local",
                "duration_min", "category", "task", "subcategories", "tags", "projects", "score", "issues",
                "is_focus"]:
        assert col in blocks.columns
    for col in ["block_id", "part_index", "category", "subcategory", "tags", "projects", "score", "comment",
                "is_focus", "date", "day_of_week", "is_day_off", "day_type", "week_start", "start_local",
                "end_local", "duration_min"]:
        assert col in segments.columns
    assert str(blocks["start_utc"].dt.tz) == "UTC"


def test_fixture_titles_are_clean_and_all_day_events_are_not_in_the_validation_report(result):
    _, _, report = result

    assert report.title_issues == {}  # "Birthday reminder" has no colon, but it is all-day, so not a block


# --- days off and week start (user settings) --------------------------------------------------

def test_day_type_follows_days_off(result):
    _, segments, _ = result

    by_date = segments.drop_duplicates("date").set_index("date")
    assert by_date.loc[date(2025, 9, 5), "day_type"] == "Day off"  # Friday, the example config's day off
    assert by_date.loc[date(2025, 9, 6), "day_type"] == "Workday"  # Saturday
    assert bool(by_date.loc[date(2025, 9, 5), "is_day_off"]) is True


def test_changing_days_off_changes_the_flag():
    _, segments, _ = run(FIXTURE_ICS, days_off=["Saturday", "Sunday"])

    by_date = segments.drop_duplicates("date").set_index("date")["is_day_off"]
    assert not by_date[date(2025, 9, 5)] and by_date[date(2025, 9, 6)] and by_date[date(2025, 9, 7)]


def test_week_start_buckets_weeks_from_the_configured_day():
    # 5 Sep 2025 is a Friday, 6 Sep a Saturday.
    _, saturday_weeks, _ = run(FIXTURE_ICS, week_start="Saturday")
    _, monday_weeks, _ = run(FIXTURE_ICS, week_start="Monday")

    sat = saturday_weeks.drop_duplicates("date").set_index("date")["week_start"]
    mon = monday_weeks.drop_duplicates("date").set_index("date")["week_start"]
    assert (sat[date(2025, 9, 5)], sat[date(2025, 9, 6)]) == (date(2025, 8, 30), date(2025, 9, 6))
    assert (mon[date(2025, 9, 5)], mon[date(2025, 9, 6)]) == (date(2025, 9, 1), date(2025, 9, 1))


def test_week_start_of():
    assert ingest.week_start_of(date(2025, 9, 6), "Saturday") == date(2025, 9, 6)
    assert ingest.week_start_of(date(2025, 9, 5), "Saturday") == date(2025, 8, 30)
    assert ingest.week_start_of(date(2025, 9, 7), "Sunday") == date(2025, 9, 7)


# --- even time split on " - " (back-to-back, title order) --------------------------------------

def test_two_parts_split_back_to_back_and_keep_the_block_details():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T110000Z\n"
                   "SUMMARY:ME: chill - youtube #unplanned [3]\nDESCRIPTION:tired")

    blocks, segments, _ = run(ics, "UTC")

    assert len(blocks) == 1 and blocks.iloc[0]["subcategories"] == ["chill", "youtube"]
    segs = segments.sort_values("start_local")
    assert list(segs["subcategory"]) == ["chill", "youtube"]
    assert list(segs["part_index"]) == [0, 1]
    assert times(segs) == [("09:00", "10:00"), ("10:00", "11:00")]
    assert list(segs["duration_min"]) == [60, 60]
    assert list(segs["score"]) == [3, 3]
    assert list(segs["tags"]) == [["unplanned"], ["unplanned"]]
    assert list(segs["comment"]) == ["tired", "tired"]


def test_split_parts_then_split_at_local_midnight():
    # 22:30-01:30 local (Tehran), three parts of 60 min: 22:30-23:30, 23:30-00:30 (crosses midnight), 00:30-01:30
    ics = make_ics("UID:a\nDTSTART:20250902T190000Z\nDTEND:20250902T220000Z\nSUMMARY:LEARN: a - b - c")

    blocks, segments, _ = run(ics)

    segs = segments.sort_values("start_local")
    assert list(zip(segs["subcategory"], segs["date"], segs["duration_min"])) == [
        ("a", date(2025, 9, 2), 60), ("b", date(2025, 9, 2), 30), ("b", date(2025, 9, 3), 30),
        ("c", date(2025, 9, 3), 60)]
    assert segments["duration_min"].sum() == blocks["duration_min"].sum() == 180


def test_uneven_split_preserves_the_total_exactly():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\nSUMMARY:ME: a - b - c")

    blocks, segments, _ = run(ics, "UTC")

    assert segments["duration_min"].sum() == pytest.approx(60)
    segs = segments.sort_values("start_local")
    assert segs.iloc[-1]["end_local"] == blocks.iloc[0]["end_local"]
    assert (segs["start_local"].iloc[1:].values == segs["end_local"].iloc[:-1].values).all()  # no gaps, no overlap


def test_focus_is_decided_on_the_whole_block_before_splitting():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T110000Z\nSUMMARY:LEARN: theory - exercises")

    _, segments, _ = run(ics, "UTC")

    assert segments["is_focus"].all()  # each part is 60 min, below 90, but the block is 120 min


def test_hyphens_without_spaces_never_split():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\nSUMMARY:JOB: follow-up e-mail +q-3")

    _, segments, _ = run(ics, "UTC")

    assert list(segments["subcategory"]) == ["follow-up e-mail"]


# --- titles with issues -----------------------------------------------------------------------

def test_title_without_colon_is_uncategorized_and_reported():
    ics = make_ics("UID:a\nDTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:Lunch break")

    blocks, segments, report = run(ics, "UTC")

    row = blocks.iloc[0]
    assert (row["category"], row["task"], row["issues"]) == ("UNCATEGORIZED", "Lunch break", ["missing_category"])
    assert segments["duration_min"].sum() == 60  # the time still counts
    assert [item["title"] for item in report.title_issues["missing_category"]] == ["Lunch break"]


def test_title_that_is_just_a_category_counts_as_that_category():
    ics = make_ics("UID:a\nDTSTART:20250902T000000Z\nDTEND:20250902T080000Z\nSUMMARY:sleep",
                   "UID:b\nDTSTART:20250903T000000Z\nDTEND:20250903T070000Z\nSUMMARY:Sleep")

    blocks, segments, report = run(ics, "UTC")

    assert list(blocks["category"]) == ["SLEEP", "SLEEP"]
    assert segments.loc[segments["category"] == "SLEEP", "duration_min"].sum() == 15 * 60
    assert report.title_issues == {}


def test_validation_report_groups_blocks_by_issue_code():
    ics = make_ics(
        "UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\nSUMMARY:GYM: legs [7]",
        "UID:b\nDTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:#deep LEARN: x",
        "UID:c\nDTSTART:20250902T110000Z\nDTEND:20250902T120000Z\nSUMMARY:ME: fine",
    )

    _, _, report = run(ics, "UTC")

    titles = {code: [item["title"] for item in items] for code, items in report.title_issues.items()}
    assert titles == {"unknown_category": ["GYM: legs [7]"], "invalid_score": ["GYM: legs [7]"],
                      "tokens_before_category": ["#deep LEARN: x"]}
    item = report.title_issues["tokens_before_category"][0]
    assert set(item) == {"block_id", "title", "start_local", "issues"}


def test_legacy_category_is_its_own_group_tagged_unplanned():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\nSUMMARY:URGENT: fix laptop")

    blocks, _, report = run(ics, "UTC")

    assert (blocks.iloc[0]["category"], blocks.iloc[0]["tags"]) == ("URGENT", ["unplanned"])
    assert list(report.title_issues) == ["legacy_category"]


def test_html_description_becomes_a_clean_comment():
    ics = make_ics("UID:a\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\nSUMMARY:ME: a\n"
                   "DESCRIPTION:a<br>b &amp; c")

    blocks, _, _ = run(ics, "UTC")

    assert blocks.iloc[0]["comment"] == "a\nb & c"


def test_missing_scores_stay_missing_not_zero(result):
    blocks, _, _ = result

    assert pd.isna(block(blocks, "lunch")["score"])
    assert blocks["score"].mean() == pytest.approx((5 + 4 + 3 + 2) / 4)  # only scored blocks count


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
        "UID:c\nDTSTART:20250902T130000Z\nDTEND:20250902T150000Z\nSUMMARY:ME: not a focus category",
    )

    blocks, _, _ = run(ics, "UTC")

    assert bool(block(blocks, "long enough")["is_focus"]) is True
    assert bool(block(blocks, "too short")["is_focus"]) is False
    assert bool(block(blocks, "not a focus")["is_focus"]) is False


def test_empty_calendar_returns_empty_frames_with_columns():
    blocks, segments, report = run(make_ics(), "UTC")

    assert blocks.empty and segments.empty
    assert "duration_min" in blocks.columns and "block_id" in segments.columns
    assert report.skipped == [] and report.overlaps == [] and report.title_issues == {}


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


# --- calendar span (Stage 3: lets the app say which dates the file covers) ---------------------

def test_report_says_which_dates_the_calendar_covers(result):
    _, _, report = result

    assert (report.calendar_first, report.calendar_last) == (date(2025, 9, 1), date(2025, 9, 8))


def test_calendar_span_ignores_the_analysis_range_and_counts_recurrence_end_dates():
    ics = make_ics("UID:a\nDTSTART:20240105T090000Z\nDTEND:20240105T100000Z\nSUMMARY:ME: a",
                   "UID:b\nDTSTART:20250301T090000Z\nDTEND:20250301T100000Z\nRRULE:FREQ=DAILY;UNTIL=20251231T000000Z\n"
                   "SUMMARY:SLEEP: b")

    _, _, report = run(ics, "UTC", date(2025, 9, 1), date(2025, 9, 2))

    assert (report.calendar_first, report.calendar_last) == (date(2024, 1, 5), date(2025, 12, 31))


def test_empty_calendar_has_no_span():
    _, _, report = run(make_ics(), "UTC")

    assert (report.calendar_first, report.calendar_last) == (None, None)
