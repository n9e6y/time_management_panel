import streamlit as st
import pandas as pd
import os
import subprocess
import sys
from datetime import datetime, timedelta
import plotly.express as px
import plotly.graph_objects as go
import pytz

# --- Page Configuration ---
st.set_page_config(
    page_title="Time Analyzer Dashboard",
    page_icon="📅",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Path Configuration ---
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SRC_DIR)
INPUT_ICS_DIR = os.path.join(BASE_DIR, 'data', 'ics')
OUTPUT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'output', 'calendar.csv')
RUNNER_SCRIPT_PATH = os.path.join(SRC_DIR, 'runner.py')
DEFAULT_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


# --- Helper Functions ---
def run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories, focus_minutes, timezone, period=None,
                      start_date=None, end_date=None):
    """Constructs and runs the runner.py script as a subprocess."""
    python_executable = sys.executable
    command = [
        python_executable, RUNNER_SCRIPT_PATH,
        '--cat_delimiter', cat_delimiter,
        '--subcat_delimiter', subcat_delimiter,
        '--weekdays', *weekdays,
        '--focus_categories', *focus_categories,
        '--focus_minutes', str(focus_minutes),
        '--timezone', timezone  # Pass the timezone to the backend script
    ]
    if period:
        command.extend(['--period', period])
    elif start_date and end_date:
        command.extend(['--start_date', start_date])
        command.extend(['--end_date', end_date])

    st.info("⚙️ Running analysis...")
    with st.expander("Show execution command"):
        st.code(' '.join(command), language='bash')
    try:
        process = subprocess.run(command, capture_output=True, text=True, check=True, cwd=BASE_DIR)
        st.success("✅ Analysis complete!")
        with st.expander("Show analysis log"):
            st.text(process.stdout)
    except subprocess.CalledProcessError as e:
        st.error("An error occurred during analysis.")
        st.code(e.stderr, language='bash')
        return False
    return True


# --- Sidebar ---
with st.sidebar:
    st.title("Settings")
    uploaded_file = st.file_uploader("Upload Calendar", type=['ics'])

    with st.expander("Parser & Feature Settings", expanded=True, icon='⚙️'):
        date_option = st.radio("Select Date Range", ('Preset Period', 'Custom Range'), horizontal=True,
                               label_visibility="collapsed")

        period = None
        start_date_input = None
        end_date_input = None

        if date_option == 'Preset Period':
            period = st.selectbox("Analysis Period", ['1w', '2w', '1m', '3m', '6m', '1y', '2y', '5y'], index=2)
        else:
            col1, col2 = st.columns(2)
            with col1:
                start_date_input = st.date_input("Start date", datetime.now() - timedelta(days=30))
            with col2:
                end_date_input = st.date_input("End date", datetime.now())

        weekdays = st.multiselect("Weekdays", ALL_DAYS, default=DEFAULT_WEEKDAYS)
        cat_delimiter = st.text_input("Category Delimiter", ":")
        subcat_delimiter = st.text_input("Sub-category Delimiter", "-")

        # Add timezone input
        user_timezone = st.text_input("Your Timezone", "Asia/Tehran",
                                      help="Find yours from the 'TZ database name' column [here](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)")

        focus_categories_str = st.text_input("Focus Categories", "work, learning, learn, project")
        focus_minutes = st.number_input("Min. Focus Duration (minutes)", min_value=1, value=90)

    show_untracked = st.toggle("Show untracked time", value=False,
                               help="Adds an 'untracked' category to fill the remaining hours of each day.")

    if st.button("Analyze My Time", type="primary", use_container_width=True):
        if uploaded_file is not None:
            os.makedirs(INPUT_ICS_DIR, exist_ok=True)
            for f in os.listdir(INPUT_ICS_DIR):
                os.remove(os.path.join(INPUT_ICS_DIR, f))
            file_path = os.path.join(INPUT_ICS_DIR, uploaded_file.name)
            with open(file_path, "wb") as f:
                f.write(uploaded_file.getbuffer())

            focus_categories = [cat.strip().lower() for cat in focus_categories_str.split(',')]

            success = False
            if date_option == 'Preset Period':
                # This logic can be simplified as the backend now handles timezone-aware period calculations
                # But for now, we keep it to maintain UI consistency
                try:
                    local_tz = pytz.timezone(user_timezone)
                except pytz.UnknownTimeZoneError:
                    st.error(f"Unknown timezone: {user_timezone}. Please use a valid TZ database name.")
                    local_tz = pytz.utc

                now_local = datetime.now(local_tz)
                period_map = {
                    '1w': 7, '2w': 14, '1m': 30, '3m': 90,
                    '6m': 182, '1y': 365, '2y': 730, '5y': 1825
                }
                st.session_state.start_date = (now_local - timedelta(days=period_map[period])).date()
                st.session_state.end_date = now_local.date()

                # Pass the user_timezone to the runner script
                success = run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories, focus_minutes,
                                            user_timezone, period=period)
            else:
                if start_date_input > end_date_input:
                    st.error("Error: Start date cannot be after end date.")
                else:
                    st.session_state.start_date = start_date_input
                    st.session_state.end_date = end_date_input

                    # Pass the user_timezone to the runner script
                    success = run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories,
                                                focus_minutes, user_timezone,
                                                start_date=start_date_input.strftime('%Y-%m-%d'),
                                                end_date=end_date_input.strftime('%Y-%m-%d'))
            if success:
                st.rerun()
        else:
            st.warning("Please upload an .ics file first.")

    st.title("About")
    st.info(
        "This app helps you understand how you spend your time by analyzing your calendar data. "
        "Import an .ics file to view patterns, focus sessions, and category breakdowns."
    )
    st.title("Contact")
    st.info(
        """
        If you have feedback, feature idea, or want to collaborate, feel free to reach out via [Email](mailto:n9e6y@outlook.com) or [GitHub](https://github.com/n9e6y)
        """
    )

# --- Main Dashboard ---
st.title("📅 Your Time Dashboard")

if os.path.exists(OUTPUT_CSV_PATH):
    df = pd.read_csv(OUTPUT_CSV_PATH, parse_dates=['start_datetime', 'end_datetime'])

    # Handle empty dataframe before processing
    if not df.empty:

        df['date'] = pd.to_datetime(df['start_datetime']).dt.date
        df['subcategory_1'] = df['subcategory_1'].fillna('no subcategory')
        df['hours'] = df['duration_minutes'] / 60
    else:
        # Create empty columns if dataframe is empty to prevent errors
        df['date'] = None
        df['subcategory_1'] = 'no subcategory'
        df['hours'] = 0
        df['category'] = None
        df['is_focus_session'] = False

    if show_untracked and 'start_date' in st.session_state:
        analysis_start_date = st.session_state.start_date
        analysis_end_date = st.session_state.end_date
        all_days_in_range = pd.date_range(start=analysis_start_date, end=analysis_end_date, freq='D')

        tracked_hours_per_day = df.groupby('date')['hours'].sum()
        untracked_data = []

        for day in all_days_in_range:
            day_date_obj = day.date()
            tracked_hours = tracked_hours_per_day.get(day_date_obj, 0)
            untracked_hours = 24 - tracked_hours
            if untracked_hours > 0.01:
                untracked_data.append({
                    'date': day_date_obj,
                    'day_of_week': day_date_obj.strftime('%A'),
                    'day_type': 'Weekday' if day_date_obj.strftime('%A') in weekdays else 'Weekend',
                    'hours': untracked_hours,
                    'category': 'untracked',
                    'subcategory_1': 'untracked',
                    'is_focus_session': False,
                })
        if untracked_data:
            untracked_df = pd.DataFrame(untracked_data)
            df = pd.concat([df, untracked_df], ignore_index=True)

    #  Use session state for title if df is initially empty
    if 'start_date' in st.session_state:
        start_date_str = st.session_state.start_date.strftime('%d %b %Y')
        end_date_str = st.session_state.end_date.strftime('%d %b %Y')
        st.markdown(f"### Visualizing your time from **{start_date_str}** to **{end_date_str}**")
        st.markdown("---")

        st.header("Overview")
        col1, col2 = st.columns(2)
        with col1:
            total_hours = df['hours'].sum()
            metric_label = "Total Hours Accounted For" if show_untracked else "Total Hours Tracked"
            st.metric(label=metric_label, value=f"{total_hours:.1f} hrs")
            focus_sessions = df[df['is_focus_session'] == True]['is_focus_session'].sum()
            st.metric(label="Total Focus Sessions", value=f"{int(focus_sessions)}")

        with col2:
            st.subheader("Top 3 Tracked Categories")
            tracked_df = df[df['category'] != 'untracked']
            if not tracked_df.empty:
                top_categories = tracked_df.groupby('category')['hours'].sum().nlargest(3).round(1)
                st.dataframe(top_categories.rename("Hours"), use_container_width=True)
            else:
                st.write("No tracked categories found in this period.")

        st.markdown("---")

        # Display charts only if there is data to show
        if not df.empty:
            col1, col2 = st.columns(2)
            with col1:
                st.subheader("Time per Category")
                category_time = df.groupby(['category', 'subcategory_1'])['hours'].sum().reset_index()
                fig = px.bar(category_time, x='hours', y='category', color='subcategory_1', orientation='h',
                             labels={'hours': 'Total Hours', 'category': 'Category', 'subcategory_1': 'Subcategory'},
                             height=700)
                fig.update_layout(margin=dict(l=20, r=20, t=30, b=20), yaxis={'categoryorder': 'total ascending'})
                st.plotly_chart(fig, use_container_width=True)

            with col2:
                st.subheader("Weekday vs Weekend Breakdown")
                day_type_time = df.groupby(['day_type', 'category'])['hours'].sum().reset_index()
                fig = px.bar(day_type_time, x='day_type', y='hours', color='category',
                             labels={'hours': 'Total Hours', 'day_type': 'Day Type', 'category': 'Category'},
                             height=700)
                fig.update_layout(margin=dict(l=20, r=20, t=40, b=20))
                st.plotly_chart(fig, use_container_width=True)

            col3, col4 = st.columns(2)
            with col3:
                st.subheader("Category Breakdown (Sunburst)")
                fig = px.sunburst(df, path=['category', 'subcategory_1'], values='hours', height=500)
                fig.update_layout(margin=dict(l=20, r=20, t=30, b=20))
                st.plotly_chart(fig, use_container_width=True)

            with col4:
                st.subheader("An Average Day")
                num_days = (st.session_state.end_date - st.session_state.start_date).days + 1
                avg_daily_time = df.groupby('category')['hours'].sum() / num_days
                fig = px.pie(avg_daily_time, values=avg_daily_time.values, names=avg_daily_time.index,
                             title="Average Hours per Day", hole=0.3, height=500)
                fig.update_traces(textinfo='percent+label', hoverinfo='label+value')
                fig.update_layout(margin=dict(l=20, r=20, t=40, b=20))
                st.plotly_chart(fig, use_container_width=True)

            st.subheader("Category vs. Day-of-Week Heatmap")
            category_day_heatmap = df.pivot_table(index='category', columns='day_of_week', values='hours',
                                                  aggfunc='sum').fillna(0)
            category_day_heatmap = category_day_heatmap.reindex(columns=ALL_DAYS).dropna(axis=1)

            fig = go.Figure(data=go.Heatmap(
                z=category_day_heatmap.values,
                x=category_day_heatmap.columns,
                y=category_day_heatmap.index,
                colorscale='Viridis',
                hovertemplate='Day: %{x}<br>Category: %{y}<br>Hours: %{z:.1f}<extra></extra>'))
            fig.update_layout(title='Time Spent per Category and Day', yaxis_title=None, xaxis_title=None)
            st.plotly_chart(fig, use_container_width=True)

            with st.expander("View Raw Data"):
                st.dataframe(df)
        else:
            st.info("No data to display for the selected period.")

else:
    st.info("👋 Welcome! Upload your calendar file and run the analysis to get started.")
