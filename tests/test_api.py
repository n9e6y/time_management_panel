"""Stage 3 Part A: the FastAPI backend (spec: c-c-k/docs/stages/STAGE_3_app_architecture.md)."""
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
