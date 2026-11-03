// Shapes returned by the FastAPI backend (backend/api/serialize.py).

export interface Block {
  block_id: number;
  uid: string;
  title: string;
  description: string;
  comment: string;
  start_utc: string;
  end_utc: string;
  start_local: string;
  end_local: string;
  duration_min: number;
  category: string;
  task: string;
  subcategories: string[];
  tags: string[];
  projects: string[];
  score: number | null;
  issues: string[];
  is_focus: boolean;
}

export interface Segment {
  block_id: number;
  part_index: number;
  subcategory: string;
  uid: string;
  title: string;
  category: string;
  task: string;
  tags: string[];
  projects: string[];
  score: number | null;
  comment: string;
  is_focus: boolean;
  date: string;
  day_of_week: string;
  is_day_off: boolean;
  day_type: "Workday" | "Day off";
  week_start: string;
  start_local: string;
  end_local: string;
  duration_min: number;
}

export interface TitleIssue {
  block_id: number;
  title: string;
  start_local: string;
  issues: string[];
}

export interface Analysis {
  range: { first_day: string; last_day: string; timezone: string; week_start: string; days_off: string[] };
  config_source: string;
  calendar: { first_day: string | null; last_day: string | null };
  totals: { hours: number; blocks: number; segments: number; skipped: number; overlaps: number; title_issues: number };
  blocks: Block[];
  segments: Segment[];
  report: {
    skipped: { uid: string; title: string; start: string | null; reason: string }[];
    overlaps: { block_a: number; block_b: number; minutes: number }[];
    title_issues: Record<string, TitleIssue[]>;
  };
}

export interface Settings {
  timezone: string;
  week_start: string;
  days_off: string[];
  categories: Record<string, { focus: boolean; color: number | null }>;
  legacy_categories: Record<string, { map_to: string | null; add_tags: string[] }>;
  focus: { min_minutes: number };
  syntax: { subcategory_separator: string };
  tags: { known: string[] };
}

export interface SettingsResponse {
  settings: Settings;
  source: string;
}

export interface PeriodPreset {
  id: string;
  label: string;
  kind: "rolling" | "calendar";
}

/** A period choice: a preset id or a custom range. */
export type Period = { preset: string } | { start: string; end: string };

/** The calendar saved on this computer (backend/store.py). */
export interface CalendarInfo {
  name: string;
  size: number;
  sha256: string;
  loaded_at: string;
  data_as_of: string | null;
  first_day: string | null;
  last_day: string | null;
  events: number;
  known_share: number;
}

export interface CalendarState {
  calendar: CalendarInfo | null;
  has_previous: boolean;
  folder: string;
}

export interface CalendarWarning {
  code: "shorter_span" | "ends_earlier" | "few_known_categories";
  current: number | string;
  new: number | string;
}

export interface CalendarCheck {
  current: CalendarInfo | null;
  new: CalendarInfo;
  warnings: CalendarWarning[];
}


// --- goals (Stage 4) ---------------------------------------------------------------------------

export type GoalEvery = "week" | "month";
export type GoalType = "floor" | "cap" | "range" | "fixed";

/** One goal as stored in goals.yaml. */
export interface Goal {
  id: string;
  /** A category ("LEARN") or a sub-category ("ME: scrolling"). */
  scope: string;
  every: GoalEvery;
  type: GoalType;
  hours?: number | null;
  min?: number | null;
  max?: number | null;
  tolerance?: number;
  why?: string;
}

export type GoalStatus =
  | "met" | "close" | "missed"            // floor, finished period
  | "within" | "over"                     // cap, finished period
  | "in_range" | "below" | "above"        // range, finished period
  | "on_pace" | "behind" | "heading_over" // any type, running period
  | "logged";                             // fixed: never judged on hours

/** A goal measured over the week or month happening now (GET /api/goals/progress). */
export interface GoalProgress extends Goal {
  label: string;
  first_day: string;
  last_day: string;
  running: boolean;
  elapsed: number;
  actual: number;
  /** Part of `actual` that comes from titles split on " - ". */
  estimated: number;
  blocks: number;
  coverage: number;
  low_coverage: boolean;
  status: GoalStatus;
  expected: number | null;
  expected_min: number | null;
  expected_max: number | null;
  gap: number;
  projected: number | null;
}

export interface GoalsResponse {
  goals: Goal[];
  path: string;
}

export interface GoalsProgress {
  goals: GoalProgress[];
  /** Last day with real data: today, or the calendar's export day when that is earlier. */
  as_of: string;
  today: string;
  path: string;
}
