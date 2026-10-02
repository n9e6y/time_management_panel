from datetime import datetime
from pathlib import Path

import pandas as pd
import pytest
import pytz

FIXTURE_ICS = Path(__file__).parent / "fixtures" / "google_export_sample.ics"
FIXTURE_TZ = "Asia/Tehran"
FOCUS_CATEGORIES = ["JOB", "CLASS", "LEARN", "RESEARCH"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


@pytest.fixture
def fixture_ics() -> Path:
    return FIXTURE_ICS


@pytest.fixture
def run_pipeline(tmp_path):
    """Run ``runner.process_ics_to_csv`` on the synthetic fixture and return the CSV as a DataFrame.

    Always writes to ``tmp_path``, never to ``data/output``.
    """

    def _run(ics_path: Path = FIXTURE_ICS, timezone: str = FIXTURE_TZ,
             first_day: str = "2025-09-01", last_day: str = "2025-09-08") -> pd.DataFrame:
        import runner

        tz = pytz.timezone(timezone)
        start = tz.localize(datetime.strptime(first_day, "%Y-%m-%d")).astimezone(pytz.utc)
        end = tz.localize(datetime.combine(datetime.strptime(last_day, "%Y-%m-%d").date(),
                                           datetime.max.time())).astimezone(pytz.utc)
        csv_path = tmp_path / "calendar.csv"
        runner.process_ics_to_csv(
            ics_path=str(ics_path), csv_path=str(csv_path),
            cat_delimiter=":", subcat_delimiter="-",
            start_date=start, end_date=end, weekdays=WEEKDAYS,
            focus_categories=FOCUS_CATEGORIES, focus_minutes=90, timezone_str=timezone,
        )
        return pd.read_csv(csv_path)

    return _run
