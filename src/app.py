import streamlit as st
import pandas as pd
import os
import subprocess
import sys
from datetime import datetime, timedelta
import plotly.express as px
import plotly.graph_objects as go

# --- Page Configuration ---
st.set_page_config(
    page_title="Time Analyzer Dashboard",
    page_icon="🗓️",
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
def run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories, focus_minutes, period=None,
                      start_date=None, end_date=None):
    """Constructs and runs the runner.py script as a subprocess."""
    python_executable = sys.executable
    command = [
        python_executable, RUNNER_SCRIPT_PATH,
        '--cat_delimiter', cat_delimiter,
        '--subcat_delimiter', subcat_delimiter,
        '--weekdays', *weekdays,
        '--focus_categories', *focus_categories,
        '--focus_minutes', str(focus_minutes)
    ]
    # Add either period or custom dates to the command
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

    with st.expander("Parser & Feature Settings", expanded=True , icon='⚙️'):
        # --- Date Range Selection ---
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

        # --- Other Settings ---
        weekdays = st.multiselect("Weekdays", ALL_DAYS, default=DEFAULT_WEEKDAYS)
        cat_delimiter = st.text_input("Category Delimiter", ":")
        subcat_delimiter = st.text_input("Sub-category Delimiter", "-")
        focus_categories_str = st.text_input("Focus Categories", "work, learning, learn, project")
        focus_minutes = st.number_input("Min. Focus Duration (minutes)", min_value=1, value=90)

    if st.button("Start", type="primary", use_container_width=True):
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
                success = run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories, focus_minutes,
                                            period=period)
            else:
                if start_date_input > end_date_input:
                    st.error("Error: Start date cannot be after end date.")
                else:
                    success = run_parser_script(cat_delimiter, subcat_delimiter, weekdays, focus_categories,
                                                focus_minutes,
                                                start_date=start_date_input.strftime('%Y-%m-%d'),
                                                end_date=end_date_input.strftime('%Y-%m-%d'))
            if success:
                st.rerun()
        else:
            st.warning("Please upload an .ics file first.")

    st.header("About")
    st.info("This project provides a personal dashboard to analyze your time based on your calendar data.")


# --- Main Dashboard ---
st.title("📅 Your Dashboard")

if os.path.exists(OUTPUT_CSV_PATH):
    df = pd.read_csv(OUTPUT_CSV_PATH, parse_dates=['start_datetime', 'end_datetime'])
    df['subcategory_1'] = df['subcategory_1'].fillna('no subcategory')
    df['hours'] = df['duration_minutes'] / 60

    start_date_str = df['start_datetime'].min().strftime('%d %b %Y')
    end_date_str = df['start_datetime'].max().strftime('%d %b %Y')
    st.markdown(f"### Visualizing your time from **{start_date_str}** to **{end_date_str}**")
    st.markdown("---")

    st.header("Overview")
    col1, col2 = st.columns(2)
    with col1:
        total_hours = df['hours'].sum()
        st.metric(label="Total Hours Tracked", value=f"{total_hours:.1f} hrs")
        focus_sessions = df['is_focus_session'].sum()
        st.metric(label="Total Focus Sessions", value=f"{int(focus_sessions)}")

    with col2:
        st.subheader("Top 3 Categories")
        top_categories = df.groupby('category')['hours'].sum().nlargest(3).round(1)
        st.dataframe(top_categories.rename("Hours"), use_container_width=True)

    st.markdown("---")

    # st.header("Visualizations")

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("Time per Category")
        category_time = df.groupby(['category', 'subcategory_1'])['hours'].sum().reset_index()
        fig = px.bar(category_time, x='hours', y='category', color='subcategory_1', orientation='h',
                     labels={'hours': 'Total Hours', 'category': 'Category', 'subcategory_1': 'Subcategory'},
                     height=720)
        fig.update_layout(margin=dict(l=20, r=20, t=30, b=20), yaxis={'categoryorder': 'total ascending'})
        st.plotly_chart(fig, use_container_width=True)

    with col2:
        st.subheader("Weekday vs Weekend Breakdown")
        day_type_time = df.groupby(['day_type', 'category'])['hours'].sum().reset_index()
        fig = px.bar(day_type_time, x='day_type', y='hours', color='category',
                     labels={'hours': 'Total Hours', 'day_type': 'Day Type', 'category': 'Category'}, height=720)
        fig.update_layout(margin=dict(l=20, r=20, t=40, b=20))
        st.plotly_chart(fig, use_container_width=True)

    col3, col4 = st.columns(2)
    with col3:
        st.subheader("Category Breakdown")
        fig = px.sunburst(df, path=['category', 'subcategory_1'], values='hours', height=600)
        fig.update_layout(margin=dict(l=20, r=20, t=30, b=20))
        st.plotly_chart(fig, use_container_width=True)

    with col4:
        st.subheader("Average Day")
        # Calculate number of unique days in the dataframe
        num_days = df['date'].nunique()
        avg_daily_time = df.groupby('category')['hours'].sum() / num_days
        fig = px.pie(avg_daily_time, values=avg_daily_time.values, names=avg_daily_time.index, height=600)
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
    st.info("👋 Welcome! Upload your calendar file and run the analysis to get started.")