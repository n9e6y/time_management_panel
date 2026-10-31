"""Turn analysis results (DataFrames, dates, pandas missing values) into plain JSON values."""
from __future__ import annotations

import math
from datetime import date, datetime

import pandas as pd


def to_json(value):
    """Recursively convert one value: timestamps and dates to ISO text, missing values to None."""
    if isinstance(value, dict):
        return {str(k): to_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json(v) for v in value]
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):  # numpy scalars
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def frame_records(frame: pd.DataFrame) -> list[dict]:
    return [to_json(row) for row in frame.to_dict("records")]


def analysis_payload(blocks: pd.DataFrame, segments: pd.DataFrame, report, first_day: date, last_day: date,
                     settings: dict, source: str) -> dict:
    """The /api/analyze response."""
    return {
        "range": {"first_day": first_day.isoformat(), "last_day": last_day.isoformat(),
                  "timezone": settings["timezone"], "week_start": settings["week_start"],
                  "days_off": settings["days_off"]},
        "config_source": source,
        "calendar": {"first_day": to_json(report.calendar_first), "last_day": to_json(report.calendar_last)},
        "totals": {
            "hours": float(segments["duration_min"].sum()) / 60 if not segments.empty else 0.0,
            "blocks": len(blocks), "segments": len(segments), "skipped": len(report.skipped),
            "overlaps": len(report.overlaps),
            "title_issues": len({i["block_id"] for items in report.title_issues.values() for i in items}),
        },
        "blocks": frame_records(blocks),
        "segments": frame_records(segments),
        "report": to_json({"skipped": report.skipped, "overlaps": report.overlaps,
                           "title_issues": report.title_issues}),
    }
