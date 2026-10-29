from datetime import date
from pathlib import Path

import pandas as pd
import pytest

import config

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ICS = ROOT / "tests" / "fixtures" / "google_export_sample.ics"
FIXTURE_CONFIG = ROOT / "config.example.yaml"  # timezone Asia/Tehran, focus JOB/CLASS/LEARN/RESEARCH, day off Friday


@pytest.fixture
def fixture_ics() -> Path:
    return FIXTURE_ICS


@pytest.fixture
def run_pipeline(tmp_path):
    """Run ``runner.write_calendar_csv`` on the synthetic fixture and return the CSV as a DataFrame.

    Always writes to ``tmp_path``, never to ``data/output``.
    """

    def _run(ics_path: Path = FIXTURE_ICS, first_day: date = date(2025, 9, 1),
             last_day: date = date(2025, 9, 8)) -> pd.DataFrame:
        import runner

        csv_path = tmp_path / "calendar.csv"
        runner.write_calendar_csv(str(ics_path), str(csv_path), first_day, last_day,
                                  config.load_config(FIXTURE_CONFIG))
        return pd.read_csv(csv_path)

    return _run
