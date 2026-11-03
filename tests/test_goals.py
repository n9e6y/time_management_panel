"""Weekly and monthly goals: the file, the periods, and every status at its boundary."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

import config
import goals

ROOT = Path(__file__).resolve().parent.parent
CONFIG = config.load_config(ROOT / "config.example.yaml")  # Saturday weeks, Friday off, Asia/Tehran


def segments(*rows: tuple[str, str, str, float], block_id: int | None = None) -> pd.DataFrame:
    """Rows of (date, category, subcategory, hours); each row is its own block unless block_id is given."""
    return pd.DataFrame([
        {"date": day, "category": category, "subcategory": sub, "duration_min": hours * 60,
         "block_id": i if block_id is None else block_id, "part_index": 0}
        for i, (day, category, sub, hours) in enumerate(rows)
    ])


def goal(**kwargs) -> goals.Goal:
    base = {"id": "g", "scope": "LEARN", "every": "week", "type": "floor", "hours": 10.0}
    return goals.Goal(**{**base, **kwargs})


def one(g: goals.Goal, rows: pd.DataFrame, as_of: date) -> goals.GoalProgress:
    return goals.evaluate([g], rows, CONFIG, as_of)[0]


# --- the file ----------------------------------------------------------------------------------

def test_reads_every_goal_type():
    data = {"goals": [
        {"id": "learn", "scope": "LEARN", "every": "week", "type": "floor", "hours": 10},
        {"id": "scroll", "scope": "ME: scrolling", "every": "week", "type": "cap", "hours": 5},
        {"id": "sleep", "scope": "SLEEP", "every": "week", "type": "range", "min": 49, "max": 63},
        {"id": "class", "scope": "CLASS", "every": "week", "type": "fixed"},
        {"id": "social", "scope": "SOCIAL", "every": "month", "type": "floor", "hours": 16},
    ]}

    parsed = goals.goals_from_dict(data, CONFIG)

    assert [g.id for g in parsed] == ["learn", "scroll", "sleep", "class", "social"]
    assert [g.label for g in parsed] == ["≥ 10 h", "≤ 5 h", "49–63 h", "fixed", "≥ 16 h"]
    assert (parsed[1].category, parsed[1].subcategory) == ("ME", "scrolling")
    assert parsed[0].tolerance == goals.DEFAULT_TOLERANCE

def test_missing_file_means_no_goals(tmp_path):
    assert goals.load_goals(tmp_path / "goals.yaml", CONFIG) == []


def test_saves_and_reads_back_the_same_goals(tmp_path):
    original = goals.goals_from_dict({"goals": [
        {"id": "learn", "scope": "LEARN", "every": "week", "type": "floor", "hours": 10, "why": "exams"},
        {"id": "sleep", "scope": "SLEEP", "every": "month", "type": "range", "min": 49, "max": 63},
    ]}, CONFIG)

    path = goals.save_goals(original, tmp_path / "sub" / "goals.yaml")

    assert goals.load_goals(path, CONFIG) == original
    assert "Time Analyzer goals" in path.read_text()


def test_lists_every_problem_at_once():
    with pytest.raises(goals.GoalsError) as exc:
        goals.goals_from_dict({"goals": [
            {"scope": "NOPE", "every": "week", "type": "floor", "hours": 10},
            {"scope": "LEARN", "every": "fortnight", "type": "floor", "hours": -1},
            {"scope": "SLEEP", "every": "week", "type": "range", "min": 60, "max": 40},
            {"scope": "ME", "every": "week", "type": "wish", "hours": 3},
        ]}, CONFIG)

    message = str(exc.value)
    assert "'NOPE' is not one of your categories" in message
    assert "every: expected one of week, month" in message
    assert "hours: expected a number of hours >= 0" in message
    assert "min (60) is above max (40)" in message
    assert "type: expected one of floor, cap, range, fixed" in message


def test_refuses_two_goals_for_the_same_scope_and_period():
    with pytest.raises(goals.GoalsError, match="two goals for LEARN every week"):
        goals.goals_from_dict({"goals": [
            {"scope": "LEARN", "every": "week", "type": "floor", "hours": 10},
            {"scope": "learn", "every": "week", "type": "cap", "hours": 20},
        ]}, CONFIG)


def test_a_category_and_a_month_goal_for_it_can_both_exist():
    parsed = goals.goals_from_dict({"goals": [
        {"scope": "LEARN", "every": "week", "type": "floor", "hours": 10},
        {"scope": "LEARN", "every": "month", "type": "floor", "hours": 40},
    ]}, CONFIG)

    assert len(parsed) == 2


# --- periods -----------------------------------------------------------------------------------

def test_weeks_follow_week_start():
    saturday = config.config_from_dict({**config.config_to_dict(CONFIG), "week_start": "Saturday"})
    monday = config.config_from_dict({**config.config_to_dict(CONFIG), "week_start": "Monday"})

    assert goals.period_of(date(2026, 11, 3), "week", saturday) == (date(2026, 10, 31), date(2026, 11, 6))
    assert goals.period_of(date(2026, 11, 3), "week", monday) == (date(2026, 11, 2), date(2026, 11, 8))


def test_months_are_calendar_months_not_four_weeks():
    assert goals.period_of(date(2026, 2, 15), "month", CONFIG) == (date(2026, 2, 1), date(2026, 2, 28))
    assert goals.period_of(date(2026, 12, 31), "month", CONFIG) == (date(2026, 12, 1), date(2026, 12, 31))


def test_elapsed_share_counts_whole_days():
    first, last = date(2026, 10, 31), date(2026, 11, 6)

    assert goals.elapsed_share(first, last, date(2026, 10, 31)) == pytest.approx(1 / 7)
    assert goals.elapsed_share(first, last, date(2026, 11, 3)) == pytest.approx(4 / 7)
    assert goals.elapsed_share(first, last, date(2026, 11, 6)) == 1.0
    assert goals.elapsed_share(first, last, date(2026, 11, 20)) == 1.0
    assert goals.elapsed_share(first, last, date(2026, 10, 1)) == 0.0


# --- statuses on a finished period -------------------------------------------------------------

@pytest.mark.parametrize("hours, status", [
    (10.0, "met"), (12.0, "met"), (9.0, "close"), (9.5, "close"), (8.9, "missed"), (0.0, "missed"),
])
def test_floor_statuses_including_the_exact_boundary(hours, status):
    rows = segments(("2026-11-06", "LEARN", "calculus", hours))

    assert one(goal(), rows, date(2026, 11, 6)).status == status


@pytest.mark.parametrize("hours, status", [
    (0.0, "within"), (5.0, "within"), (5.5, "close"), (5.6, "over"), (9.0, "over"),
])
def test_cap_statuses_including_the_exact_boundary(hours, status):
    rows = segments(("2026-11-06", "ME", "scrolling", hours))

    assert one(goal(scope="ME: scrolling", type="cap", hours=5.0), rows, date(2026, 11, 6)).status == status


@pytest.mark.parametrize("hours, status", [
    (49.0, "in_range"), (56.0, "in_range"), (63.0, "in_range"),
    (45.0, "close"), (68.0, "close"), (40.0, "below"), (70.0, "above"),
])
def test_range_statuses_including_both_boundaries(hours, status):
    rows = segments(("2026-11-06", "SLEEP", "night", hours))

    assert one(goal(scope="SLEEP", type="range", hours=None, min_hours=49.0, max_hours=63.0),
               rows, date(2026, 11, 6)).status == status


def test_a_fixed_goal_is_never_judged_on_hours():
    rows = segments(("2026-11-06", "CLASS", "lecture", 2.0))

    progress = one(goal(scope="CLASS", type="fixed", hours=None), rows, date(2026, 11, 6))

    assert (progress.status, progress.gap, progress.expected) == ("logged", 0.0, None)
    assert (progress.actual, progress.blocks) == (2.0, 1)


# --- statuses while the period is still running -------------------------------------------------

def test_a_floor_is_judged_against_what_is_expected_by_now():
    # Tuesday 3 Nov: 4 of 7 days of the Saturday week are over, so 10 h/week expects 5.71 h.
    behind = one(goal(), segments(("2026-11-02", "LEARN", "calculus", 5.0)), date(2026, 11, 3))
    on_pace = one(goal(), segments(("2026-11-02", "LEARN", "calculus", 6.0)), date(2026, 11, 3))

    assert behind.running and behind.status == "behind"
    assert behind.expected == pytest.approx(10 * 4 / 7)
    assert behind.gap == pytest.approx(5.0)  # still 5 h short of the full 10 h
    assert on_pace.status == "on_pace"


def test_a_cap_warns_when_this_rate_would_pass_it():
    rows = segments(("2026-11-02", "ME", "scrolling", 4.0))  # 4 h in 4 of 7 days -> 7 h by Friday

    progress = one(goal(scope="ME: scrolling", type="cap", hours=5.0), rows, date(2026, 11, 3))

    assert progress.status == "heading_over"
    assert progress.projected == pytest.approx(7.0)
    assert progress.gap == 0.0  # not past the cap yet


def test_a_range_uses_a_band_that_grows_with_the_week():
    g = goal(scope="SLEEP", type="range", hours=None, min_hours=49.0, max_hours=63.0)

    progress = one(g, segments(("2026-11-02", "SLEEP", "night", 30.0)), date(2026, 11, 3))

    assert (progress.expected_min, progress.expected_max) == (pytest.approx(28.0), pytest.approx(36.0))
    assert progress.status == "on_pace"
    assert one(g, segments(("2026-11-02", "SLEEP", "night", 20.0)), date(2026, 11, 3)).status == "behind"
    assert one(g, segments(("2026-11-02", "SLEEP", "night", 40.0)), date(2026, 11, 3)).status == "heading_over"


# --- scope matching, estimates and coverage -----------------------------------------------------

def test_a_subcategory_goal_matches_case_insensitively():
    rows = segments(("2026-11-06", "ME", "Scrolling", 2.0), ("2026-11-06", "ME", "scrolling", 1.0),
                    ("2026-11-06", "ME", "lunch", 4.0))

    progress = one(goal(scope="ME: scrolling", type="cap", hours=5.0), rows, date(2026, 11, 6))

    assert progress.actual == 3.0  # lunch is not in scope


def test_a_category_goal_counts_every_subcategory():
    rows = segments(("2026-11-06", "ME", "scrolling", 2.0), ("2026-11-06", "ME", "lunch", 4.0))

    assert one(goal(scope="ME", type="cap", hours=5.0), rows, date(2026, 11, 6)).actual == 6.0


def test_only_days_inside_the_period_count():
    rows = segments(("2026-10-30", "LEARN", "calculus", 8.0),   # the week before
                    ("2026-11-02", "LEARN", "calculus", 3.0),
                    ("2026-11-09", "LEARN", "calculus", 8.0))   # the week after

    assert one(goal(), rows, date(2026, 11, 6)).actual == 3.0


def test_hours_from_a_split_title_are_reported_as_estimates():
    rows = pd.DataFrame([
        {"date": "2026-11-06", "category": "ME", "subcategory": "chill", "duration_min": 60,
         "block_id": 1, "part_index": 0},
        {"date": "2026-11-06", "category": "ME", "subcategory": "scrolling", "duration_min": 60,
         "block_id": 1, "part_index": 1},
    ])

    progress = one(goal(scope="ME: scrolling", type="cap", hours=5.0), rows, date(2026, 11, 6))

    assert (progress.actual, progress.estimated) == (1.0, 1.0)


def test_a_verdict_that_rests_on_an_estimate_is_close_not_over():
    # The cap is 5 h; 5.5 h is logged but 1 h of it is an even split, so the real figure may be under.
    rows = pd.DataFrame([
        {"date": "2026-11-06", "category": "ME", "subcategory": "scrolling", "duration_min": 270,
         "block_id": 1, "part_index": 0},
        {"date": "2026-11-06", "category": "ME", "subcategory": "scrolling", "duration_min": 60,
         "block_id": 2, "part_index": 0},
        {"date": "2026-11-06", "category": "ME", "subcategory": "other", "duration_min": 60,
         "block_id": 2, "part_index": 1},
    ])

    progress = one(goal(scope="ME: scrolling", type="cap", hours=5.0), rows, date(2026, 11, 6))

    assert (progress.actual, progress.estimated) == (5.5, 1.0)
    assert progress.status == "close"


def test_low_coverage_is_flagged_so_a_thin_week_is_not_read_as_a_bad_one():
    thin = one(goal(), segments(("2026-11-02", "LEARN", "calculus", 3.0)), date(2026, 11, 6))

    assert thin.low_coverage and thin.coverage < 0.1

    full = [(f"2026-11-0{d}", "SLEEP", "night", 20.0) for d in range(1, 7)]
    rows = segments(*full, ("2026-10-31", "SLEEP", "night", 20.0))
    assert not one(goal(), rows, date(2026, 11, 6)).low_coverage


def test_an_empty_calendar_leaves_every_goal_at_zero():
    progress = one(goal(), pd.DataFrame(), date(2026, 11, 6))

    assert (progress.actual, progress.blocks, progress.status) == (0.0, 0, "missed")


def test_progress_is_plain_data_for_the_api():
    payload = goals.progress_to_dict(one(goal(), segments(("2026-11-02", "LEARN", "x", 6.0)), date(2026, 11, 3)))

    assert payload["id"] == "g" and payload["label"] == "≥ 10 h"
    assert payload["first_day"] == "2026-10-31" and payload["last_day"] == "2026-11-06"
    assert payload["status"] == "on_pace" and payload["running"] is True
    assert payload["expected"] == pytest.approx(5.7143, abs=1e-4)
