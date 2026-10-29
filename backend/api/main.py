"""FastAPI app for the Time Analyzer. Run locally only:

    uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000

The .ics file is sent as the raw request body and kept in memory; it is never written to disk. Event titles are
never logged, and errors about the calendar never repeat its content.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

import config
import ingest
import periods
from api.cache import AnalysisCache, analysis_key
from api.serialize import analysis_payload

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"  # the Vite dev server
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _local_today(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def create_app(root: Path = config.ROOT_DIR, today: Callable[[ZoneInfo], date] = _local_today,
               max_upload_bytes: int = MAX_UPLOAD_BYTES) -> FastAPI:
    """Build the app. ``root`` holds config.yaml / config.example.yaml; ``today`` is injectable for tests."""
    app = FastAPI(title="Time Analyzer API", docs_url="/api/docs", openapi_url="/api/openapi.json")
    origins = [o.strip() for o in os.environ.get("TIME_ANALYZER_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT"],
                       allow_headers=["Content-Type"], expose_headers=["X-Analysis-Cache"])
    cache = AnalysisCache()

    def load_settings() -> config.Config:
        try:
            return config.load_config(root=root)
        except config.ConfigError as exc:
            raise HTTPException(422, {"message": "The config file has problems.", "problems": _problems(exc)})

    def settings_response(cfg: config.Config) -> dict:
        return {"settings": config.config_to_dict(cfg), "source": Path(cfg.source).name}

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/periods")
    def list_periods() -> dict:
        return {"presets": periods.PRESETS, "default": "1m"}

    @app.get("/api/config")
    def get_config() -> dict:
        return settings_response(load_settings())

    @app.put("/api/config")
    def put_config(settings: dict) -> dict:
        target = root / "config.yaml"
        try:
            cfg = config.config_from_dict(settings, source=str(target))
        except config.ConfigError as exc:
            raise HTTPException(422, {"message": "These settings can't be saved.", "problems": _problems(exc)})
        config.save_config(cfg, target)
        return settings_response(cfg)

    @app.post("/api/analyze")
    async def analyze(request: Request, response: Response, period: str | None = None,
                      start: str | None = None, end: str | None = None) -> dict:
        body = await _read_body(request, max_upload_bytes)
        cfg = load_settings()
        try:
            first_day, last_day = periods.resolve_period(period, start, end, today=today(cfg.tz),
                                                         week_start=cfg.week_start)
        except periods.PeriodError as exc:
            raise HTTPException(422, str(exc))

        settings = config.config_to_dict(cfg)
        key = analysis_key(body, settings, first_day, last_day)
        if (payload := cache.get(key)) is not None:
            response.headers["X-Analysis-Cache"] = "hit"
            return payload
        try:
            blocks, segments, report = await run_in_threadpool(ingest.analyze, body, first_day, last_day, cfg)
        except Exception:  # never echo the calendar's content back
            raise HTTPException(400, "Could not read the calendar file. Send a Google Calendar .ics export.")
        payload = analysis_payload(blocks, segments, report, first_day, last_day, settings, Path(cfg.source).name)
        cache.put(key, payload)
        response.headers["X-Analysis-Cache"] = "miss"
        return payload

    return app


async def _read_body(request: Request, limit: int) -> bytes:
    """Read the uploaded .ics into memory, refusing anything over ``limit`` bytes."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, f"The calendar file is larger than {limit // (1024 * 1024) or 1} MB.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, f"The calendar file is larger than {limit // (1024 * 1024) or 1} MB.")
        chunks.append(chunk)
    body = b"".join(chunks)
    if not body.strip():
        raise HTTPException(400, "Send the .ics file as the request body.")
    return body


def _problems(exc: config.ConfigError) -> list[str]:
    lines = str(exc).splitlines()
    return [line.strip()[2:] for line in lines if line.strip().startswith("- ")] or lines


app = create_app()
