"""Regression tests for the CSV that the app reads, on the synthetic fixture.

These started as expected failures in Stage 0 (IDs refer to c-c-k/docs/CODE_REVIEW.md) and became
real tests when Stage 1 fixed the parser.
"""
import pandas as pd

import runner
from conftest import FIXTURE_CONFIG


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
                        "--config", str(FIXTURE_CONFIG)])

    assert code == 0
    out = capsys.readouterr().out
    assert "Successfully processed" in out and "config.example.yaml" in out
    df = pd.read_csv(csv_path)
    assert df["duration_minutes"].sum() == 41 * 60 and df["is_focus_session"].sum() == 3


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


# --- Stage 2: config, days off, even split ---------------------------------------------------

def _cli_csv(tmp_path, ics_path, *extra) -> pd.DataFrame:
    out = tmp_path / "result.csv"
    code = runner.main(["--ics_path", str(ics_path), "--start_date", "2025-09-01", "--end_date", "2025-09-08",
                        "--out", str(out), *extra])
    assert code == 0
    return pd.read_csv(out)


def _day_type(df, day):
    return df.loc[df["date"] == day, "day_type"].iloc[0]


def test_out_option_writes_where_asked_and_not_to_data(fixture_ics, tmp_path, monkeypatch):
    default_path = tmp_path / "default.csv"
    monkeypatch.setattr(runner, "OUTPUT_CSV_PATH", str(default_path))

    _cli_csv(tmp_path, fixture_ics, "--config", str(FIXTURE_CONFIG))

    assert (tmp_path / "result.csv").exists() and not default_path.exists()


def test_days_off_come_from_the_config_file(fixture_ics, tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("timezone: Asia/Tehran\ndays_off: [Saturday]\ncategories: {SLEEP: {}, ME: {}}\n")

    df = _cli_csv(tmp_path, fixture_ics, "--config", str(cfg))

    assert (_day_type(df, "2025-09-06"), _day_type(df, "2025-09-05")) == ("Weekend", "Weekday")


def test_days_off_flag_and_legacy_weekdays_flag(fixture_ics, tmp_path):
    df = _cli_csv(tmp_path, fixture_ics, "--config", str(FIXTURE_CONFIG), "--days_off", "Saturday", "Sunday")
    assert (_day_type(df, "2025-09-06"), _day_type(df, "2025-09-05")) == ("Weekend", "Weekday")

    df = _cli_csv(tmp_path, fixture_ics, "--config", str(FIXTURE_CONFIG),
                  "--weekdays", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    assert (_day_type(df, "2025-09-06"), _day_type(df, "2025-09-05")) == ("Weekend", "Weekday")


def test_old_app_arguments_are_still_accepted(fixture_ics, tmp_path):
    df = _cli_csv(tmp_path, fixture_ics, "--config", str(FIXTURE_CONFIG), "--cat_delimiter", ":",
                  "--subcat_delimiter", "-", "--focus_categories", "work,", "learning,", "learn,", "project",
                  "--focus_minutes", "90", "--timezone", "Asia/Tehran", "--period", "1m")

    assert df["is_focus_session"].sum() == 1  # only LEARN is both configured and in the app's old focus list


def test_even_split_reaches_the_csv(tmp_path):
    ics = tmp_path / "split.ics"
    ics.write_text("BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\nBEGIN:VEVENT\nUID:a\n"
                   "DTSTART:20250902T053000Z\nDTEND:20250902T073000Z\nSUMMARY:ME: chill - youtube [3]\n"
                   "END:VEVENT\nEND:VCALENDAR\n")

    df = _cli_csv(tmp_path, ics, "--config", str(FIXTURE_CONFIG))

    assert list(zip(df["subcategory_1"], df["start_time"], df["end_time"], df["duration_minutes"])) == [
        ("chill", "09:00", "10:00", 60), ("youtube", "10:00", "11:00", 60)]


def test_invalid_config_and_title_issues_are_reported(fixture_ics, tmp_path, capsys):
    bad = tmp_path / "bad.yaml"
    bad.write_text("timezone: UTC\ncategories: {ME: {}}\ndays_off: [Fryday]\n")

    assert runner.main(["--ics_path", str(fixture_ics), "--config", str(bad), "--out", str(tmp_path / "x.csv")]) == 1
    assert "days_off[0]: 'Fryday' is not a weekday" in capsys.readouterr().err

    small = tmp_path / "small.yaml"
    small.write_text("timezone: Asia/Tehran\ncategories: {SLEEP: {}, ME: {}}\n")
    _cli_csv(tmp_path, fixture_ics, "--config", str(small))
    assert "Title issue unknown_category" in capsys.readouterr().out
