# Time Analyzer Dashboard

*A personal dashboard that shows where your time goes, from a Google Calendar you log your day in (.ics export).*

## Features

* **Correct calendar reading**: recurring events, moved and cancelled occurrences, timezones, daylight saving and
  midnight are all handled; all-day reminders are not counted as time.
* **A title grammar for your log**: `CATEGORY: task #tag +project [score]`, e.g. `LEARN: calculus ch.4 #deep +exam-prep [4]`.
* **Goals**: "at least 10 h of LEARN a week", "at most 5 h of ME: scrolling", "49-63 h of SLEEP". The panel judges
  them over the running week and calendar month, against what is expected by now.
* **Overview**: where your time went (with unlogged time shown) and what grew or shrank against the period before,
  what each category was made of, how the mix changed week by week, and which projects took your time.
* **Rhythm**: your average day and whether days off differ, when in the day each activity happens, which weekdays
  carry which activity, a sleep actogram with median bedtime and wake, and a life barcode of every day in the period.
* **Data quality**: which days are fully logged, which titles need fixing, what was skipped and what overlaps —
  and you can fix a mistyped title from the page, without editing the calendar and exporting again.
* **Settings in the app**: timezone, the day your week starts, your days off, categories (order, color, focus),
  and your goals.
* **Private by design**: everything runs and stays on your computer. Nothing is uploaded anywhere, and your
  calendar is kept outside this repository, in `~/.time-analyzer/`.

## How it works

* **`backend/`** (Python, FastAPI): reads the `.ics`, parses titles, splits time at midnight, judges your goals, and
  serves both the results and the dashboard itself on `127.0.0.1`. Also a command-line tool (`backend/runner.py`)
  that exports a CSV.
* **`frontend/`** (React, Vite, TypeScript, ECharts): the dashboard, built once into `frontend/dist/`.

## Setup

### Prerequisites

* Python 3.10+ and Node.js 20+
* A Google Calendar export (`.ics`): Google Calendar → Settings → Import & export → Export, then unzip.

### 1. Clone the repository

```bash
git clone https://github.com/n9e6y/time_management_panel.git
cd time_management_panel
```

### 2. Install

```bash
python3 -m venv venv && source venv/bin/activate   # Windows: python -m venv venv; .\venv\Scripts\activate
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
```

`npm run build` is needed once (and again after you change the frontend); the server then serves the built app, so
you only need Node to build it, never to run it.

### 3. Configure

Settings live in `config.yaml` (gitignored, so your personal settings stay private). Start from the example, or
just save your settings once in the app:

```bash
cp config.example.yaml config.yaml
```

Set your `timezone`, the day your week starts (`week_start`, default Saturday), your `days_off`, and your
categories. Without a `config.yaml`, the example is used.

How to name your events — tags, projects, scores and the spaced hyphen that splits a block's time — is in
**[docs/SYNTAX.md](docs/SYNTAX.md)**.

## Usage

```bash
uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000> and choose your `.ics` file. It is saved on your computer only, in
`~/.time-analyzer/` (`TIME_ANALYZER_HOME` moves the folder), so the next time you open the page the dashboard is
already there. The top bar shows the file and when it was exported; from there you can replace it (or drop a new
`.ics` anywhere on the page), restore the previous one, or remove it. Days after the export are shown as "not in
this file", never as unlogged time.

Re-export and drop the new file in whenever you want fresh numbers: the panel never talks to Google itself.

### Fixing a typo without re-exporting

Data quality lists every title the app could not read cleanly, with the fix next to it:

* **a category not in your list** — add it as a category, or map a misspelling onto a real one (`LEARm` → `LEARN`),
  which then applies to every event you ever wrote that way;
* **a tag not in your list** — add it to your known tags;
* **anything else** (a typo, a bad score, a missing colon) — **Fix title…**, then either *this event* or *all events
  written this way*.

Title corrections are saved in `~/.time-analyzer/corrections.yaml` and applied every time the calendar is read, so
they reach every chart, every goal and the CSV export, and they still apply after you drop in a fresh export. They
are listed at the bottom of Data quality and can be undone there.

Two things they do not do: the `.ics` file on your computer is left exactly as exported, and **your Google Calendar
is not changed** — the app only reads it. If you want the typo gone at the source, fix it in Google too.

### Goals

Settings → Goals. A goal is a category or sub-category, how often it is judged, and an amount:

| Type | Means | Example |
|---|---|---|
| at least | a floor | `LEARN` at least 10 h every week |
| at most | a cap | `ME: scrolling` at most 5 h every week |
| between | a range | `SLEEP` between 49 and 63 h every week |
| fixed schedule | hours are shown, never judged | `CLASS` |

The card at the top of Overview judges them over the week and calendar month happening now, whatever period the
rest of the page is showing. While a period runs, each goal is compared with what is expected by now (the target
times the share of the period that is over), so being at 6 of 10 h on a Wednesday reads as on pace, not as behind.
Within 10% of the line counts as "close". Unlogged time never counts toward a goal, and hours that come from a
split title (` - `) are marked `≈` and never alone decide a miss. Goals live in `~/.time-analyzer/goals.yaml`.

### Backend API

Interactive docs at <http://127.0.0.1:8000/api/docs>. Send the `.ics` file as the request body:

```bash
curl -X POST "http://127.0.0.1:8000/api/analyze?period=this_week" \
     -H "Content-Type: text/calendar" --data-binary @my_calendar.ics
```

Each page has its own address, so you can bookmark one: `/overview`, `/rhythm`, `/data-quality`, `/settings`, all
with `?period=`.

Periods: `1w 2w 1m 3m 6m 1y 2y 5y` (last N days), `this_week last_week this_month last_month this_year`
(weeks follow your `week_start`), or `start=YYYY-MM-DD&end=YYYY-MM-DD`. Sent without a body, `/api/analyze` uses the
saved calendar.

`GET`/`PUT /api/config` read and save your settings (`PUT` rewrites `config.yaml`), and `GET`/`PUT /api/goals` your
goals; `GET /api/goals/progress` measures every goal over the week and month happening now.
`GET`/`PUT /api/corrections` read and save your title corrections. The saved calendar is
`GET /api/calendar` (its facts), `PUT /api/calendar?name=&data_as_of=` (raw body; parsed before it is saved),
`POST /api/calendar/check` (compares a file with the saved one without saving it),
`POST /api/calendar/restore` and `DELETE /api/calendar`.

### Command line

```bash
python backend/runner.py --ics_path my_calendar.ics --period this_month --out my_calendar.csv
```

---

## Privacy

Your calendar is personal data. `data/`, `*.ics` files (except the synthetic test fixture in
`tests/fixtures/`), generated CSVs, `config.yaml` and secrets are listed in `.gitignore` and must never be committed.
Everything runs locally; nothing is uploaded anywhere. The API only listens on `127.0.0.1` and only accepts
requests from the local frontend (`TIME_ANALYZER_ORIGINS` changes the allowed origins). The calendar you load is
kept in `~/.time-analyzer/` — outside the repository, so it can never be committed — together with one previous
copy for Undo, your `goals.yaml` and your `corrections.yaml`. "Remove from this computer" deletes both. Nothing is uploaded anywhere.

## Development

Run the API and the Vite dev server in two terminals for hot reload (the dev server proxies `/api` to the backend):

```bash
uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000   # docs at /api/docs
cd frontend && npm run dev                                            # http://127.0.0.1:5173
```

```bash
pytest                            # backend (includes the API tests)
cd frontend && npm test           # frontend (Vitest)
cd frontend && npm run typecheck
```

Tests use only the synthetic calendar in `tests/fixtures/` (see `tests/fixtures/README.md`).

## Folder Structure

```
.
├── backend/
│   ├── api/               # FastAPI app (routes, cache, JSON conversion)
│   ├── config.py          # loads, validates and saves config.yaml
│   ├── ingest.py          # calendar parsing core
│   ├── corrections.py     # title corrections, applied when the calendar is read
│   ├── goals.py           # weekly and monthly goals, and how they are judged
│   ├── periods.py         # date-range presets
│   ├── store.py           # the calendar remembered in ~/.time-analyzer/
│   ├── syntax.py          # event title grammar
│   └── runner.py          # command-line tool
├── frontend/
│   └── src/
│       ├── lib/           # API client, calculations behind each chart, takeaway lines, routes, formats
│       ├── charts/        # ECharts options
│       ├── components/    # shared UI pieces
│       └── pages/         # Welcome, Overview, Rhythm, Data quality, Settings
│   └── dist/              # the built app, served by the backend (npm run build)
├── tests/
│   ├── fixtures/          # synthetic calendar + expected results
│   └── test_*.py
├── docs/SYNTAX.md         # how to name your calendar events
├── config.example.yaml    # settings template (copy to config.yaml)
├── pyproject.toml         # pytest settings
├── requirements.txt       # pinned Python dependencies
└── README.md
```

---
