// Turns an analysis into the numbers each chart shows. Pure functions; definitions follow
// the project's design notes; every number a chart shows is computed here and tested.
import type { Analysis, Segment, Settings } from "./types";
import {
  addDays, addMonths, dayLengthHours, daysBetween, endOfMonth, minutesOfDay, startOfMonth, weekStartOf,
  weekdayOf, weekdaysFrom,
} from "./time";

export const UNCATEGORIZED = "UNCATEGORIZED";
export const OTHER = "Other";
export const UNLOGGED = "Unlogged";
export const COLOR_SLOTS = 9;

export type GroupKind = "category" | "legacy" | "unknown" | "uncategorized";

export interface Ctx {
  analysis: Analysis;
  settings: Settings;
  /** Today's date in the user's timezone. */
  today: string;
  /** Local date the calendar file was exported ("data as of"); later days are not in the file. */
  dataAsOf?: string | null;
}

// --- days -------------------------------------------------------------------------------------

export interface PeriodDays {
  all: string[];
  /** Days that are over and fully in the file: they count toward unlogged time, averages and coverage. */
  full: string[];
  /** Today while it is in progress, or the day the file was exported: only its logged hours count (owner Q3). */
  partial: string | null;
  /** Days after the file's export: shown as "not in this file", never as unlogged. */
  notInFile: string[];
  todayInProgress: boolean;
}

export function periodDays({ analysis, today, dataAsOf }: Ctx): PeriodDays {
  const all = daysBetween(analysis.range.first_day, analysis.range.last_day);
  const cutoff = dataAsOf && dataAsOf < today ? dataAsOf : today;
  return {
    all,
    full: all.filter((d) => d < cutoff),
    partial: all.includes(cutoff) ? cutoff : null,
    notInFile: all.filter((d) => d > cutoff),
    todayInProgress: all.includes(today),
  };
}

export function isDayOff(day: string, settings: Settings): boolean {
  return settings.days_off.includes(weekdayOf(day));
}

function hoursByDate(segments: Segment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of segments) out.set(s.date, (out.get(s.date) ?? 0) + s.duration_min / 60);
  return out;
}

// --- groups and colors ------------------------------------------------------------------------

export interface Group {
  key: string;
  kind: GroupKind;
  /** Color slot 1-9, or null for the "Other" grey. */
  slot: number | null;
}

export function groupOf(category: string, settings: Settings): Group {
  const configured = settings.categories[category];
  if (configured) return { key: category, kind: "category", slot: configured.color ?? null };
  if (category === UNCATEGORIZED) return { key: category, kind: "uncategorized", slot: null };
  if (category in settings.legacy_categories) return { key: category, kind: "legacy", slot: null };
  return { key: category, kind: "unknown", slot: null };
}

export const KIND_LABEL: Record<GroupKind, string> = {
  category: "",
  legacy: "old category",
  unknown: "not in your list",
  uncategorized: "no category",
};

/** Charts with stacked categories (O3, O4, O5) merge everything without its own color into "Other". */
function stackKey(category: string, settings: Settings): string {
  const g = groupOf(category, settings);
  return g.kind === "category" && g.slot !== null ? category : OTHER;
}

function stackOrder(settings: Settings): string[] {
  return [...Object.entries(settings.categories).filter(([, c]) => c.color !== null).map(([n]) => n), OTHER];
}

// --- tiles ------------------------------------------------------------------------------------

export interface Totals {
  loggedHours: number;
  /** Hours available: full days at their real length plus the partial day's logged hours. */
  denominatorHours: number;
  unloggedHours: number;
  avgPerDay: number;
  fullDays: number;
  focusSessions: number;
  blocks: number;
  skipped: number;
  issues: number;
}

export function totals(ctx: Ctx): Totals {
  const { analysis, settings } = ctx;
  const days = periodDays(ctx);
  const byDate = hoursByDate(analysis.segments);
  const tz = settings.timezone;
  let unlogged = 0;
  let fullLogged = 0;
  let available = 0;
  for (const day of days.full) {
    const logged = byDate.get(day) ?? 0;
    const length = dayLengthHours(day, tz);
    available += length;
    fullLogged += logged;
    unlogged += Math.max(0, length - logged);
  }
  const todayLogged = days.partial ? (byDate.get(days.partial) ?? 0) : 0;
  const issueBlocks = new Set(Object.values(analysis.report.title_issues).flat().map((i) => i.block_id));
  return {
    loggedHours: fullLogged + todayLogged,
    denominatorHours: available + todayLogged,
    unloggedHours: unlogged,
    avgPerDay: days.full.length ? fullLogged / days.full.length : 0,
    fullDays: days.full.length,
    focusSessions: analysis.blocks.filter((b) => b.is_focus).length,
    blocks: analysis.blocks.length,
    skipped: analysis.report.skipped.length,
    issues: issueBlocks.size + analysis.report.skipped.length + analysis.report.overlaps.length,
  };
}

// --- O1: where did my time go? ----------------------------------------------------------------

export interface CategoryRow extends Group {
  label: string;
  hours: number;
  share: number;
  perDay: number;
  /** Hours minus the previous period's, once `withDeltas` has run (O1's Δ column). */
  delta?: number;
}

export function categoryRows(ctx: Ctx): CategoryRow[] {
  const { analysis, settings } = ctx;
  const t = totals(ctx);
  const days = periodDays(ctx);
  const full = new Set(days.full);
  const hours = new Map<string, number>();
  const fullHours = new Map<string, number>();
  for (const s of analysis.segments) {
    hours.set(s.category, (hours.get(s.category) ?? 0) + s.duration_min / 60);
    if (full.has(s.date)) fullHours.set(s.category, (fullHours.get(s.category) ?? 0) + s.duration_min / 60);
  }
  const row = (category: string): CategoryRow => {
    const g = groupOf(category, settings);
    const h = hours.get(category) ?? 0;
    return {
      ...g, label: category, hours: h, share: t.denominatorHours ? h / t.denominatorHours : 0,
      perDay: days.full.length ? (fullHours.get(category) ?? 0) / days.full.length : 0,
    };
  };
  const configured = Object.keys(settings.categories).map(row);
  const others = [...hours.keys()].filter((c) => !(c in settings.categories)).map(row)
    .sort((a, b) => b.hours - a.hours);
  const unlogged: CategoryRow = {
    key: UNLOGGED, kind: "category", slot: null, label: UNLOGGED, hours: t.unloggedHours,
    share: t.denominatorHours ? t.unloggedHours / t.denominatorHours : 0,
    perDay: days.full.length ? t.unloggedHours / days.full.length : 0,
  };
  return [...configured, ...others, unlogged];
}

// --- O2: what was X made of? ------------------------------------------------------------------

export interface SubcategoryRow {
  label: string;
  hours: number;
  /** Hours come from an even split of a block on " - " (shown with ≈). */
  estimated: boolean;
  count: number;
}

export function subcategoryRows(ctx: Ctx, category: string, top = 8): SubcategoryRow[] {
  const split = new Set(ctx.analysis.blocks.filter((b) => b.subcategories.length > 1).map((b) => b.block_id));
  const rows = new Map<string, SubcategoryRow>();
  for (const s of ctx.analysis.segments.filter((x) => x.category === category)) {
    const label = s.subcategory || "(no sub-category)";
    const key = label.toLowerCase();
    const row = rows.get(key) ?? { label, hours: 0, estimated: false, count: 0 };
    row.hours += s.duration_min / 60;
    row.estimated ||= split.has(s.block_id);
    row.count += 1;
    rows.set(key, row);
  }
  const ranked = [...rows.values()].sort((a, b) => b.hours - a.hours);
  if (ranked.length <= top) return ranked;
  const rest = ranked.slice(top);
  return [...ranked.slice(0, top), {
    label: `${rest.length} others`, hours: rest.reduce((a, r) => a + r.hours, 0),
    estimated: rest.some((r) => r.estimated), count: rest.reduce((a, r) => a + r.count, 0),
  }];
}

// --- O3: what does an average day look like? --------------------------------------------------

export type DayType = "All days" | "Workday" | "Day off";
export type Denominator = "calendar" | "logged";

export interface AverageDayRow {
  type: DayType;
  days: number;
  /** Average hours per group, in stack order, then Unlogged. */
  hours: { key: string; hours: number }[];
}

function daysOfType(days: string[], type: DayType, settings: Settings): string[] {
  if (type === "All days") return days;
  return days.filter((d) => isDayOff(d, settings) === (type === "Day off"));
}

export function averageDay(ctx: Ctx, denominator: Denominator): AverageDayRow[] {
  const { analysis, settings } = ctx;
  const full = periodDays(ctx).full;
  const logged = new Set(analysis.segments.map((s) => s.date));
  return (["All days", "Workday", "Day off"] as DayType[]).map((type) => {
    let days = daysOfType(full, type, settings);
    if (denominator === "logged") days = days.filter((d) => logged.has(d));
    const daySet = new Set(days);
    const sums = new Map<string, number>();
    for (const s of analysis.segments) {
      if (!daySet.has(s.date)) continue;
      const key = stackKey(s.category, settings);
      sums.set(key, (sums.get(key) ?? 0) + s.duration_min / 60);
    }
    const n = days.length;
    const avgLength = n ? days.reduce((a, d) => a + dayLengthHours(d, settings.timezone), 0) / n : 24;
    const hours = stackOrder(settings).map((key) => ({ key, hours: n ? (sums.get(key) ?? 0) / n : 0 }));
    const loggedAvg = hours.reduce((a, h) => a + h.hours, 0);
    return { type, days: n, hours: [...hours, { key: UNLOGGED, hours: n ? Math.max(0, avgLength - loggedAvg) : 0 }] };
  });
}

// --- O4: when in the day does each thing happen? ----------------------------------------------

export const SLOT_MINUTES = 15;
export const MIN_DAYS_O4 = 7;

export type NotEnough = { notEnough: true; need: number; have: number };

export interface DayProbability {
  days: number;
  /** Share of days (0-1) each group occupies in each 15-minute slot; Unlogged last. */
  series: { key: string; shares: number[] }[];
}

export function dayProbability(ctx: Ctx, type: DayType): DayProbability | NotEnough {
  const { analysis, settings } = ctx;
  const days = daysOfType(periodDays(ctx).full, type, settings);
  if (days.length < MIN_DAYS_O4) return { notEnough: true, need: MIN_DAYS_O4, have: days.length };
  const slots = (24 * 60) / SLOT_MINUTES;
  const daySet = new Set(days);
  const order = stackOrder(settings);
  const minutes = new Map(order.map((k) => [k, new Array<number>(slots).fill(0)]));
  for (const s of analysis.segments) {
    if (!daySet.has(s.date)) continue;
    const start = minutesOfDay(s.start_local);
    const end = start + s.duration_min;
    const series = minutes.get(stackKey(s.category, settings))!;
    for (let slot = Math.floor(start / SLOT_MINUTES); slot * SLOT_MINUTES < end && slot < slots; slot++) {
      series[slot] += Math.min(end, (slot + 1) * SLOT_MINUTES) - Math.max(start, slot * SLOT_MINUTES);
    }
  }
  const capacity = SLOT_MINUTES * days.length;
  const shares = order.map((key) => ({ key, shares: minutes.get(key)!.map((m) => m / capacity) }));
  for (let slot = 0; slot < slots; slot++) {  // overlaps can exceed 100%: scale them back
    const sum = shares.reduce((a, s) => a + s.shares[slot], 0);
    if (sum > 1) shares.forEach((s) => (s.shares[slot] /= sum));
  }
  const unlogged = Array.from({ length: slots }, (_, slot) =>
    Math.max(0, 1 - shares.reduce((a, s) => a + s.shares[slot], 0)));
  return { days: days.length, series: [...shares, { key: UNLOGGED, shares: unlogged }] };
}

// --- O5: which days of my week carry which activity? ------------------------------------------

export const MIN_PER_WEEKDAY_O5 = 2;

export interface WeekdayHeatmap {
  weekdays: { name: string; count: number; dayOff: boolean }[];
  /** Average hours per occurrence of each weekday, per group (stack order, then Unlogged). */
  rows: { key: string; hours: number[] }[];
}

export function weekdayHeatmap(ctx: Ctx): WeekdayHeatmap | NotEnough {
  const { analysis, settings } = ctx;
  const full = periodDays(ctx).full;
  const names = weekdaysFrom(settings.week_start);
  const count = new Map(names.map((n) => [n, 0]));
  full.forEach((d) => count.set(weekdayOf(d), count.get(weekdayOf(d))! + 1));
  const fewest = Math.min(...count.values());
  if (fewest < MIN_PER_WEEKDAY_O5) return { notEnough: true, need: 7 * MIN_PER_WEEKDAY_O5, have: full.length };
  const fullSet = new Set(full);
  const order = stackOrder(settings);
  const sums = new Map(order.map((k) => [k, new Array<number>(7).fill(0)]));
  for (const s of analysis.segments) {
    if (!fullSet.has(s.date)) continue;
    sums.get(stackKey(s.category, settings))![names.indexOf(weekdayOf(s.date))] += s.duration_min / 60;
  }
  const rows = order.map((key) => ({ key, hours: sums.get(key)!.map((h, i) => h / count.get(names[i])!) }));
  const lengths = names.map((n) => {
    const ds = full.filter((d) => weekdayOf(d) === n);
    return ds.reduce((a, d) => a + dayLengthHours(d, settings.timezone), 0) / ds.length;
  });
  const unlogged = names.map((_, i) => Math.max(0, lengths[i] - rows.reduce((a, r) => a + r.hours[i], 0)));
  return {
    weekdays: names.map((name) => ({ name, count: count.get(name)!, dayOff: settings.days_off.includes(name) })),
    rows: [...rows, { key: UNLOGGED, hours: unlogged }],
  };
}

// --- D1: which days can I trust? --------------------------------------------------------------

export interface CoverageDay {
  day: string;
  hours: number;
  /** Logged share of the real day length (can exceed 1 with overlaps). */
  share: number;
  today: boolean;
  /** In progress (today) or the file's export day: not judged on coverage. */
  partial: boolean;
  notInFile: boolean;
  dayOff: boolean;
}

export function coverage(ctx: Ctx): CoverageDay[] {
  const byDate = hoursByDate(ctx.analysis.segments);
  const days = periodDays(ctx);
  const notInFile = new Set(days.notInFile);
  return days.all.map((day) => {
    const hours = byDate.get(day) ?? 0;
    return {
      day, hours, share: hours / dayLengthHours(day, ctx.settings.timezone),
      today: day === ctx.today, partial: day === days.partial, notInFile: notInFile.has(day),
      dayOff: isDayOff(day, ctx.settings),
    };
  });
}

/** Share of all full days' hours that is logged (the Data quality "coverage" tile). */
export function coverageShare(ctx: Ctx): number {
  let length = 0;
  let logged = 0;
  for (const d of coverage(ctx).filter((c) => !c.partial && !c.notInFile)) {
    const dayLength = dayLengthHours(d.day, ctx.settings.timezone);
    length += dayLength;
    logged += Math.min(d.hours, dayLength);  // overlaps don't make a day more than fully logged
  }
  return length ? logged / length : 0;
}

// ==============================================================================================
// Stage 3.5 Part B (ux-v2 page-overview.md, page-rhythm.md)
// ==============================================================================================

// --- the previous period (tiles' "prev." line and O1's Δ column) -------------------------------

export interface PreviousPeriod {
  start: string;
  end: string;
}

/** Why there is nothing to compare with: the calendar does not reach back that far. */
export interface NoPrevious {
  unavailable: true;
  /** First day the calendar file has, so the page can say where it starts. */
  calendarFirstDay: string | null;
}

/**
 * The period this one is compared with (owner decision 2026-10-31): calendar presets compare
 * like-for-like (the previous month's or year's first N days), every other period the N days
 * immediately before.
 */
export function previousRange(analysis: Analysis, preset: string | null): PreviousPeriod | NoPrevious {
  const { first_day, last_day } = analysis.range;
  const days = daysBetween(first_day, last_day).length;
  let start: string;
  let end: string;
  if (preset === "this_month" || preset === "last_month") {
    start = addMonths(startOfMonth(first_day), -1);
    const wanted = addDays(start, days - 1);
    const monthEnd = endOfMonth(start);
    end = wanted < monthEnd ? wanted : monthEnd;  // a shorter month cannot lend more days than it has
  } else if (preset === "this_year") {
    start = `${Number(first_day.slice(0, 4)) - 1}-01-01`;
    end = addDays(start, days - 1);
  } else {
    end = addDays(first_day, -1);
    start = addDays(end, -(days - 1));
  }
  const calendarFirstDay = analysis.calendar.first_day;
  if (!calendarFirstDay || calendarFirstDay > start) return { unavailable: true, calendarFirstDay };
  return { start, end };
}

/** A change smaller than this is shown without an arrow (page-overview.md). */
export const DELTA_ARROW_HOURS = 2;

/** O1's Δ column: this period's hours minus the previous period's, per row. */
export function withDeltas(rows: CategoryRow[], previous: CategoryRow[]): CategoryRow[] {
  const prev = new Map(previous.map((r) => [r.key, r.hours]));
  const withDelta = rows.map((r) => ({ ...r, delta: r.hours - (prev.get(r.key) ?? 0) }));
  const seen = new Set(rows.map((r) => r.key));
  const gone = previous
    .filter((r) => !seen.has(r.key) && r.key !== UNLOGGED && r.hours > 0)
    .map((r) => ({ ...r, hours: 0, share: 0, perDay: 0, delta: -r.hours }));
  if (!gone.length) return withDelta;
  const at = withDelta.findIndex((r) => r.key === UNLOGGED);  // keep Unlogged last
  const cut = at === -1 ? withDelta.length : at;
  return [...withDelta.slice(0, cut), ...gone, ...withDelta.slice(cut)];
}

// --- O3: how has my time changed over the period? ---------------------------------------------

export type BucketKind = "day" | "week" | "month";
export const MIN_BUCKETS_O3 = 2;
/** Bucket thresholds (page-overview.md): one bar per day, per week, or per month. */
export const MAX_DAY_BUCKETS = 31;
export const MAX_WEEK_BUCKETS = 26;

export interface MixBucket {
  /** The bucket's first day: a date, a week start, or the first of a month. */
  key: string;
  /** Days of this bucket inside the period. */
  days: number;
  /** The bucket is not a whole day/week/month of fully logged time (drawn outlined, labelled "partial"). */
  partial: boolean;
  dayOff: boolean;
  /** Day buckets: the day starts the user's week (the only x labels drawn). */
  weekStart: boolean;
  /** Average hours per day per group, in stack order, then Unlogged. */
  hours: { key: string; hours: number }[];
  /** Average hours per day that are after "data as of" or still to come: dotted, never Unlogged. */
  notYet: number;
}

export interface MixOverTime {
  kind: BucketKind;
  buckets: MixBucket[];
  /** Single-category mode: the period's average hours per day, drawn as a line. */
  average: number | null;
}

export function bucketKind(dayCount: number): BucketKind {
  if (dayCount <= MAX_DAY_BUCKETS) return "day";
  return Math.ceil(dayCount / 7) <= MAX_WEEK_BUCKETS ? "week" : "month";
}

/**
 * Stacked average hours per day, per bucket. Averaging inside the bucket is what makes a partial
 * week or month comparable with a full one, and every bar still adds up to about 24 h.
 */
export function mixOverTime(ctx: Ctx, category: string | null = null): MixOverTime | NotEnough {
  const { analysis, settings } = ctx;
  const days = periodDays(ctx);
  const kind = bucketKind(days.all.length);
  const notInFile = new Set(days.notInFile);
  const order = category ? [category] : stackOrder(settings);
  const perDay = new Map<string, Map<string, number>>();
  for (const s of analysis.segments) {
    const key = category ? (s.category === category ? category : null) : stackKey(s.category, settings);
    if (!key) continue;
    const day = perDay.get(s.date) ?? new Map<string, number>();
    day.set(key, (day.get(key) ?? 0) + s.duration_min / 60);
    perDay.set(s.date, day);
  }
  const loggedByDate = hoursByDate(analysis.segments);  // every logged hour, not only the chosen category
  const bucketOf = (day: string) =>
    kind === "day" ? day : kind === "week" ? weekStartOf(day, settings.week_start) : startOfMonth(day);

  const buckets = new Map<string, MixBucket & { counted: number }>();
  for (const day of days.all) {
    const key = bucketOf(day);
    const bucket = buckets.get(key) ?? {
      key, days: 0, partial: false, dayOff: kind === "day" && isDayOff(day, settings),
      weekStart: kind === "day" && weekdayOf(day) === settings.week_start,
      hours: order.concat(category ? [] : [UNLOGGED]).map((k) => ({ key: k, hours: 0 })), notYet: 0, counted: 0,
    };
    bucket.days += 1;
    const length = dayLengthHours(day, settings.timezone);
    if (!notInFile.has(day)) bucket.counted += 1;
    if (notInFile.has(day)) {
      bucket.notYet += length;
      bucket.partial = true;
    } else {
      const sums = perDay.get(day);
      for (const entry of bucket.hours) entry.hours += sums?.get(entry.key) ?? 0;
      const logged = loggedByDate.get(day) ?? 0;
      if (day === days.partial) {
        bucket.notYet += Math.max(0, length - logged);
        bucket.partial = true;
      } else if (!category) {
        bucket.hours[bucket.hours.length - 1].hours += Math.max(0, length - logged);  // Unlogged
      }
    }
    buckets.set(key, bucket);
  }
  const out = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (out.length < MIN_BUCKETS_O3) return { notEnough: true, need: MIN_BUCKETS_O3, have: out.length };

  const whole = (b: MixBucket) =>
    kind === "day" ? 1 : kind === "week" ? 7 : daysBetween(b.key, endOfMonth(b.key)).length;
  let categoryHours = 0;
  let countedDays = 0;
  for (const b of out) {
    if (b.days < whole(b)) b.partial = true;  // a first or last week/month cut by the period
    categoryHours += b.hours.reduce((a, h) => a + (h.key === UNLOGGED ? 0 : h.hours), 0);
    countedDays += b.counted;
    for (const entry of b.hours) entry.hours /= b.days;
    b.notYet /= b.days;
  }
  return {
    kind, buckets: out.map(({ counted: _counted, ...b }) => b),
    average: category && countedDays ? categoryHours / countedDays : null,
  };
}

// --- O4: which projects took my time, and from where? -----------------------------------------

export interface ProjectRow {
  project: string;
  /** Block hours: a project is on the block, never on a split part, so these are not estimates. */
  hours: number;
  share: number;
  blocks: number;
  activeDays: number;
  first: string;
  last: string;
  /** Where the hours came from, in stack order; zero categories left out. */
  mix: { key: string; hours: number }[];
  /** Block hours per week (or per month on long periods) of the period, empty ones included. */
  trend: { key: string; hours: number }[];
}

/** O4's small trend: one bar per week while that is 26 bars or fewer, else one per month. */
export function projectTrendKind(dayCount: number): "week" | "month" {
  return Math.ceil(dayCount / 7) <= MAX_WEEK_BUCKETS ? "week" : "month";
}

export function projectRows(ctx: Ctx): ProjectRow[] {
  const t = totals(ctx);
  const all = periodDays(ctx).all;
  const kind = projectTrendKind(all.length);
  const bucketOf = (day: string) => (kind === "week" ? weekStartOf(day, ctx.settings.week_start) : startOfMonth(day));
  const trendKeys = [...new Set(all.map(bucketOf))];
  const rows = new Map<string, {
    hours: number; blocks: number; days: Set<string>; mix: Map<string, number>; trend: Map<string, number>;
  }>();
  for (const b of ctx.analysis.blocks) {
    for (const project of b.projects) {
      const row = rows.get(project) ?? {
        hours: 0, blocks: 0, days: new Set<string>(), mix: new Map<string, number>(), trend: new Map<string, number>(),
      };
      const hours = b.duration_min / 60;
      const key = stackKey(b.category, ctx.settings);
      const day = b.start_local.slice(0, 10);
      row.hours += hours;
      row.blocks += 1;
      row.days.add(day);
      row.mix.set(key, (row.mix.get(key) ?? 0) + hours);
      row.trend.set(bucketOf(day), (row.trend.get(bucketOf(day)) ?? 0) + hours);
      rows.set(project, row);
    }
  }
  const order = stackOrder(ctx.settings);
  return [...rows.entries()]
    .map(([project, r]) => {
      const days = [...r.days].sort();
      return {
        project, hours: r.hours, share: t.denominatorHours ? r.hours / t.denominatorHours : 0,
        blocks: r.blocks, activeDays: days.length, first: days[0], last: days[days.length - 1],
        mix: order.filter((k) => r.mix.get(k)).map((k) => ({ key: k, hours: r.mix.get(k)! })),
        trend: trendKeys.map((key) => ({ key, hours: r.trend.get(key) ?? 0 })),
      };
    })
    .sort((a, b) => b.hours - a.hours);
}

// --- R4: when do I sleep, and how regular is it? ----------------------------------------------

export const MIN_NIGHTS_R4 = 14;
/** A night runs 18:00 → 18:00, so an evening bedtime and a morning wake stay on one row. */
export const NIGHT_START_HOUR = 18;

export interface SleepBar {
  /** Hours after 18:00 on the night's date (0-24). */
  from: number;
  to: number;
  /** The night's longest stretch: bedtime and wake come from it; the rest are naps. */
  main: boolean;
}

export interface Night {
  /** The date the night starts; the row says "day off" when that date is one. */
  day: string;
  dayOff: boolean;
  /** The night runs past the period or past "data as of", so it is not counted in the medians. */
  incomplete: boolean;
  bars: SleepBar[];
}

export interface Nights {
  /** The configured category the sleep rows come from, or null when there is none. */
  category: string | null;
  nights: Night[];
  withSleep: number;
  /** Complete nights with nothing logged: listed in the caption, never interpolated. */
  empty: string[];
  medians: {
    /** Hours after 18:00; add NIGHT_START_HOUR for a clock time. */
    bedtime: number | null;
    wake: number | null;
    hours: number | null;
    bedtimeWorkday: number | null;
    bedtimeDayOff: number | null;
    wakeWorkday: number | null;
    wakeDayOff: number | null;
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The category sleep is logged under, matched by name so nothing is hardcoded in the logic. */
export function sleepCategory(ctx: Ctx): string | null {
  const names = [...Object.keys(ctx.settings.categories), ...ctx.analysis.segments.map((s) => s.category)];
  return names.find((n) => n.toUpperCase() === "SLEEP") ?? null;
}

export function sleepNights(ctx: Ctx): Nights | NotEnough {
  const { analysis, settings } = ctx;
  const category = sleepCategory(ctx);
  const days = periodDays(ctx);
  const notInFile = new Set(days.notInFile);
  const last = analysis.range.last_day;
  const bars = new Map<string, SleepBar[]>();
  for (const s of analysis.segments) {
    if (!category || s.category !== category) continue;
    const start = minutesOfDay(s.start_local) / 60;
    const evening = start >= NIGHT_START_HOUR;  // after 18:00 this night, else early on the next date
    const day = evening ? s.date : addDays(s.date, -1);
    const from = evening ? start - NIGHT_START_HOUR : start + (24 - NIGHT_START_HOUR);
    const list = bars.get(day) ?? [];
    list.push({ from, to: Math.min(24, from + s.duration_min / 60), main: false });
    bars.set(day, list);
  }
  const nights: Night[] = days.all.map((day) => {
    const merged: SleepBar[] = [];
    for (const bar of (bars.get(day) ?? []).sort((a, b) => a.from - b.from)) {
      const previous = merged[merged.length - 1];
      if (previous && bar.from - previous.to < 1 / 60) previous.to = Math.max(previous.to, bar.to);
      else merged.push({ ...bar });
    }
    const longest = merged.reduce<SleepBar | null>((a, b) => (!a || b.to - b.from > a.to - a.from ? b : a), null);
    if (longest) longest.main = true;
    return {
      day, dayOff: isDayOff(day, settings), bars: merged,
      incomplete: day >= last || notInFile.has(day) || notInFile.has(addDays(day, 1)),
    };
  });
  const counted = nights.filter((n) => !n.incomplete);
  const withSleep = nights.filter((n) => n.bars.length).length;
  if (withSleep < MIN_NIGHTS_R4) return { notEnough: true, need: MIN_NIGHTS_R4, have: withSleep };
  const mains = (list: Night[]) => list.map((n) => n.bars.find((b) => b.main)).filter((b): b is SleepBar => !!b);
  const complete = mains(counted);
  return {
    category, nights, withSleep,
    empty: counted.filter((n) => !n.bars.length).map((n) => n.day),
    medians: {
      bedtime: median(complete.map((b) => b.from)),
      wake: median(complete.map((b) => b.to)),
      hours: median(complete.map((b) => b.to - b.from)),
      bedtimeWorkday: median(mains(counted.filter((n) => !n.dayOff)).map((b) => b.from)),
      bedtimeDayOff: median(mains(counted.filter((n) => n.dayOff)).map((b) => b.from)),
      wakeWorkday: median(mains(counted.filter((n) => !n.dayOff)).map((b) => b.to)),
      wakeDayOff: median(mains(counted.filter((n) => n.dayOff)).map((b) => b.to)),
    },
  };
}

// --- R5: how did my days look across months? --------------------------------------------------

export const MIN_DAYS_R5 = 30;

export interface BarcodePart {
  key: string;
  /** Clock hours (0-24) of the local day. */
  from: number;
  to: number;
}

export interface BarcodeDay {
  day: string;
  dayOff: boolean;
  partial: boolean;
  notInFile: boolean;
  logged: number;
  parts: BarcodePart[];
}

/** One 24-hour column per day: the period at a glance, for drift and seasons, not for reading values. */
export function barcode(ctx: Ctx): BarcodeDay[] | NotEnough {
  const days = periodDays(ctx);
  if (days.all.length < MIN_DAYS_R5) return { notEnough: true, need: MIN_DAYS_R5, have: days.all.length };
  const notInFile = new Set(days.notInFile);
  const parts = new Map<string, BarcodePart[]>();
  const logged = new Map<string, number>();
  for (const s of ctx.analysis.segments) {
    const from = minutesOfDay(s.start_local) / 60;
    const list = parts.get(s.date) ?? [];
    list.push({ key: stackKey(s.category, ctx.settings), from, to: Math.min(24, from + s.duration_min / 60) });
    parts.set(s.date, list);
    logged.set(s.date, (logged.get(s.date) ?? 0) + s.duration_min / 60);
  }
  return days.all.map((day) => ({
    day, dayOff: isDayOff(day, ctx.settings), partial: day === days.partial, notInFile: notInFile.has(day),
    logged: logged.get(day) ?? 0, parts: (parts.get(day) ?? []).sort((a, b) => a.from - b.from),
  }));
}
