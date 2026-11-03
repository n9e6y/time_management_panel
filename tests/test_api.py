"""The FastAPI backend: routes, limits, the saved calendar, goals and serving the built frontend."""
import builtins
import io
import os
import shutil
import tempfile
from datetime import date
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

import ingest
from api.main import create_app

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ICS = (ROOT / "tests" / "fixtures" / "google_export_sample.ics").read_bytes()
FIXTURE_RANGE = {"start": "2025-09-01", "end": "2025-09-08"}
FRONTEND = "http://localhost:5173"


@pytest.fixture
def root(tmp_path) -> Path:
    """A project root with only the example config, so tests never read or write the real config.yaml."""
    shutil.copy(ROOT / "config.example.yaml", tmp_path / "config.example.yaml")
    return tmp_path


@pytest.fixture
def client(root) -> TestClient:
    return TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))


def analyze(client, body=FIXTURE_ICS, **params):
    return client.post("/api/analyze", params=params or FIXTURE_RANGE, content=body,
                       headers={"Content-Type": "text/calendar"})


# --- basics -----------------------------------------------------------------------------------

def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_periods_come_from_the_backend(client):
    body = client.get("/api/periods").json()

    assert body["default"] == "1m"
    assert [p["id"] for p in body["presets"]][:3] == ["1w", "2w", "1m"]
    assert "this_week" in [p["id"] for p in body["presets"]]


# --- analyze ----------------------------------------------------------------------------------

def test_analyze_the_fixture(client):
    res = analyze(client)

    assert res.status_code == 200
    body = res.json()
    assert body["totals"] == {"hours": 41.0, "blocks": 10, "segments": 14, "skipped": 2, "overlaps": 0,
                              "title_issues": 0}
    assert body["range"] == {"first_day": "2025-09-01", "last_day": "2025-09-08", "timezone": "Asia/Tehran",
                             "week_start": "Saturday", "days_off": ["Friday"]}
    assert body["config_source"] == "config.example.yaml"
    assert body["calendar"] == {"first_day": "2025-09-01", "last_day": "2025-09-08"}
    assert {s["reason"] for s in body["report"]["skipped"]} == {"all_day", "cancelled"}


def test_analyze_returns_plain_json_values(client):
    body = analyze(client).json()

    learn = next(b for b in body["blocks"] if b["category"] == "LEARN")
    assert (learn["tags"], learn["projects"], learn["score"]) == (["deep"], ["exam-prep"], 4)
    assert learn["start_local"] == "2025-09-02T09:00:00+03:30"
    lunch = next(b for b in body["blocks"] if b["task"] == "lunch")
    assert lunch["score"] is None  # missing, never 0
    seg = body["segments"][0]
    assert seg["date"] == "2025-09-01" and isinstance(seg["is_day_off"], bool)


def test_analyze_with_a_preset_uses_today(client):
    body = analyze(client, period="1w").json()

    assert (body["range"]["first_day"], body["range"]["last_day"]) == ("2025-09-02", "2025-09-08")


def test_same_request_is_served_from_the_cache(client, monkeypatch):
    calls = []
    real = ingest.analyze
    monkeypatch.setattr(ingest, "analyze", lambda *a, **k: calls.append(1) or real(*a, **k))

    first, second = analyze(client), analyze(client)
    other_range = analyze(client, start="2025-09-01", end="2025-09-02")

    assert (first.headers["X-Analysis-Cache"], second.headers["X-Analysis-Cache"]) == ("miss", "hit")
    assert first.json() == second.json()
    assert other_range.headers["X-Analysis-Cache"] == "miss"
    assert len(calls) == 2


def test_upload_is_never_written_to_disk(client, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("tried to write to disk during an upload")

    def guarded_open(real):
        def _open(file, mode="r", *args, **kwargs):
            if any(flag in mode for flag in "wax+"):
                refuse()
            return real(file, mode, *args, **kwargs)
        return _open

    real_os_open = os.open
    monkeypatch.setattr(builtins, "open", guarded_open(builtins.open))
    monkeypatch.setattr(io, "open", guarded_open(io.open))
    monkeypatch.setattr(os, "open", lambda path, flags, *a, **k: refuse() if flags & (os.O_WRONLY | os.O_RDWR)
                        else real_os_open(path, flags, *a, **k))
    for name in ("SpooledTemporaryFile", "NamedTemporaryFile", "TemporaryFile", "mkstemp"):
        monkeypatch.setattr(tempfile, name, refuse)

    # ~1.25 MB: larger than the 1 MB at which form uploads spill to a temp file. Old events, outside the range.
    old = b"".join(b"BEGIN:VEVENT\r\nUID:old-%d\r\nDTSTART:20200101T090000Z\r\nDTEND:20200101T100000Z\r\n"
                   b"SUMMARY:ME: old event %d\r\nDESCRIPTION:padding to make the export realistically large\r\n"
                   b"END:VEVENT\r\n" % (i, i) for i in range(6000))
    big = FIXTURE_ICS.replace(b"END:VCALENDAR", old + b"END:VCALENDAR")
    assert len(big) > 1024 * 1024

    res = analyze(client, body=big)

    assert res.status_code == 200 and res.json()["totals"]["hours"] == 41.0


def test_unreadable_calendar_gives_a_generic_error_without_its_content(client):
    res = analyze(client, body=b"\x00garbage SUMMARY:ME: secret plan")

    assert res.status_code == 400
    assert "secret" not in res.text and "calendar" in res.json()["detail"]


def test_empty_body_and_too_large_body_are_rejected(root):
    client = TestClient(create_app(root=root, max_upload_bytes=1000))

    assert analyze(client, body=b"").status_code == 400
    assert analyze(client, body=FIXTURE_ICS).status_code == 413


def test_bad_period_is_reported(client):
    res = analyze(client, period="1d")

    assert res.status_code == 422 and "Unknown period '1d'" in res.json()["detail"]
    assert analyze(client, start="2025-09-08", end="2025-09-01").status_code == 422


# --- settings ---------------------------------------------------------------------------------

def test_get_config(client):
    body = client.get("/api/config").json()

    assert body["source"] == "config.example.yaml"
    assert body["settings"]["week_start"] == "Saturday" and body["settings"]["days_off"] == ["Friday"]


def test_put_config_saves_config_yaml_and_changes_results(client, root):
    settings = client.get("/api/config").json()["settings"]
    settings["days_off"] = ["Saturday"]

    res = client.put("/api/config", json=settings)

    assert res.status_code == 200 and res.json()["source"] == "config.yaml"
    assert yaml.safe_load((root / "config.yaml").read_text())["days_off"] == ["Saturday"]
    segments = analyze(client).json()["segments"]
    by_date = {s["date"]: s["is_day_off"] for s in segments}
    assert by_date["2025-09-06"] is True and by_date["2025-09-05"] is False


def test_invalid_config_is_rejected_with_every_problem_and_nothing_is_written(client, root):
    settings = client.get("/api/config").json()["settings"]
    settings.update(timezone="Mars/Base", days_off=["Fryday"])

    res = client.put("/api/config", json=settings)

    assert res.status_code == 422
    problems = res.json()["detail"]["problems"]
    assert any("timezone" in p for p in problems) and any("Fryday" in p for p in problems)
    assert not (root / "config.yaml").exists()


def test_broken_config_file_is_reported_on_read_and_analyze(client, root):
    (root / "config.yaml").write_text("timezone: UTC\ncategories: {}\n")

    assert client.get("/api/config").status_code == 422
    assert analyze(client).status_code == 422


# --- safety -----------------------------------------------------------------------------------

def test_only_the_frontend_origin_may_call_the_api(client):
    def preflight(origin):
        return client.options("/api/analyze", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})

    assert preflight(FRONTEND).headers.get("access-control-allow-origin") == FRONTEND
    assert "access-control-allow-origin" not in preflight("http://evil.example").headers


def test_allowed_origins_can_be_set_by_environment(root, monkeypatch):
    monkeypatch.setenv("TIME_ANALYZER_ORIGINS", "http://localhost:3000")
    client = TestClient(create_app(root=root))

    res = client.get("/api/health", headers={"Origin": "http://localhost:3000"})

    assert res.headers.get("access-control-allow-origin") == "http://localhost:3000"


# --- Stage 3.5 Part A: the calendar saved on this computer ------------------------------------

AS_OF = "2025-09-08T10:30:00.000Z"


def save(client, body=FIXTURE_ICS, name="my-log.ics"):
    return client.put("/api/calendar", params={"name": name, "data_as_of": AS_OF}, content=body,
                      headers={"Content-Type": "text/calendar"})


def test_no_calendar_saved_at_first(client, private_data_home):
    body = client.get("/api/calendar").json()

    assert body["calendar"] is None and body["has_previous"] is False
    assert body["folder"] == str(private_data_home / "calendar")
    assert analyze(client, body=b"").status_code == 400  # no file sent and none saved


def test_saved_calendar_is_used_by_analyze_and_survives_a_restart(client, root):
    res = save(client)

    assert res.status_code == 200
    info = res.json()["calendar"]
    assert (info["name"], info["events"], info["first_day"], info["last_day"]) == (
        "my-log.ics", 10, "2025-09-01", "2025-09-08")
    assert info["data_as_of"] == "2025-09-08T10:30:00+00:00"

    restarted = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))
    assert restarted.get("/api/calendar").json()["calendar"]["name"] == "my-log.ics"
    assert analyze(restarted, body=b"").json()["totals"]["hours"] == 41.0


def test_unreadable_file_is_not_saved(client):
    res = save(client, body=b"\x00garbage SUMMARY:ME: secret plan")

    assert res.status_code == 400 and "secret" not in res.text
    assert client.get("/api/calendar").json()["calendar"] is None


def test_check_compares_without_saving(client):
    save(client)
    other = (b"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\nBEGIN:VEVENT\nUID:x\nDTSTART:20250901T090000Z\n"
             b"DTEND:20250901T100000Z\nSUMMARY:Team standup\nEND:VEVENT\nEND:VCALENDAR\n")

    res = client.post("/api/calendar/check", params={"name": "other.ics"}, content=other)

    body = res.json()
    assert body["current"]["name"] == "my-log.ics" and body["new"]["name"] == "other.ics"
    assert {w["code"] for w in body["warnings"]} == {"shorter_span", "ends_earlier", "few_known_categories"}
    assert client.get("/api/calendar").json()["calendar"]["name"] == "my-log.ics"


def test_replace_restore_and_remove(client):
    save(client, name="first.ics")
    save(client, name="second.ics")
    assert client.get("/api/calendar").json()["has_previous"] is True

    assert client.post("/api/calendar/restore").json()["calendar"]["name"] == "first.ics"

    removed = client.delete("/api/calendar").json()
    assert removed["calendar"] is None and removed["has_previous"] is False
    assert client.post("/api/calendar/restore").status_code == 409


CACHES = {".git", "node_modules", "__pycache__", ".pytest_cache", ".hypothesis", "dist"}


def repo_files() -> set[Path]:
    return {p for p in ROOT.rglob("*") if not CACHES & set(p.parts)}


def test_saving_writes_only_inside_the_personal_folder(client, private_data_home):
    before = repo_files()

    save(client)

    assert (private_data_home / "calendar" / "current.ics").read_bytes() == FIXTURE_ICS
    assert repo_files() == before


# --- Stage 4: goals ----------------------------------------------------------------------------

LEARN_WEEKLY = {"goals": [{"id": "learn", "scope": "LEARN", "every": "week", "type": "floor", "hours": 10}]}


def test_no_goals_at_first(client, private_data_home):
    body = client.get("/api/goals").json()

    assert body["goals"] == []
    assert body["path"] == str(private_data_home / "goals.yaml")


def test_goals_are_saved_outside_the_repository_and_read_back(client, private_data_home, root):
    res = client.put("/api/goals", json=LEARN_WEEKLY)

    assert res.status_code == 200
    assert res.json()["goals"] == [{"id": "learn", "scope": "LEARN", "every": "week", "type": "floor", "hours": 10.0}]
    assert (private_data_home / "goals.yaml").exists()
    assert not list(root.glob("goals.yaml"))  # nothing personal inside the project
    assert client.get("/api/goals").json()["goals"][0]["id"] == "learn"


def test_goals_that_cannot_be_saved_list_every_problem(client):
    res = client.put("/api/goals", json={"goals": [{"scope": "NOPE", "every": "never", "type": "floor"}]})

    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["message"] == "These goals can't be saved."
    assert any("not one of your categories" in p for p in detail["problems"])


def test_progress_is_empty_without_goals_or_without_a_calendar(client):
    empty = client.get("/api/goals/progress").json()
    assert empty["goals"] == [] and empty["as_of"] == "2025-09-08"

    client.put("/api/goals", json=LEARN_WEEKLY)
    assert client.get("/api/goals/progress").json()["goals"] == []  # goals, but no calendar yet


def test_progress_measures_the_running_week_of_the_saved_calendar(client):
    save(client)
    client.put("/api/goals", json=LEARN_WEEKLY)

    body = client.get("/api/goals/progress").json()

    assert body["as_of"] == "2025-09-08"  # the file was exported the same day
    [learn] = body["goals"]
    # The fixture's week starts Saturday 6 Sep; LEARN is logged on 2 Sep, in the week before.
    assert (learn["first_day"], learn["last_day"]) == ("2025-09-06", "2025-09-12")
    assert learn["actual"] == 0.0 and learn["running"] is True
    assert learn["status"] == "behind"
    assert learn["expected"] == pytest.approx(10 * 3 / 7, abs=1e-3)


def test_progress_follows_the_week_start_from_settings(client, root):
    save(client)
    client.put("/api/goals", json=LEARN_WEEKLY)
    settings = yaml.safe_load((root / "config.example.yaml").read_text())
    client.put("/api/config", json={**settings, "week_start": "Monday"})

    [learn] = client.get("/api/goals/progress").json()["goals"]

    assert (learn["first_day"], learn["last_day"]) == ("2025-09-08", "2025-09-14")


def test_progress_counts_a_monthly_goal_over_the_calendar_month(client):
    save(client)
    client.put("/api/goals", json={"goals": [
        {"id": "learn-month", "scope": "LEARN", "every": "month", "type": "floor", "hours": 6}]})

    [learn] = client.get("/api/goals/progress").json()["goals"]

    assert (learn["first_day"], learn["last_day"]) == ("2025-09-01", "2025-09-30")
    assert learn["actual"] == 2.0  # the one LEARN block in the fixture, on 2 Sep
    assert learn["expected"] == pytest.approx(6 * 8 / 30, abs=1e-3)  # 8 of September's 30 days are over
    assert learn["status"] == "on_pace"


def test_a_stale_export_is_judged_up_to_its_own_day_not_today(root):
    client = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 30)))
    save(client)  # exported 8 Sep
    client.put("/api/goals", json={"goals": [
        {"id": "learn-month", "scope": "LEARN", "every": "month", "type": "floor", "hours": 8}]})

    body = client.get("/api/goals/progress").json()

    assert (body["today"], body["as_of"]) == ("2025-09-30", "2025-09-08")
    assert body["goals"][0]["running"] is True  # September is not over as far as this file knows


# --- serving the built frontend ----------------------------------------------------------------

@pytest.fixture
def built(root) -> Path:
    """A root that also holds a built frontend, as `npm run build` leaves it."""
    dist = root / "frontend" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Time Analyzer</title><div id=root></div>")
    (dist / "assets" / "index-abc.js").write_text("console.log('app')")
    (dist / "favicon.svg").write_text("<svg/>")
    return dist


def test_without_a_built_frontend_only_the_api_is_served(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/").status_code == 404


def test_the_built_frontend_is_served_from_the_same_server(built, root):
    client = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))

    assert "Time Analyzer" in client.get("/").text
    assert client.get("/assets/index-abc.js").text == "console.log('app')"
    assert client.get("/favicon.svg").text == "<svg/>"


def test_every_page_path_reloads_into_the_app(built, root):
    client = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))

    for path in ("/overview", "/rhythm", "/data-quality", "/settings", "/anything-else"):
        res = client.get(path)
        assert res.status_code == 200 and "id=root" in res.text, path


def test_the_api_still_wins_and_unknown_api_routes_stay_errors(built, root):
    client = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))

    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/nope").status_code == 404
    assert "id=root" not in client.get("/api/nope").text


def test_serving_the_frontend_shadows_no_api_route(built, root):
    """The catch-all page route must be registered last, or it swallows the routes declared after it."""
    app = create_app(root=root, today=lambda tz: date(2025, 9, 8))
    client = TestClient(app)

    api = [r for r in app.routes if getattr(r, "path", "").startswith("/api/")]
    catch_all = [i for i, r in enumerate(app.routes) if "{path:path}" in getattr(r, "path", "")]
    assert catch_all, "the page fallback should be mounted"
    assert max(app.routes.index(r) for r in api) < catch_all[0]

    # Every GET route answers as itself, not with the app page.
    for route in api:
        if "GET" not in (getattr(route, "methods", None) or set()):
            continue
        res = client.get(route.path)
        assert res.status_code != 404, route.path
        assert "id=root" not in res.text, route.path


def test_a_path_cannot_escape_the_built_folder(built, root):
    client = TestClient(create_app(root=root, today=lambda tz: date(2025, 9, 8)))
    (root / "config.example.yaml").exists()

    res = client.get("/../config.example.yaml")

    assert "timezone" not in res.text  # the config is never served; the app page is


# --- title corrections -------------------------------------------------------------------------

TYPO_ICS = (b"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//t//EN\n"
            b"BEGIN:VEVENT\nUID:typo1\nDTSTART:20250902T090000Z\nDTEND:20250902T100000Z\n"
            b"SUMMARY:LEARm: calculus\nEND:VEVENT\n"
            b"BEGIN:VEVENT\nUID:typo2\nDTSTART:20250903T090000Z\nDTEND:20250903T100000Z\n"
            b"SUMMARY:LEARm: calculus\nEND:VEVENT\nEND:VCALENDAR\n")
FIX = {"corrections": [{"match_title": "LEARm: calculus", "title": "LEARN: calculus"}]}


def test_no_corrections_at_first(client, private_data_home):
    body = client.get("/api/corrections").json()

    assert body["corrections"] == []
    assert body["path"] == str(private_data_home / "corrections.yaml")


def test_corrections_are_saved_outside_the_repository(client, private_data_home, root):
    res = client.put("/api/corrections", json=FIX)

    assert res.status_code == 200
    assert res.json()["corrections"] == [{"title": "LEARN: calculus", "match_title": "LEARm: calculus"}]
    assert (private_data_home / "corrections.yaml").exists()
    assert not list(root.glob("corrections.yaml"))
    assert client.get("/api/corrections").json()["corrections"] == res.json()["corrections"]


def test_corrections_that_cannot_be_saved_list_every_problem(client):
    res = client.put("/api/corrections", json={"corrections": [{"title": "ME: lunch"}]})

    assert res.status_code == 422
    assert any("give either uid" in p for p in res.json()["detail"]["problems"])


def test_a_correction_changes_what_analyze_returns(client):
    before = analyze(client, body=TYPO_ICS, start="2025-09-01", end="2025-09-30").json()
    assert sorted({b["category"] for b in before["blocks"]}) == ["LEARM"]
    assert before["report"]["title_issues"]["unknown_category"]

    client.put("/api/corrections", json=FIX)
    after = analyze(client, body=TYPO_ICS, start="2025-09-01", end="2025-09-30").json()

    assert sorted({b["category"] for b in after["blocks"]}) == ["LEARN"]
    assert after["report"]["title_issues"] == {}
    assert after["report"]["corrected"] == {"title:LEARm: calculus": 2}


def test_saving_a_correction_drops_the_cached_analysis(client):
    first = analyze(client, body=TYPO_ICS, start="2025-09-01", end="2025-09-30")
    cached = analyze(client, body=TYPO_ICS, start="2025-09-01", end="2025-09-30")
    assert first.headers["X-Analysis-Cache"] == "miss" and cached.headers["X-Analysis-Cache"] == "hit"

    client.put("/api/corrections", json=FIX)
    again = analyze(client, body=TYPO_ICS, start="2025-09-01", end="2025-09-30")

    assert again.headers["X-Analysis-Cache"] == "miss"
    assert sorted({b["category"] for b in again.json()["blocks"]}) == ["LEARN"]


def test_corrections_reach_the_goals_card_too(client):
    save(client, body=TYPO_ICS, name="typo.ics")
    client.put("/api/goals", json={"goals": [
        {"id": "learn-month", "scope": "LEARN", "every": "month", "type": "floor", "hours": 4}]})
    assert client.get("/api/goals/progress").json()["goals"][0]["actual"] == 0.0

    client.put("/api/corrections", json=FIX)

    assert client.get("/api/goals/progress").json()["goals"][0]["actual"] == 2.0


def test_a_correction_survives_replacing_the_calendar_with_a_new_export(client):
    client.put("/api/corrections", json=FIX)
    save(client, body=TYPO_ICS, name="export-1.ics")
    assert sorted({b["category"] for b in analyze(client, body=b"", start="2025-09-01", end="2025-09-30").json()["blocks"]}) == ["LEARN"]

    # A fresh export still has the typo; the correction is keyed to the title, so it still applies.
    save(client, body=TYPO_ICS + b"", name="export-2.ics")

    after = analyze(client, body=b"", start="2025-09-01", end="2025-09-30").json()
    assert sorted({b["category"] for b in after["blocks"]}) == ["LEARN"]
