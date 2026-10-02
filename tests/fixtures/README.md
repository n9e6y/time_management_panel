# Test Fixtures

All data here is **synthetic**. Never add real calendar data.

## `google_export_sample.ics`

A small Google-style export (calendar timezone `Asia/Tehran`, UTC+03:30, no DST) built to exercise every
known parser bug. Analyze with range **2025-09-01 to 2025-09-08**, timezone `Asia/Tehran`.

| UID | What it tests | Correct handling |
|---|---|---|
| `fixture-sleep` | Daily RRULE (5×), EXDATE on 3 Sep, override moving the 4 Sep night to 5 Sep 01:00-08:00 | 4 sleep blocks; none starting 3 Sep; override included once |
| `fixture-social` | Weekly RRULE (2×), second occurrence `STATUS:CANCELLED` | 1 Sep dinner counted; 8 Sep dinner excluded |
| `fixture-learn` | Stored in UTC; title with `#tag`, hyphenated `+project`, `[score]`; escaped comma in DESCRIPTION | one 120 min block, 09:00-11:00 local; description `got stuck on limits, review chapter 3` |
| `fixture-allday` | All-day event | excluded from time totals |
| `fixture-duration` | `DURATION` instead of `DTEND` | 60 min, 14:00-15:00 local |
| `fixture-utc-midnight` | Stored in UTC, crosses **local** midnight | split into 60 + 60 min at local midnight |
| `fixture-unplanned` | `#unplanned` tag | 90 min ME block |
| `fixture-research` | Plain title, 90 min | focus block at exactly the 90 min threshold |

**Expected hours per local date:** 1 Sep 3.0 · 2 Sep 11.0 · 3 Sep 8.5 · 4 Sep 1.5 · 5 Sep 8.0 ·
6 Sep 8.0 · 7 Sep 1.0 · 8 Sep 0. **Total 41.0 h**, 10 blocks, 2 skipped (all-day, cancelled).
These values were verified with `recurring-ical-events` on 2026-10-02.
