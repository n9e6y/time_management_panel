"""CLI: turn an .ics calendar into data/output/calendar.csv (read by the old Streamlit app).

All parsing lives in ``ingest.py`` and settings in ``config.yaml`` (``config.py``); this module only handles
arguments, files and the CSV layout. It stays as the command-line tool after Stage 3.
"""
import argparse
import os
import sys
from dataclasses import replace
from datetime import date, datetime, timedelta

import pandas as pd

import config as config_module
import ingest

# --- Path Configuration (Robust Method) ---
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SRC_DIR)
INPUT_ICS_DIR = os.path.join(BASE_DIR, 'data', 'ics')
OUTPUT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'output', 'calendar.csv')

PERIOD_DAYS = {'1w': 7, '2w': 14, '1m': 30, '3m': 90, '6m': 182, '1y': 365, '2y': 730, '5y': 1825}

CSV_COLUMNS = [
    'date', 'day_of_week', 'day_type', 'start_time', 'end_time', 'duration_minutes',
    'category', 'subcategory_1', 'is_focus_session',
    'full_summary', 'start_datetime', 'end_datetime'
]


def find_ics_file(directory):
    """Finds the first .ics file in a directory."""
    os.makedirs(directory, exist_ok=True)
    for filename in sorted(os.listdir(directory)):
        if filename.lower().endswith('.ics'):
            print(f"Found calendar file: {filename}")
            return os.path.join(directory, filename)
    return None


def segments_to_csv_frame(segments: pd.DataFrame) -> pd.DataFrame:
    """Map ingest segments to the CSV layout the app reads.

    One row per segment (a part of a block on one local day). ``is_focus_session`` is true only on the first
    segment of a focus block, so counting true rows counts sessions, not parts or midnight fragments.
    ``day_type`` keeps the app's Weekday/Weekend labels; "Weekend" means one of the user's days off.
    """
    if segments.empty:
        return pd.DataFrame(columns=CSV_COLUMNS)
    df = segments.sort_values(['start_local']).reset_index(drop=True)
    first_segment = ~df['block_id'].duplicated()
    return pd.DataFrame({
        'date': df['date'],
        'day_of_week': df['day_of_week'],
        'day_type': df['is_day_off'].map({True: 'Weekend', False: 'Weekday'}),
        'start_time': df['start_local'].dt.strftime('%H:%M'),
        'end_time': df['end_local'].dt.strftime('%H:%M'),
        'duration_minutes': df['duration_min'],
        'category': df['category'],
        'subcategory_1': df['subcategory'].replace('', 'no subcategory'),
        'is_focus_session': df['is_focus'] & first_segment,
        'full_summary': df['title'],
        'start_datetime': df['start_local'],
        'end_datetime': df['end_local'],
    })[CSV_COLUMNS]


def write_calendar_csv(ics_path, csv_path, first_day: date, last_day: date, config: config_module.Config):
    """Analyze the local days first_day..last_day (inclusive) and write the CSV. Raises ValueError on bad input."""
    with open(ics_path, 'rb') as f:
        content = f.read()
    if not content.strip():
        print("Warning: The provided .ics file is empty.")

    blocks, segments, report = ingest.analyze(content, first_day, last_day, config)

    for item in report.skipped:
        print(f"Skipped ({item['reason']}): {item['title']!r}")
    if report.overlaps:
        print(f"Warning: {len(report.overlaps)} overlapping event pair(s) found; overlapping time is counted twice.")
    for code, items in report.title_issues.items():
        print(f"Title issue {code} ({len(items)}): " + ", ".join(repr(i['title']) for i in items[:5])
              + (" ..." if len(items) > 5 else ""))

    df = segments_to_csv_frame(segments)
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    df.to_csv(csv_path, index=False, encoding='utf-8')
    if df.empty:
        print("No events found in the specified date range. Created an empty CSV.")
    else:
        print(f"Successfully processed {len(df)} event segments from {len(blocks)} blocks.")
    print(f"CSV file saved to: {csv_path}")


def config_with_overrides(args) -> config_module.Config:
    """Load the config file, then apply the settings given on the command line."""
    cfg = config_module.load_config(args.config)
    if args.timezone:
        ingest.get_tz(args.timezone)  # readable error for a bad name
        cfg = replace(cfg, timezone=args.timezone)
    if args.week_start:
        cfg = replace(cfg, week_start=_weekday(args.week_start))
    if args.days_off is not None:
        cfg = replace(cfg, days_off=frozenset(_weekday(d) for d in args.days_off))
    elif args.weekdays is not None:  # legacy flag from the old app: every other day is a day off
        working = {_weekday(d) for d in args.weekdays}
        cfg = replace(cfg, days_off=frozenset(d for d in ingest.WEEKDAYS if d not in working))
    if args.focus_categories is not None:
        wanted = {c.strip().upper() for arg in args.focus_categories for c in arg.split(',') if c.strip()}
        cfg = replace(cfg, categories={name: replace(cat, focus=name in wanted) for name, cat in cfg.categories.items()})
    if args.focus_minutes is not None:
        if args.focus_minutes < 0:
            raise ValueError("--focus_minutes must be 0 or more.")
        cfg = replace(cfg, focus_min_minutes=args.focus_minutes)
    if args.cat_delimiter not in (None, ':'):
        print("Note: --cat_delimiter is ignored; the title grammar always uses ':'.")
    return cfg


def _weekday(name: str) -> str:
    day = name.strip().capitalize()
    if day not in ingest.WEEKDAYS:
        raise ValueError(f"{name!r} is not a weekday (use one of {', '.join(ingest.WEEKDAYS)}).")
    return day


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Process an .ics calendar file into a CSV with engineered features for analysis.")
    parser.add_argument('--ics_path', type=str, default=None, help="Direct path to the .ics file to process.")
    parser.add_argument('--period', type=str, default='1m', choices=list(PERIOD_DAYS),
                        help="Set the analysis period (e.g., '1m' for one month).")
    parser.add_argument('--config', type=str, default=None,
                        help="Settings file. Default: config.yaml, or config.example.yaml if there is none.")
    parser.add_argument('--out', type=str, default=None, help=f"CSV to write. Default: {OUTPUT_CSV_PATH}")
    parser.add_argument('--week_start', type=str, default=None, help="Override the config's week start day.")
    parser.add_argument('--days_off', nargs='*', default=None, help="Override the config's days off (weekend).")
    parser.add_argument('--weekdays', nargs='+', default=None,
                        help="Legacy: working days; every other day becomes a day off. --days_off wins.")
    parser.add_argument('--focus_categories', nargs='+', default=None,
                        help="Override which configured categories count toward focus sessions.")
    parser.add_argument('--focus_minutes', type=int, default=None,
                        help="Override the minimum duration in minutes for a focus session.")
    parser.add_argument('--cat_delimiter', type=str, default=None, help="Ignored (kept for the old app).")
    parser.add_argument('--subcat_delimiter', type=str, default=None,
                        help="Ignored (kept for the old app): the separator is set in the config.")
    parser.add_argument('--start_date', type=str, default=None,
                        help="Start date for analysis (YYYY-MM-DD). Overrides --period.")
    parser.add_argument('--end_date', type=str, default=None,
                        help="End date for analysis (YYYY-MM-DD, inclusive). Overrides --period.")
    parser.add_argument('--timezone', type=str, default=None,
                        help="Override the config's timezone (e.g., 'Asia/Tehran', 'America/New_York').")
    args = parser.parse_args(argv)

    try:
        cfg = config_with_overrides(args)
        tz = cfg.tz
        print(f"Using config: {cfg.source}")
        if args.start_date and args.end_date:
            try:
                first_day = datetime.strptime(args.start_date, '%Y-%m-%d').date()
                last_day = datetime.strptime(args.end_date, '%Y-%m-%d').date()
            except ValueError:
                raise ValueError("Invalid date format. Please use YYYY-MM-DD.")
        else:
            last_day = datetime.now(tz).date()
            first_day = last_day - timedelta(days=PERIOD_DAYS[args.period])

        print(f"Analyzing events from {first_day} to {last_day} in timezone {cfg.timezone}")

        ics_file_path = args.ics_path
        if not ics_file_path:
            print("No direct --ics_path provided, searching in default directory...")
            ics_file_path = find_ics_file(INPUT_ICS_DIR)
        if not ics_file_path or not os.path.exists(ics_file_path):
            raise ValueError(
                "No .ics file found. Provide one with --ics_path or upload it in the app, "
                f"which places it in '{INPUT_ICS_DIR}'.")

        write_calendar_csv(ics_file_path, args.out or OUTPUT_CSV_PATH, first_day, last_day, cfg)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # unreadable or invalid .ics, permissions, ...
        print(f"Error: Failed to process the calendar. Details: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
