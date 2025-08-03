import os
import pandas as pd
from icalendar import Calendar
from datetime import datetime, timedelta
import pytz
import argparse

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


def parse_event(event, cat_delimiter, subcat_delimiter):
    """
    Parses the raw data from an event component without calculating duration yet.
    """
    summary = event.get('summary')
    start_dt = event.get('dtstart').dt
    end_dt = event.get('dtend').dt

    if not all([summary, start_dt, end_dt]):
        return None, []

    if isinstance(start_dt, datetime) and start_dt.tzinfo is None:
        start_dt = pytz.utc.localize(start_dt)
    if isinstance(end_dt, datetime) and end_dt.tzinfo is None:
        end_dt = pytz.utc.localize(end_dt)

    category = summary.strip().lower()
    subcategories = []
    if cat_delimiter in summary:
        parts = summary.split(cat_delimiter, 1)
        category = parts[0].strip().lower()
        subcategory_str = parts[1].strip()
        subcategories = [s.strip().lower() for s in subcategory_str.split(subcat_delimiter)]

    if not isinstance(start_dt, datetime) or not isinstance(end_dt, datetime):
        return None, []

    record = {
        'start_datetime': start_dt,
        'end_datetime': end_dt,
        'category': category,
        'subcategory_1': subcategories[0] if len(subcategories) > 0 else None,
        'subcategory_2': subcategories[1] if len(subcategories) > 1 else None,
        'subcategory_3': subcategories[2] if len(subcategories) > 2 else None,
        'full_summary': summary
    }

    if 'rrule' in event:
        rrule_end = datetime.now(pytz.utc) + timedelta(days=365)
        duration = end_dt - start_dt
        occurrences = event.get('rrule').rrule.between(datetime(2020, 1, 1, tzinfo=pytz.utc), rrule_end)

        event_records = []
        for occ_start in occurrences:
            occ_end = occ_start + duration
            occ_record = record.copy()
            occ_record['start_datetime'] = occ_end.tzinfo.localize(occ_start) if occ_start.tzinfo is None else occ_start
            occ_record['end_datetime'] = occ_end.tzinfo.localize(occ_end) if occ_end.tzinfo is None else occ_end
            event_records.append(occ_record)
        return None, event_records
    else:
        return record, []


def find_ics_file(directory):
    os.makedirs(directory, exist_ok=True)
    for filename in os.listdir(directory):
        if filename.lower().endswith('.ics'):
            print(f"Found calendar file: {filename}")
            return os.path.join(directory, filename)
    return None


def process_ics_to_csv(ics_path, csv_path, cat_delimiter, subcat_delimiter, start_date, end_date, weekdays,
                       focus_categories, focus_minutes):
    try:
        with open(ics_path, 'r', encoding='utf-8') as f:
            cal = Calendar.from_ical(f.read())
    except FileNotFoundError:
        print(f"Error: The file was not found at {ics_path}")
        return

    all_events = []
    for component in cal.walk():
        if component.name == "VEVENT":
            single_event, recurring_events = parse_event(component, cat_delimiter, subcat_delimiter)

            if single_event:
                all_events.append(single_event)
            if recurring_events:
                all_events.extend(recurring_events)

    # Define column order early to use for empty dataframes
    column_order = [
        'date', 'day_of_week', 'day_type', 'start_time', 'end_time', 'duration_minutes',
        'category', 'subcategory_1', 'subcategory_2', 'subcategory_3', 'is_focus_session',
        'full_summary', 'start_datetime', 'end_datetime'
    ]

    if not all_events:
        print("No events found in the calendar file. Creating an empty CSV.")
        empty_df = pd.DataFrame(columns=column_order)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        empty_df.to_csv(csv_path, index=False, encoding='utf-8')
        return

    expanded_events = []
    for event in all_events:
        s = event['start_datetime']
        e = event['end_datetime']
        if s.date() == e.date() or (
                e.hour == 0 and e.minute == 0 and e.second == 0 and (e.date() - s.date()).days == 1):
            expanded_events.append(event)
            continue
        current_time = s
        while current_time.date() < e.date():
            day_end = current_time.replace(hour=23, minute=59, second=59)
            split_event = event.copy()
            split_event['start_datetime'] = current_time
            split_event['end_datetime'] = day_end
            expanded_events.append(split_event)
            current_time = day_end + timedelta(seconds=1)
        if current_time < e:
            last_part_event = event.copy()
            last_part_event['start_datetime'] = current_time
            last_part_event['end_datetime'] = e
            expanded_events.append(last_part_event)

    df = pd.DataFrame(expanded_events)
    df['start_datetime'] = pd.to_datetime(df['start_datetime'])
    df['end_datetime'] = pd.to_datetime(df['end_datetime'])

    df = df[(df['start_datetime'] < end_date) & (df['end_datetime'] > start_date)].copy()

    # --- LOGIC FIX: Handle case where no events fall in the selected range ---
    if df.empty:
        print("No events found in the specified date range. Creating an empty CSV.")
        empty_df = pd.DataFrame(columns=column_order)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        empty_df.to_csv(csv_path, index=False, encoding='utf-8')
        return

    df['start_datetime'] = df['start_datetime'].clip(lower=start_date)
    df['end_datetime'] = df['end_datetime'].clip(upper=end_date)

    df['duration_minutes'] = (df['end_datetime'] - df['start_datetime']).dt.total_seconds() / 60

    df = df[df['duration_minutes'] > 0.1]

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
    print(f"Successfully processed {len(df)} events.")
    print(f"CSV file saved to: {csv_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Process an .ics calendar file into a CSV with engineered features for analysis.")
    parser.add_argument('--period', type=str, default='1m', choices=['1w', '2w', '1m', '3m', '6m', '1y', '2y', '5y'],
                        help="Set the analysis period.")
    parser.add_argument('--cat_delimiter', type=str, default=DEFAULT_CATEGORY_DELIMITER, help=f"Category delimiter.")
    parser.add_argument('--subcat_delimiter', type=str, default=DEFAULT_SUBCATEGORY_DELIMITER,
                        help=f"Subcategory delimiter.")
    parser.add_argument('--weekdays', nargs='+', default=DEFAULT_WEEKDAYS, help=f"List of weekdays.")
    parser.add_argument('--focus_categories', nargs='+', default=DEFAULT_FOCUS_CATEGORIES,
                        help=f"List of focus categories.")
    parser.add_argument('--focus_minutes', type=int, default=DEFAULT_FOCUS_MINUTES,
                        help=f"Minimum duration for a focus session.")
    parser.add_argument('--start_date', type=str, default=None,
                        help="Start date for analysis (YYYY-MM-DD). Overrides --period.")
    parser.add_argument('--end_date', type=str, default=None,
                        help="End date for analysis (YYYY-MM-DD). Overrides --period.")

    args = parser.parse_args()

    if args.start_date and args.end_date:
        try:
            start_date = pytz.utc.localize(datetime.strptime(args.start_date, '%Y-%m-%d'))
            end_date = pytz.utc.localize(datetime.strptime(args.end_date, '%Y-%m-%d'))
            end_date = end_date.replace(hour=23, minute=59, second=59)
        except ValueError:
            print("Error: Invalid date format. Please use YYYY-MM-DD.")
            return
    else:
        end_date = datetime.now(pytz.utc)
        period_map = {
            '1w': timedelta(weeks=1), '2w': timedelta(weeks=2), '1m': timedelta(days=30),
            '3m': timedelta(days=90), '6m': timedelta(days=182), '1y': timedelta(days=365),
            '2y': timedelta(days=730), '5y': timedelta(days=1825)
        }
        start_date = end_date - period_map[args.period]

    print(f"Analyzing events from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")

    ics_file_path = find_ics_file(INPUT_ICS_DIR)

    if ics_file_path:
        process_ics_to_csv(
            ics_path=ics_file_path, csv_path=OUTPUT_CSV_PATH,
            cat_delimiter=args.cat_delimiter, subcat_delimiter=args.subcat_delimiter,
            start_date=start_date, end_date=end_date,
            weekdays=args.weekdays, focus_categories=args.focus_categories, focus_minutes=args.focus_minutes
        )
    else:
        print(f"Error: No .ics file found in the '{INPUT_ICS_DIR}' directory.")


if __name__ == "__main__":
    main()
