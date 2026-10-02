"""Regression tests for the CSV that the app reads, on the synthetic fixture.

These started as expected failures in Stage 0 (IDs refer to c-c-k/docs/CODE_REVIEW.md) and became
real tests when Stage 1 fixed the parser.
"""
from datetime import date

import ingest
import runner


def _summaries(df, text):
    return df[df["full_summary"].str.contains(text, case=False, na=False)]


# CODE_REVIEW C1
def test_recurring_events_are_expanded(run_pipeline):
    df = run_pipeline()

    dinner = _summaries(df, "family dinner")
    assert (dinner["date"] == "2025-09-01").sum() == 1
    row = dinner[dinner["date"] == "2025-09-01"].iloc[0]
    assert (row["start_time"], row["end_time"], row["duration_minutes"]) == ("19:00", "21:00", 120)

    sleep_minutes = df[df["category"].str.upper() == "SLEEP"]["duration_minutes"].sum()
    assert sleep_minutes == 31 * 60  # 3 nights of 8 h + the moved 7 h night, none on 3->4 Sep


# CODE_REVIEW C2
def test_event_with_duration_instead_of_dtend(run_pipeline):
    df = run_pipeline()

    lunch = _summaries(df, "lunch")
    assert len(lunch) == 1
    row = lunch.iloc[0]
    assert (row["date"], row["start_time"], row["end_time"], row["duration_minutes"]) == (
        "2025-09-02", "14:00", "15:00", 60)


# CODE_REVIEW C3
def test_mixed_timezones_do_not_crash(run_pipeline):
    df = run_pipeline()  # fixture mixes TZID events and UTC ("Z") events

    assert not df.empty


# CODE_REVIEW H2
def test_all_day_events_are_not_time_blocks(run_pipeline):
    df = run_pipeline()

    assert _summaries(df, "birthday").empty


# CODE_REVIEW H4
def test_midnight_split_uses_local_timezone(run_pipeline):
    df = run_pipeline()

    lab = _summaries(df, "lab report").sort_values("date")
    assert list(lab["date"]) == ["2025-09-06", "2025-09-07"]
    assert list(lab["duration_minutes"]) == [60, 60]


# CODE_REVIEW M1
def test_cancelled_instances_are_dropped(run_pipeline):
    df = run_pipeline()

    dinner = _summaries(df, "family dinner")
    assert (dinner["date"] == "2025-09-08").sum() == 0


# --- CSV layout and CLI ----------------------------------------------------------------------

def test_csv_keeps_the_columns_the_app_reads(run_pipeline):
    df = run_pipeline()

    assert list(df.columns) == runner.CSV_COLUMNS
    assert df["duration_minutes"].sum() == 41 * 60
    assert (df.loc[df["subcategory_1"] == "no subcategory", "category"] == "SLEEP").sum() == 0


def test_focus_sessions_are_counted_once_per_block(run_pipeline):
    df = run_pipeline()

    assert df["is_focus_session"].sum() == 3  # LEARN, CLASS (two midnight segments), RESEARCH


def test_cli_end_to_end_on_the_fixture(fixture_ics, tmp_path, monkeypatch, capsys):
    csv_path = tmp_path / "out" / "calendar.csv"
    monkeypatch.setattr(runner, "OUTPUT_CSV_PATH", str(csv_path))

    code = runner.main(["--ics_path", str(fixture_ics), "--start_date", "2025-09-01", "--end_date", "2025-09-08",
                        "--timezone", "Asia/Tehran", "--focus_categories", "job", "class", "learn", "research"])

    assert code == 0
    assert "Successfully processed" in capsys.readouterr().out
    assert csv_path.exists()


def test_cli_reports_unknown_timezone_without_traceback(fixture_ics, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(runner, "OUTPUT_CSV_PATH", str(tmp_path / "calendar.csv"))

    code = runner.main(["--ics_path", str(fixture_ics), "--start_date", "2025-09-01", "--end_date", "2025-09-08",
                        "--timezone", "Mars/Olympus"])

    assert code == 1
    assert "Mars/Olympus" in capsys.readouterr().err
    assert not (tmp_path / "calendar.csv").exists()


def test_cli_reports_missing_file_and_bad_dates(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(runner, "OUTPUT_CSV_PATH", str(tmp_path / "calendar.csv"))

    assert runner.main(["--ics_path", str(tmp_path / "nope.ics"), "--start_date", "2025-09-01",
                        "--end_date", "2025-09-08"]) == 1
    assert "No .ics file found" in capsys.readouterr().err
    assert runner.main(["--start_date", "01/09/2025", "--end_date", "2025-09-08"]) == 1
    assert "YYYY-MM-DD" in capsys.readouterr().err


def test_custom_category_delimiter_is_honoured():
    blocks, _, _ = ingest.analyze(b"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\nBEGIN:VEVENT\nUID:a\n"
                                  b"DTSTART:20250902T100000Z\nDTEND:20250902T110000Z\nSUMMARY:work | review\n"
                                  b"END:VEVENT\nEND:VCALENDAR\n", date(2025, 9, 2), date(2025, 9, 2),
                                  "UTC", cat_delimiter="|")

    assert (blocks.iloc[0]["category"], blocks.iloc[0]["subcategory"]) == ("WORK", "review")
