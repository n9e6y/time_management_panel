import os
import pandas as pd
from icalendar import Calendar
from datetime import datetime, timedelta, date
import pytz
import argparse
import re

# --- Path Configuration (Robust Method) ---
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SRC_DIR)
INPUT_ICS_DIR = os.path.join(BASE_DIR, 'data', 'ics')
OUTPUT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'output', 'calendar.csv')

# --- Default Configuration ---
DEFAULT_CATEGORY_DELIMITER = ":"
DEFAULT_SUBCATEGORY_DELIMITER = "-"
DEFAULT_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
DEFAULT_FOCUS_CATEGORIES = ['work', 'learning', 'learn', 'project']
DEFAULT_FOCUS_MINUTES = 90


def _parse_subcategories(subcategory_str, subcat_delimiter):
    """
    Parses a subcategory string into evenly split subcategories.
    """
    # Filter out empty strings that result from splitting, e.g., from a trailing delimiter
    sub_items = [s.strip().lower() for s in subcategory_str.split(subcat_delimiter) if s.strip()]

    # If there are sub-items, split them evenly.
    if sub_items:
        num_subcategories = len(sub_items)
        even_split_weight = 100.0 / num_subcategories
        return [{'name': name, 'weight': even_split_weight} for name in sub_items]

    # If there's no subcategory string or it's empty, return a default.
    return [{'name': 'no subcategory', 'weight': 100.0}]


def parse_event(event, cat_delimiter, subcat_delimiter):
    """
    Parses an event component, splitting it into multiple records based on subcategory weighting.
    This function now always returns a list of event records.
    """
    summary = event.get('summary')
    start_dt_val = event.get('dtstart').dt
    end_dt_val = event.get('dtend').dt

    if not all([summary, start_dt_val, end_dt_val]):
        return []

    if isinstance(start_dt_val, date) and not isinstance(start_dt_val, datetime):
        start_dt = datetime.combine(start_dt_val, datetime.min.time())
    else:
        start_dt = start_dt_val

    if isinstance(end_dt_val, date) and not isinstance(end_dt_val, datetime):
        end_dt = datetime.combine(end_dt_val, datetime.min.time())
    else:
        end_dt = end_dt_val

    if start_dt.tzinfo is None:
        start_dt = pytz.utc.localize(start_dt)
    if end_dt.tzinfo is None:
        end_dt = pytz.utc.localize(end_dt)

    # Determine category and subcategory string
    category = summary.strip().lower()
    subcategory_str = ""
    if cat_delimiter in summary:
        parts = summary.split(cat_delimiter, 1)
        category = parts[0].strip().lower()
        subcategory_str = parts[1].strip()

    allocations = _parse_subcategories(subcategory_str, subcat_delimiter)
    total_duration = end_dt - start_dt

    def create_split_records(instance_start, instance_duration):
        """Creates time-sliced records for a single event instance."""
        records = []
        current_start_time = instance_start
        for alloc in allocations:
            sub_duration = instance_duration * (alloc['weight'] / 100.0)
            sub_end_time = current_start_time + sub_duration
            records.append({
                'start_datetime': current_start_time,
                'end_datetime': sub_end_time,
                'category': category,
                'subcategory_1': alloc['name'],
                'full_summary': summary
            })
            current_start_time = sub_end_time
        return records

    all_event_records = []
    if 'rrule' in event:
        rrule_end = datetime.now(pytz.utc) + timedelta(days=730)
        try:
            occurrences = event.get('rrule').rrule.between(datetime(2020, 1, 1, tzinfo=pytz.utc), rrule_end)
            for occ_start in occurrences:
                if occ_start.tzinfo is None:
                    occ_start = pytz.utc.localize(occ_start)
                all_event_records.extend(create_split_records(occ_start, total_duration))
        except Exception as e:
            print(f"Warning: Could not parse rrule for event '{summary}'. Error: {e}")
    else:
        all_event_records.extend(create_split_records(start_dt, total_duration))

    return all_event_records


def find_ics_file(directory):
    """Finds the first .ics file in a directory."""
    os.makedirs(directory, exist_ok=True)
    for filename in os.listdir(directory):
        if filename.lower().endswith('.ics'):
            print(f"Found calendar file: {filename}")
            return os.path.join(directory, filename)
    return None


def process_ics_to_csv(ics_path, csv_path, cat_delimiter, subcat_delimiter, start_date, end_date, weekdays,
                       focus_categories, focus_minutes, timezone_str):
    """Processes the .ics file into a detailed CSV."""
    try:
        with open(ics_path, 'r', encoding='utf-8') as f:
            cal_content = f.read()
            if not cal_content.strip():
                print("Warning: The provided .ics file is empty.")
                return
            cal = Calendar.from_ical(cal_content)
    except FileNotFoundError:
        print(f"Error: The file was not found at {ics_path}")
        return
    except Exception as e:
        print(f"Error: Failed to parse .ics file. It might be invalid. Details: {e}")
        return

    all_events = []
    for component in cal.walk():
        if component.name == "VEVENT":
            parsed_records = parse_event(component, cat_delimiter, subcat_delimiter)
            if parsed_records:
                all_events.extend(parsed_records)

    column_order = [
        'date', 'day_of_week', 'day_type', 'start_time', 'end_time', 'duration_minutes',
        'category', 'subcategory_1', 'is_focus_session',
        'full_summary', 'start_datetime', 'end_datetime'
    ]

    if not all_events:
        print("No parsable events found in the calendar file. Creating an empty CSV.")
        empty_df = pd.DataFrame(columns=column_order)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        empty_df.to_csv(csv_path, index=False, encoding='utf-8')
        return

    expanded_events = []
    for event in all_events:
        s = event['start_datetime']
        e = event['end_datetime']

        if e <= s:
            continue

        cursor = s
        while cursor < e:
            end_of_day = (cursor.replace(hour=0, minute=0, second=0, microsecond=0) +
                          timedelta(days=1))
            segment_end = min(e, end_of_day)
            if segment_end > cursor:
                split_event = event.copy()
                split_event['start_datetime'] = cursor
                split_event['end_datetime'] = segment_end
                expanded_events.append(split_event)
            cursor = segment_end

    df = pd.DataFrame(expanded_events)
    if df.empty:
        print("No event segments were created after processing. Check event dates.")
        empty_df = pd.DataFrame(columns=column_order)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        empty_df.to_csv(csv_path, index=False, encoding='utf-8')
        return

    df['start_datetime'] = pd.to_datetime(df['start_datetime'])
    df['end_datetime'] = pd.to_datetime(df['end_datetime'])

    # --- TIMEZONE CONVERSION ---
    # Convert from UTC to the user's target timezone before doing any date-based calculations.
    try:
        target_tz = pytz.timezone(timezone_str)
        print(f"Converting times to timezone: {timezone_str}")
        df['start_datetime'] = df['start_datetime'].dt.tz_convert(target_tz)
        df['end_datetime'] = df['end_datetime'].dt.tz_convert(target_tz)
    except pytz.UnknownTimeZoneError:
        print(f"Warning: Unknown timezone '{timezone_str}'. Falling back to UTC.")

    # Filter by date range AFTER timezone conversion
    start_date_local = start_date.astimezone(target_tz)
    end_date_local = end_date.astimezone(target_tz)
    df = df[(df['start_datetime'] < end_date_local) & (df['end_datetime'] > start_date_local)].copy()

    if df.empty:
        print("No events found in the specified date range after timezone conversion.")
        empty_df = pd.DataFrame(columns=column_order)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        empty_df.to_csv(csv_path, index=False, encoding='utf-8')
        return

    # Clip events to the boundaries of the date range
    df['start_datetime'] = df['start_datetime'].clip(lower=start_date_local)
    df['end_datetime'] = df['end_datetime'].clip(upper=end_date_local)

    df['duration_minutes'] = (df['end_datetime'] - df['start_datetime']).dt.total_seconds() / 60
    df = df[df['duration_minutes'] > 0.1].copy()

    # derive all date/time columns from the LOCALIZED datetime
    df['date'] = df['start_datetime'].dt.date
    df['day_of_week'] = df['start_datetime'].dt.day_name()
    df['start_time'] = df['start_datetime'].dt.strftime('%H:%M')
    df['end_time'] = df['end_datetime'].dt.strftime('%H:%M')
    df['day_type'] = df['day_of_week'].apply(lambda day: 'Weekday' if day in weekdays else 'Weekend')

    focus_categories_lower = [cat.lower() for cat in focus_categories]
    is_focus_category = df['category'].str.lower().isin(focus_categories_lower)
    is_long_enough = df['duration_minutes'] >= focus_minutes
    df['is_focus_session'] = is_focus_category & is_long_enough

    df = df[column_order]
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    df.to_csv(csv_path, index=False, encoding='utf-8')
    print(f"Successfully processed {len(df)} event segments.")
    print(f"CSV file saved to: {csv_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Process an .ics calendar file into a CSV with engineered features for analysis.")
    parser.add_argument('--ics_path', type=str, default=None, help="Direct path to the .ics file to process.")
    parser.add_argument('--period', type=str, default='1m', choices=['1w', '2w', '1m', '3m', '6m', '1y', '2y', '5y'],
                        help="Set the analysis period (e.g., '1m' for one month).")
    parser.add_argument('--cat_delimiter', type=str, default=DEFAULT_CATEGORY_DELIMITER, help="Category delimiter.")
    parser.add_argument('--subcat_delimiter', type=str, default=DEFAULT_SUBCATEGORY_DELIMITER,
                        help="Subcategory delimiter.")
    parser.add_argument('--weekdays', nargs='+', default=DEFAULT_WEEKDAYS,
                        help="List of days to be considered weekdays.")
    parser.add_argument('--focus_categories', nargs='+', default=DEFAULT_FOCUS_CATEGORIES,
                        help="List of categories to be considered for focus sessions.")
    parser.add_argument('--focus_minutes', type=int, default=DEFAULT_FOCUS_MINUTES,
                        help="Minimum duration in minutes for a focus session.")
    parser.add_argument('--start_date', type=str, default=None,
                        help="Start date for analysis (YYYY-MM-DD). Overrides --period.")
    parser.add_argument('--end_date', type=str, default=None,
                        help="End date for analysis (YYYY-MM-DD). Overrides --period.")
    # Add timezone argument
    parser.add_argument('--timezone', type=str, default='UTC',
                        help="Target timezone for analysis (e.g., 'Asia/Tehran', 'America/New_York').")

    args = parser.parse_args()

    # Create naive datetimes first, then localize them. This is robust.
    if args.start_date and args.end_date:
        try:
            start_date_naive = datetime.strptime(args.start_date, '%Y-%m-%d').date()
            end_date_naive = datetime.strptime(args.end_date, '%Y-%m-%d').date()
        except ValueError:
            print("Error: Invalid date format. Please use YYYY-MM-DD.")
            return
    else:
        try:
            target_tz = pytz.timezone(args.timezone)
        except pytz.UnknownTimeZoneError:
            print(f"Error: Unknown timezone '{args.timezone}'. Using UTC.")
            target_tz = pytz.utc

        now_local = datetime.now(target_tz)
        end_date_naive = now_local.date()
        period_map = {
            '1w': timedelta(weeks=1), '2w': timedelta(weeks=2), '1m': timedelta(days=30),
            '3m': timedelta(days=90), '6m': timedelta(days=182), '1y': timedelta(days=365),
            '2y': timedelta(days=730), '5y': timedelta(days=1825)
        }
        start_date_naive = end_date_naive - period_map[args.period]

    try:
        target_tz = pytz.timezone(args.timezone)
        start_date = target_tz.localize(datetime.combine(start_date_naive, datetime.min.time())).astimezone(pytz.utc)
        end_date = target_tz.localize(datetime.combine(end_date_naive, datetime.max.time())).astimezone(pytz.utc)
    except pytz.UnknownTimeZoneError:
        target_tz = pytz.utc
        start_date = pytz.utc.localize(datetime.combine(start_date_naive, datetime.min.time()))
        end_date = pytz.utc.localize(datetime.combine(end_date_naive, datetime.max.time()))

    print(
        f"Analyzing events from {start_date.astimezone(target_tz).strftime('%Y-%m-%d')} to {end_date.astimezone(target_tz).strftime('%Y-%m-%d')} in timezone {args.timezone}")

    ics_file_path = args.ics_path

    if not ics_file_path:
        print("No direct --ics_path provided, searching in default directory...")
        ics_file_path = find_ics_file(INPUT_ICS_DIR)

    if ics_file_path and os.path.exists(ics_file_path):
        process_ics_to_csv(
            ics_path=ics_file_path, csv_path=OUTPUT_CSV_PATH,
            cat_delimiter=args.cat_delimiter, subcat_delimiter=args.subcat_delimiter,
            start_date=start_date, end_date=end_date,
            weekdays=args.weekdays, focus_categories=args.focus_categories, focus_minutes=args.focus_minutes,
            timezone_str=args.timezone  # Pass timezone to processor
        )
    else:
        print(f"Error: No .ics file found.")
        print(
            f"Please provide a direct path using --ics_path or ensure a file has been uploaded via the UI, which places it in '{INPUT_ICS_DIR}'.")


if __name__ == "__main__":
    main()
