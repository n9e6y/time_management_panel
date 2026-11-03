from icalendar import Calendar


def test_runner_imports():
    import runner

    assert callable(runner.main) and callable(runner.write_calendar_csv)


def test_fixture_loads_with_icalendar(fixture_ics):
    cal = Calendar.from_ical(fixture_ics.read_bytes())
    events = [c for c in cal.walk() if c.name == "VEVENT"]

    assert len(events) == 10
    assert {"fixture-sleep", "fixture-social", "fixture-learn"} <= {str(e["UID"]) for e in events}
