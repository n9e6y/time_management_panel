// The backend's real response for the synthetic fixture calendar (tests/fixtures/google_export_sample.ics),
// analysed 1-8 Sep 2025 with config.example.yaml. Regenerate it if the API shape changes.
import raw from "./fixture-response.json";
import type { Analysis, Block, PeriodPreset, Segment, SettingsResponse } from "../lib/types";
import type { Ctx } from "../lib/aggregate";
import { addDays, daysBetween, weekStartOf, weekdayOf } from "../lib/time";

export const fixtureAnalysis = raw.analysis as unknown as Analysis;
export const fixtureSettings = (raw.config as unknown as SettingsResponse).settings;
export const fixtureConfig = raw.config as unknown as SettingsResponse;
export const fixturePeriods = raw.periods as { presets: PeriodPreset[]; default: string };
export const FIXTURE_TODAY = "2025-09-08";

export const fixtureCtx = () => ({
  analysis: structuredClone(fixtureAnalysis), settings: structuredClone(fixtureSettings), today: FIXTURE_TODAY,
});

// --- a generated calendar, for the charts the 8-day fixture is too short for ---------------------
// Synthetic and deterministic (no real data): sleep 23:30-07:30, class on workdays, learning and
// personal time every day. Used by O3's week/month buckets, R4 (14 nights) and R5 (30 days).

const TZ = "Asia/Tehran";
const OFFSET = "+03:30";

interface Entry {
  category: string;
  task: string;
  /** Local start hour, as a decimal (9.5 = 09:30). */
  start: number;
  hours: number;
  workdaysOnly?: boolean;
  projects?: string[];
}

const DAY: Entry[] = [
  { category: "SLEEP", task: "sleep", start: 0, hours: 7.5 },          // the morning of the night before
  { category: "CLASS", task: "lecture", start: 9, hours: 3, workdaysOnly: true },
  { category: "LEARN", task: "calculus", start: 13, hours: 2, projects: ["exam-prep"] },
  { category: "ME", task: "chill", start: 19, hours: 2 },
  { category: "SLEEP", task: "sleep", start: 23.5, hours: 0.5 },       // bedtime of the night starting today
];

const clock = (hour: number) => `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

/**
 * A synthetic analysis covering `first`…`last`. `today` defaults to the day after the period, so
 * every day is complete; pass a day inside the period to get a day in progress.
 */
export function syntheticCtx(first: string, last: string, today = addDays(last, 1)): Ctx {
  const settings = structuredClone(fixtureSettings);
  const blocks: Block[] = [];
  const segments: Segment[] = [];
  let id = 0;
  for (const date of daysBetween(first, last)) {
    const dayOff = settings.days_off.includes(weekdayOf(date));
    for (const e of DAY) {
      if (e.workdaysOnly && dayOff) continue;
      const startLocal = `${date}T${clock(e.start)}:00${OFFSET}`;
      const endLocal = `${date}T${clock(e.start + e.hours)}:00${OFFSET}`;
      const common = {
        block_id: id, uid: `synthetic-${id}`, title: `${e.category}: ${e.task}`, category: e.category,
        task: e.task, tags: [] as string[], projects: e.projects ?? [], score: null, comment: "",
        is_focus: e.category === "CLASS" || e.category === "LEARN", duration_min: e.hours * 60,
        start_local: startLocal, end_local: endLocal,
      };
      blocks.push({
        ...common, description: "", subcategories: [e.task], issues: [],
        start_utc: startLocal, end_utc: endLocal,
      });
      segments.push({
        ...common, part_index: 0, subcategory: e.task, date, day_of_week: weekdayOf(date),
        is_day_off: dayOff, day_type: dayOff ? "Day off" : "Workday",
        week_start: weekStartOf(date, settings.week_start),
      });
      id += 1;
    }
  }
  const analysis: Analysis = {
    range: { first_day: first, last_day: last, timezone: TZ, week_start: settings.week_start, days_off: settings.days_off },
    config_source: "synthetic", calendar: { first_day: first, last_day: last },
    totals: {
      hours: segments.reduce((a, s) => a + s.duration_min / 60, 0), blocks: blocks.length,
      segments: segments.length, skipped: 0, overlaps: 0, title_issues: 0,
    },
    blocks, segments,
    report: { skipped: [], overlaps: [], title_issues: {} },
  };
  return { analysis, settings, today };
}
