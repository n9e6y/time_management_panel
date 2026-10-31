"""Stage 3.5 Part A: the calendar saved on this computer (spec: c-c-k/docs/stages/STAGE_3_5_remember_and_views.md)."""
from pathlib import Path

import pytest

import config
import store

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "google_export_sample.ics").read_bytes()
CONFIG = config.load_config(ROOT / "config.example.yaml")


def ics(*titles_and_days: tuple[str, str]) -> bytes:
    events = "".join(f"BEGIN:VEVENT\nUID:e{i}\nDTSTART:{day}T090000Z\nDTEND:{day}T100000Z\nSUMMARY:{title}\nEND:VEVENT\n"
                     for i, (title, day) in enumerate(titles_and_days))
    return f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\n{events}END:VCALENDAR\n".encode()


def test_default_folder_is_outside_the_repository(monkeypatch):
    monkeypatch.delenv("TIME_ANALYZER_HOME")

    home = store.data_home()

    assert home == Path.home() / ".time-analyzer"
    assert ROOT not in home.parents and home != ROOT


def test_folder_can_be_set_by_environment(private_data_home):
    assert store.data_home() == private_data_home


def test_describe_reads_the_facts_of_a_file():
    info = store.describe(FIXTURE, "my-log.ics", "2025-09-08T12:00:00+00:00", CONFIG)

    assert (info.name, info.size, info.events) == ("my-log.ics", len(FIXTURE), 10)
    assert (info.first_day, info.last_day) == ("2025-09-01", "2025-09-08")
    assert info.data_as_of == "2025-09-08T12:00:00+00:00"
    assert info.known_share == pytest.approx(9 / 10)  # every title but "Birthday reminder"
    assert len(info.sha256) == 64 and info.loaded_at


def test_describe_rejects_what_is_not_a_calendar():
    with pytest.raises(ValueError):
        store.describe(b"\x00 not a calendar", "x.ics", None, CONFIG)
    assert store.describe(FIXTURE, "x.ics", "not a date", CONFIG).data_as_of is None


def test_save_keeps_one_previous_copy_and_restore_swaps_them(tmp_path):
    s = store.CalendarStore(tmp_path)
    first = store.describe(FIXTURE, "first.ics", None, CONFIG)
    second_body = ics(("ME: lunch", "20251001"))
    second = store.describe(second_body, "second.ics", None, CONFIG)

    s.save(FIXTURE, first)
    assert (s.info().name, s.has_previous()) == ("first.ics", False)
    s.save(second_body, second)
    assert (s.info().name, s.read(), s.has_previous()) == ("second.ics", second_body, True)

    s.restore()
    assert (s.info().name, s.read()) == ("first.ics", FIXTURE)
    assert s.has_previous()  # the swapped-out file can be restored again


def test_remove_deletes_current_and_previous(tmp_path):
    s = store.CalendarStore(tmp_path)
    s.save(FIXTURE, store.describe(FIXTURE, "a.ics", None, CONFIG))
    s.save(FIXTURE, store.describe(FIXTURE, "b.ics", None, CONFIG))

    s.remove()

    assert (s.info(), s.read(), s.has_previous()) == (None, None, False)
    assert list((tmp_path / "calendar").iterdir()) == []


def test_restore_without_a_previous_file_is_an_error(tmp_path):
    with pytest.raises(LookupError):
        store.CalendarStore(tmp_path).restore()


# --- wrong-file guard -------------------------------------------------------------------------

def info_of(body: bytes) -> store.CalendarInfo:
    return store.describe(body, "x.ics", None, CONFIG)


def test_a_newer_export_of_the_same_calendar_passes():
    current = info_of(ics(("ME: a", "20250101"), ("SLEEP: b", "20250601")))
    newer = info_of(ics(("ME: a", "20250101"), ("SLEEP: b", "20250601"), ("LEARN: c", "20250605")))

    assert store.compare(current, newer) == []


def test_guard_flags_a_short_early_or_unfamiliar_file():
    current = info_of(ics(("ME: a", "20250101"), ("SLEEP: b", "20251001")))
    other = info_of(ics(("Team standup", "20250201"), ("Dentist", "20250210"), ("ME: x", "20250215")))

    codes = [w["code"] for w in store.compare(current, other)]

    assert codes == ["shorter_span", "ends_earlier", "few_known_categories"]


def test_nothing_to_compare_on_first_load():
    assert store.compare(None, info_of(FIXTURE)) == []
