import streamlit as st
import pandas as pd
import os
import subprocess
import sys

# --- Page Configuration ---
st.set_page_config(
    page_title="Time Analyzer Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Path Configuration (Robust Method) ---
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SRC_DIR)

# --- Static Paths & Default Values ---
# Construct absolute paths
INPUT_ICS_DIR = os.path.join(BASE_DIR, 'data', 'ics')
OUTPUT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'output', 'calendar.csv')
RUNNER_SCRIPT_PATH = os.path.join(SRC_DIR, 'runner.py')  # Absolute path to runner.py
DEFAULT_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


# --- Helper Functions ---
def run_parser_script(period, cat_delimiter, subcat_delimiter, weekdays, focus_categories, focus_minutes):
    """
    Constructs and runs this script as a subprocess with the selected arguments.
    """
    python_executable = sys.executable  # Ensure the script runs with the same Python interpreter that's running Streamlit

    command = [
        python_executable, RUNNER_SCRIPT_PATH,
        '--period', period,
        '--cat_delimiter', cat_delimiter,
        '--subcat_delimiter', subcat_delimiter,
        '--weekdays', *weekdays,
        '--focus_categories', *focus_categories,
        '--focus_minutes', str(focus_minutes)
    ]

    st.info(f"⚙️ Running analysis... this may take a moment.")
    with st.expander("Show execution command"):
        st.code(' '.join(command), language='bash')

    try:
        # Run the subprocess, ensuring the working directory is the project's base directory
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            cwd=BASE_DIR  # This ensures relative paths in the runner script are correct
        )
        st.success("✅ Analysis complete!")
        with st.expander("Show analysis log"):
            st.text(process.stdout)
    except subprocess.CalledProcessError as e:
        st.error(f"An error occurred during analysis.")
        st.code(e.stderr, language='bash')
        return False
    return True


# --- Sidebar ---
with st.sidebar:
    st.header("Settings")

    # 1. File Uploader
    st.subheader("Upload Calendar")
    uploaded_file = st.file_uploader(
        "Drag and drop your .ics file here",
        type=['ics'],
        help="Upload your exported calendar file (.ics)."
    )

    # 2. Parser Settings
    with st.expander("⚙️ Parser & Feature Settings", expanded=True):
        period = st.selectbox(
            "Analysis Period",
            options=['1w', '2w', '1m', '3m', '6m', '1y', '2y', '5y'],
            index=2,  # Default to '1month'
            help="Select the time range for the analysis."
        )

        weekdays = st.multiselect(
            "Which days are weekdays?",
            options=ALL_DAYS,
            default=DEFAULT_WEEKDAYS
        )

        cat_delimiter = st.text_input("Category Delimiter", value=":")
        subcat_delimiter = st.text_input("Sub-category Delimiter", value="-")

        focus_categories_str = st.text_input(
            "Focus Categories (comma-separated)",
            value="work, learning, learn, project"
        )
        focus_minutes = st.number_input("Min. Focus Session Duration (minutes)", min_value=1, value=90)

    # Process Button
    if st.button("Analyze My Time", type="primary", use_container_width=True):
        if uploaded_file is not None:
            # Ensure required directories exist
            os.makedirs(INPUT_ICS_DIR, exist_ok=True)

            # Save the uploaded file
            file_path = os.path.join(INPUT_ICS_DIR, uploaded_file.name)
            with open(file_path, "wb") as f:
                f.write(uploaded_file.getbuffer())

            # Convert focus categories string to list
            focus_categories = [cat.strip() for cat in focus_categories_str.split(',')]

            # Run the script
            success = run_parser_script(
                period, cat_delimiter, subcat_delimiter, weekdays,
                focus_categories, focus_minutes
            )
            if success:
                st.rerun()
        else:
            st.warning("Please upload an .ics file first.")

    # 3. About Section
    st.subheader("About")
    st.info(
        """
        This project provides a personal dashboard to analyze your time based on your calendar data.

        **Developer:** nima
        """
    )

# --- Main Dashboard Area ---
st.title("📅 Your Time Dashboard")
st.markdown("Welcome! Upload your calendar and run the analysis to see your personalized insights.")

# Placeholder for theme toggle
# Note: True theme toggling is complex. This is a conceptual placeholder.
col1, col2 = st.columns([0.9, 0.1])
with col2:
    st.button("☀️/🌙", help="Toggle Light/Dark Mode")

st.markdown("---")

# Load data if it exists
if os.path.exists(OUTPUT_CSV_PATH):
    df = pd.read_csv(OUTPUT_CSV_PATH)

    # --- Dashboard Widgets ---
    st.header("Overview")

    # Row 1: Key Metrics
    col1, col2, col3 = st.columns(3)
    with col1:
        total_hours = df['duration_minutes'].sum() / 60
        st.metric(label="Total Hours Tracked", value=f"{total_hours:.1f} hrs")

    with col2:
        focus_sessions = df['is_focus_session'].sum()
        st.metric(label="Total Focus Sessions", value=f"{focus_sessions}")

    with col3:
        top_category = df.groupby('category')['duration_minutes'].sum().idxmax()
        st.metric(label="Top Category", value=top_category)

    st.markdown("---")

    # Row 2: Charts
    st.header("Visualizations")
    col1, col2 = st.columns([2, 1])  # Make the first column wider
    with col1:
        st.subheader("Time per Category")
        category_time = df.groupby('category')['duration_minutes'].sum().sort_values(ascending=False)
        st.bar_chart(category_time)

    with col2:
        st.subheader("Weekday vs Weekend")
        day_type_time = df.groupby('day_type')['duration_minutes'].sum()
        st.bar_chart(day_type_time)

    # Row 3: More charts
    st.subheader("Time per Day of Week")
    day_of_week_time = df.groupby('day_of_week')['duration_minutes'].sum()
    # Reorder to be chronological
    day_of_week_time = day_of_week_time.reindex(ALL_DAYS).dropna()
    st.bar_chart(day_of_week_time)

    # Raw Data
    with st.expander("View Raw Data"):
        st.dataframe(df)

else:
    st.info("No data to display. Please upload a calendar file and run the analysis.")
