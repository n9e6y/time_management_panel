"""Fixing a mistyped event title in the app, without re-exporting the calendar."""
from datetime import date
from pathlib import Path

import pytest

import config
import corrections
import ingest

ROOT = Path(__file__).resolve().parent.parent
CONFIG = config.load_config(ROOT / "config.example.yaml")


def ics(*events: tuple[str, str, str]) -> bytes:
    """Events of (uid, title, YYYYMMDD), each 09:00-10:00 UTC."""
    body = "".join(f"BEGIN:VEVENT\nUID:{uid}\nDTSTART:{day}T090000Z\nDTEND:{day}T100000Z\nSUMMARY:{title}\n"
                   f"END:VEVENT\n" for uid, title, day in events)
    return f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\n{body}END:VCALENDAR\n".encode()


def analyze(body: bytes, fixes: list[corrections.Correction] = ()):
    return ingest.analyze(body, date(2025, 9, 1), date(2025, 9, 30), CONFIG,
                          corrections.resolver(list(fixes)))


# --- the file ----------------------------------------------------------------------------------

def test_reads_both_kinds_of_correction():
    parsed = corrections.corrections_from_dict({"corrections": [
        {"uid": "e1@google.com", "title": "ME: lunch"},
        {"match_title": "LEARm: calculus", "title": "LEARN: calculus"},
    ]})

    assert [c.scope for c in parsed] == ["event", "title"]
    assert [c.key for c in parsed] == ["uid:e1@google.com", "title:LEARm: calculus"]


def test_a_correction_needs_exactly_one_matcher():
    with pytest.raises(corrections.CorrectionsError) as exc:
        corrections.corrections_from_dict({"corrections": [
            {"title": "ME: lunch"},
            {"title": "ME: lunch", "uid": "e1", "match_title": "x"},
            {"uid": "e2"},
        ]})

    message = str(exc.value)
    assert message.count("give either uid") == 2
    assert "title: expected the corrected title" in message


def test_refuses_two_corrections_for_the_same_thing():
    with pytest.raises(corrections.CorrectionsError, match="two corrections for the same title"):
        corrections.corrections_from_dict({"corrections": [
            {"match_title": "LEARm: x", "title": "LEARN: x"},
            {"match_title": "LEARm: x", "title": "LEARN: y"},
        ]})


def test_missing_file_means_no_corrections(tmp_path):
    assert corrections.load_corrections(tmp_path / "corrections.yaml") == []


def test_saves_and_reads_back(tmp_path):
    original = corrections.corrections_from_dict({"corrections": [
        {"match_title": "LEARm: calculus", "title": "LEARN: calculus"},
        {"uid": "e1", "title": "ME: lunch"},
    ]})

    path = corrections.save_corrections(original, tmp_path / "sub" / "corrections.yaml")

    assert corrections.load_corrections(path) == original
    assert "not changed" in path.read_text()  # the header says the calendar file is left alone


# --- applied when the calendar is read ----------------------------------------------------------

def test_without_corrections_a_mistyped_category_is_its_own_unknown_one():
    """This is the "not in your list" row on Data quality: the hours are kept, under LEARM."""
    blocks, _segments, report = analyze(ics(("e1", "LEARm: calculus", "20250902")))

    assert blocks["category"].tolist() == ["LEARM"]
    assert [i["title"] for i in report.title_issues["unknown_category"]] == ["LEARm: calculus"]


def test_without_corrections_a_title_with_no_colon_is_uncategorized():
    blocks, _segments, report = analyze(ics(("e1", "lunch with Sara", "20250902")))

    assert blocks["category"].tolist() == ["UNCATEGORIZED"]
    assert "missing_category" in report.title_issues


def test_fixing_one_title_fixes_every_event_written_that_way():
    body = ics(("e1", "LEARm: calculus", "20250902"), ("e2", "LEARm: calculus", "20250903"),
               ("e3", "ME: lunch", "20250903"))
    fix = [corrections.Correction(title="LEARN: calculus", match_title="LEARm: calculus")]

    blocks, _segments, report = analyze(body, fix)

    assert sorted(blocks["category"].tolist()) == ["LEARN", "LEARN", "ME"]
    assert blocks[blocks["category"] == "LEARN"]["task"].tolist() == ["calculus", "calculus"]
    assert report.title_issues == {}
    assert report.corrected == {"title:LEARm: calculus": 2}


def test_fixing_one_event_leaves_its_twins_alone():
    body = ics(("e1", "LEARm: calculus", "20250902"), ("e2", "LEARm: calculus", "20250903"))
    fix = [corrections.Correction(title="LEARN: calculus", uid="e1")]

    blocks, _segments, report = analyze(body, fix)

    assert sorted(blocks["category"].tolist()) == ["LEARM", "LEARN"]  # e2 keeps the typo
    assert report.corrected == {"uid:e1": 1}


def test_a_fix_for_one_event_wins_over_a_fix_for_the_text():
    body = ics(("e1", "LEARm: x", "20250902"), ("e2", "LEARm: x", "20250903"))
    fixes = [corrections.Correction(title="LEARN: x", match_title="LEARm: x"),
             corrections.Correction(title="RESEARCH: x", uid="e1")]

    blocks, _segments, _report = analyze(body, fixes)

    assert sorted(blocks["category"].tolist()) == ["LEARN", "RESEARCH"]


def test_the_corrected_title_is_what_the_app_shows():
    fix = [corrections.Correction(title="LEARN: calculus #deep [4]", match_title="LEARm: calculus")]

    blocks, segments, _report = analyze(ics(("e1", "LEARm: calculus", "20250902")), fix)

    assert blocks["title"].tolist() == ["LEARN: calculus #deep [4]"]
    assert blocks["tags"].tolist() == [["deep"]]
    assert blocks["score"].tolist() == [4]
    assert segments["title"].tolist() == ["LEARN: calculus #deep [4]"]


def test_every_occurrence_of_a_repeating_event_is_fixed_by_its_uid():
    body = (b"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\n"
            b"BEGIN:VEVENT\nUID:weekly\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\n"
            b"RRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:LEARm: seminar\nEND:VEVENT\nEND:VCALENDAR\n")
    fix = [corrections.Correction(title="LEARN: seminar", uid="weekly")]

    blocks, _segments, report = analyze(body, fix)

    assert blocks["category"].tolist() == ["LEARN"] * 3
    assert report.corrected == {"uid:weekly": 3}


def test_matching_ignores_surrounding_whitespace():
    fix = [corrections.Correction(title="ME: lunch", match_title="  ME lunch  ")]

    blocks, _segments, _report = analyze(ics(("e1", "ME lunch", "20250902")), fix)

    assert blocks["category"].tolist() == ["ME"]


def test_a_correction_that_matches_nothing_changes_nothing():
    fix = [corrections.Correction(title="LEARN: x", match_title="never seen")]

    blocks, _segments, report = analyze(ics(("e1", "ME: lunch", "20250902")), fix)

    assert blocks["category"].tolist() == ["ME"]
    assert report.corrected == {}
