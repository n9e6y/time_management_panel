"""Known parser bugs, documented as expected failures.

Each test describes the CORRECT behaviour on the synthetic fixture and is expected to fail on the
current ``runner.py``. IDs refer to c-c-k/docs/CODE_REVIEW.md. ``strict=True`` means that fixing a bug
turns the test into an XPASS failure, which forces the xfail mark to be removed (Stage 1).
"""
import pytest


def known_bug(bug_id: str):
    return pytest.mark.xfail(strict=True, reason=f"CODE_REVIEW {bug_id}")


def _summaries(df, text):
    return df[df["full_summary"].str.contains(text, case=False, na=False)]


@known_bug("C1")
def test_recurring_events_are_expanded(run_pipeline):
    df = run_pipeline()

    dinner = _summaries(df, "family dinner")
    assert (dinner["date"] == "2025-09-01").sum() == 1
    row = dinner[dinner["date"] == "2025-09-01"].iloc[0]
    assert (row["start_time"], row["end_time"], row["duration_minutes"]) == ("19:00", "21:00", 120)

    sleep_minutes = df[df["category"].str.upper() == "SLEEP"]["duration_minutes"].sum()
    assert sleep_minutes == 31 * 60  # 3 nights of 8 h + the moved 7 h night, none on 3->4 Sep


@known_bug("C2")
def test_event_with_duration_instead_of_dtend(run_pipeline):
    df = run_pipeline()

    lunch = _summaries(df, "lunch")
    assert len(lunch) == 1
    row = lunch.iloc[0]
    assert (row["date"], row["start_time"], row["end_time"], row["duration_minutes"]) == (
        "2025-09-02", "14:00", "15:00", 60)


@known_bug("C3")
def test_mixed_timezones_do_not_crash(run_pipeline):
    df = run_pipeline()  # fixture mixes TZID events and UTC ("Z") events

    assert not df.empty


@known_bug("H2")
def test_all_day_events_are_not_time_blocks(run_pipeline):
    df = run_pipeline()

    assert _summaries(df, "birthday").empty


@known_bug("H4")
def test_midnight_split_uses_local_timezone(run_pipeline):
    df = run_pipeline()

    lab = _summaries(df, "lab report").sort_values("date")
    assert list(lab["date"]) == ["2025-09-06", "2025-09-07"]
    assert list(lab["duration_minutes"]) == [60, 60]


@known_bug("M1")
def test_cancelled_instances_are_dropped(run_pipeline):
    df = run_pipeline()

    dinner = _summaries(df, "family dinner")
    assert (dinner["date"] == "2025-09-08").sum() == 0
