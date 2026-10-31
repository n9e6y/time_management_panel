// Turns an analysis into the numbers each chart shows. Pure functions; definitions follow
// c-c-k/docs/design_mock/ux/IA.md §6 and the owner decisions in §10.
import type { Analysis, Segment, Settings } from "./types";
import { dayLengthHours, daysBetween, minutesOfDay, weekdayOf, weekdaysFrom } from "./time";

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
