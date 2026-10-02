"""CLI: turn an .ics calendar into data/output/calendar.csv for the Streamlit app.

All parsing lives in ``ingest.py``; this module only handles arguments, files and the CSV layout
the app currently reads (until the app stops using a subprocess in Stage 3).
"""
import argparse
import os
import sys
from datetime import date, datetime, timedelta

import pandas as pd

import ingest

# --- Path Configuration (Robust Method) ---
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SRC_DIR)
INPUT_ICS_DIR = os.path.join(BASE_DIR, 'data', 'ics')
OUTPUT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'output', 'calendar.csv')

# --- Default Configuration ---
DEFAULT_CATEGORY_DELIMITER = ":"
DEFAULT_SUBCATEGORY_DELIMITER = "-"
DEFAULT_WEEKDAYS = list(ingest.DEFAULT_WEEKDAYS)
DEFAULT_FOCUS_CATEGORIES = ['work', 'learning', 'learn', 'project']
DEFAULT_FOCUS_MINUTES = 90

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

    ``is_focus_session`` is true only on the first segment of a focus block, so counting true rows
    counts sessions, not midnight fragments.
    """
    if segments.empty:
        return pd.DataFrame(columns=CSV_COLUMNS)
    df = segments.sort_values(['start_local']).reset_index(drop=True)
    first_segment = ~df['block_id'].duplicated()
    return pd.DataFrame({
        'date': df['date'],
        'day_of_week': df['day_of_week'],
        'day_type': df['day_type'],
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


def write_calendar_csv(ics_path, csv_path, first_day: date, last_day: date, timezone_str, cat_delimiter,
                       weekdays, focus_categories, focus_minutes):
    """Analyze the local days first_day..last_day (inclusive) and write the CSV. Raises ValueError on bad input."""
    with open(ics_path, 'rb') as f:
        content = f.read()
    if not content.strip():
        print("Warning: The provided .ics file is empty.")

    blocks, segments, report = ingest.analyze(
        content, first_day, last_day, timezone_str, focus_categories=focus_categories,
        focus_minutes=focus_minutes, weekdays=weekdays, cat_delimiter=cat_delimiter)

    for item in report.skipped:
        print(f"Skipped ({item['reason']}): {item['title']!r}")
    if report.overlaps:
        print(f"Warning: {len(report.overlaps)} overlapping event pair(s) found; overlapping time is counted twice.")

    df = segments_to_csv_frame(segments)
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    df.to_csv(csv_path, index=False, encoding='utf-8')
    if df.empty:
        print("No events found in the specified date range. Created an empty CSV.")
    else:
        print(f"Successfully processed {len(df)} event segments from {len(blocks)} blocks.")
    print(f"CSV file saved to: {csv_path}")


def process_ics_to_csv(ics_path, csv_path, cat_delimiter, subcat_delimiter, start_date, end_date, weekdays,
                       focus_categories, focus_minutes, timezone_str):
    """Compatibility wrapper: start_date/end_date are aware datetimes; their local calendar days are analyzed.

    ``subcat_delimiter`` is accepted but ignored: time is no longer split on hyphens (CODE_REVIEW H1).
    """
    tz = ingest.get_tz(timezone_str)
    write_calendar_csv(ics_path, csv_path, start_date.astimezone(tz).date(), end_date.astimezone(tz).date(),
                       timezone_str, cat_delimiter, weekdays, focus_categories, focus_minutes)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Process an .ics calendar file into a CSV with engineered features for analysis.")
    parser.add_argument('--ics_path', type=str, default=None, help="Direct path to the .ics file to process.")
    parser.add_argument('--period', type=str, default='1m', choices=list(PERIOD_DAYS),
                        help="Set the analysis period (e.g., '1m' for one month).")
    parser.add_argument('--cat_delimiter', type=str, default=DEFAULT_CATEGORY_DELIMITER, help="Category delimiter.")
    parser.add_argument('--subcat_delimiter', type=str, default=DEFAULT_SUBCATEGORY_DELIMITER,
                        help="Ignored (kept for compatibility): time is no longer split on this delimiter.")
    parser.add_argument('--weekdays', nargs='+', default=DEFAULT_WEEKDAYS,
                        help="List of days to be considered weekdays.")
    parser.add_argument('--focus_categories', nargs='+', default=DEFAULT_FOCUS_CATEGORIES,
                        help="List of categories to be considered for focus sessions.")
    parser.add_argument('--focus_minutes', type=int, default=DEFAULT_FOCUS_MINUTES,
                        help="Minimum duration in minutes for a focus session.")
    parser.add_argument('--start_date', type=str, default=None,
                        help="Start date for analysis (YYYY-MM-DD). Overrides --period.")
    parser.add_argument('--end_date', type=str, default=None,
                        help="End date for analysis (YYYY-MM-DD, inclusive). Overrides --period.")
    parser.add_argument('--timezone', type=str, default='UTC',
                        help="Target timezone for analysis (e.g., 'Asia/Tehran', 'America/New_York').")
    args = parser.parse_args(argv)

    try:
        tz = ingest.get_tz(args.timezone)
        if args.start_date and args.end_date:
            try:
                first_day = datetime.strptime(args.start_date, '%Y-%m-%d').date()
                last_day = datetime.strptime(args.end_date, '%Y-%m-%d').date()
            except ValueError:
                raise ValueError("Invalid date format. Please use YYYY-MM-DD.")
        else:
            last_day = datetime.now(tz).date()
            first_day = last_day - timedelta(days=PERIOD_DAYS[args.period])

        print(f"Analyzing events from {first_day} to {last_day} in timezone {args.timezone}")

        ics_file_path = args.ics_path
        if not ics_file_path:
            print("No direct --ics_path provided, searching in default directory...")
            ics_file_path = find_ics_file(INPUT_ICS_DIR)
        if not ics_file_path or not os.path.exists(ics_file_path):
            raise ValueError(
                "No .ics file found. Provide one with --ics_path or upload it in the app, "
                f"which places it in '{INPUT_ICS_DIR}'.")

        write_calendar_csv(ics_file_path, OUTPUT_CSV_PATH, first_day, last_day, args.timezone, args.cat_delimiter,
                           args.weekdays, args.focus_categories, args.focus_minutes)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # unreadable or invalid .ics, permissions, ...
        print(f"Error: Failed to process the calendar. Details: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
