// The one-line answer under each chart title (tokens.md §10, `--fs-lede`): the chart's own numbers
// in a sentence. Pure and tested, so the words can never drift from the picture.
import {
  NIGHT_START_HOUR, OTHER, UNLOGGED, type AverageDayRow, type BarcodeDay, type CategoryRow, type DayProbability,
  type MixOverTime, type Nights, type ProjectRow, type SubcategoryRow, type WeekdayHeatmap,
} from "./aggregate";
import { SLOT_MINUTES } from "./aggregate";
import { fmtClock, fmtDay, fmtHours, fmtPct, fmtSigned } from "./format";

const real = <T extends { key: string }>(rows: T[]): T[] => rows.filter((r) => r.key !== UNLOGGED);

function largest<T>(rows: T[], by: (r: T) => number): T | null {
  return rows.reduce<T | null>((best, r) => (!best || by(r) > by(best) ? r : best), null);
}

export function o1Takeaway(rows: CategoryRow[], comparable: boolean): string {
  const top = largest(real(rows), (r) => r.hours);
  if (!top || top.hours === 0) return "Nothing is logged in this period.";
  const first = `${top.label} took the most time: ${fmtHours(top.hours)} (${fmtPct(top.share, 0)} of the period).`;
  if (!comparable) return first;
  const moved = real(rows).filter((r) => r.delta !== undefined && Math.abs(r.delta) >= 0.05);
  const up = largest(moved, (r) => r.delta!);
  const down = largest(moved, (r) => -r.delta!);
  if (!up || !down || up.delta! <= 0) return `${first} Nothing grew against the period before.`;
  const fell = down.delta! < 0 ? ` and ${down.label} fell most (${fmtSigned(down.delta!)})` : "";
  return `${first} ${up.label} grew most (${fmtSigned(up.delta!)})${fell}.`;
}

export function o2Takeaway(rows: SubcategoryRow[], category: string): string {
  const total = rows.reduce((a, r) => a + r.hours, 0);
  if (!rows.length || total === 0) return `Nothing is logged under ${category} in this period.`;
  const [top] = rows;
  if (rows.length === 1) return `All of ${category} was ${top.label} (${fmtHours(top.hours, top.estimated)}).`;
  return `${top.label} was the biggest part of ${category}: ${fmtHours(top.hours, top.estimated)} of ${fmtHours(total)}.`;
}

const BUCKET_WORD: Record<MixOverTime["kind"], [string, string]> = {
  day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"],
};

export function o3Takeaway(mix: MixOverTime, category: string | null): string {
  const [one, many] = BUCKET_WORD[mix.kind];
  const count = mix.buckets.length;
  if (category) {
    const top = largest(mix.buckets, (b) => b.hours[0].hours);
    const average = mix.average ?? 0;
    if (mix.kind === "day") {
      return `${category} averaged ${fmtHours(average)} a day across ${count} days; the most was `
        + `${fmtHours(top!.hours[0].hours)} on ${fmtDay(top!.key)}.`;
    }
    return `${category} averaged ${fmtHours(average)} a day across ${count} ${many}, most in the ${one} of `
      + `${fmtDay(top!.key)} (${fmtHours(top!.hours[0].hours)} a day).`;
  }
  const whole = mix.buckets.filter((b) => !b.partial);
  if (whole.length < 2) return `One bar per ${one}: ${count} ${many} of this period, each adding up to a full day.`;
  const [first, last] = [whole[0], whole[whole.length - 1]];
  const changes = real(first.hours)
    .map((h) => ({ key: h.key, change: (last.hours.find((x) => x.key === h.key)?.hours ?? 0) - h.hours }))
    .filter((c) => c.key !== OTHER);
  const up = largest(changes, (c) => Math.abs(c.change));
  if (!up || Math.abs(up.change) < 0.1) {
    return `Your mix held steady across ${whole.length} whole ${many}.`;
  }
  const verb = up.change > 0 ? "rose" : "fell";
  return `From the first whole ${one} to the last, ${up.key} ${verb} the most: ${fmtSigned(up.change)} a day.`;
}

/** `+exam took 38.5 h, 5.5% of your time, on 17 days; most of it came from LEARN.` (the largest project) */
export function o4Takeaway(rows: ProjectRow[]): string {
  if (!rows.length) return "No +project tags in this period.";
  const [top] = rows;
  const parts = [...top.mix].sort((a, b) => b.hours - a.hours);
  const from = parts.length === 1 ? `all of it came from ${parts[0].key}`
    : parts[0].hours / top.hours >= 0.5 ? `most of it came from ${parts[0].key}`
      : `it came from ${listWords(parts.slice(0, 3).map((p) => p.key))}`;
  return `+${top.project} took ${fmtHours(top.hours)}, ${fmtPct(top.share, 1)} of your time, on `
    + `${top.activeDays} ${top.activeDays === 1 ? "day" : "days"}; ${from}.`;
}

function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** O4's words under a project's mix bar: `mostly LEARN, some CLASS`, or the categories in order. */
export function mixWords(mix: { key: string; hours: number }[]): string {
  const parts = [...mix].sort((a, b) => b.hours - a.hours);
  const total = parts.reduce((a, p) => a + p.hours, 0);
  if (parts.length <= 1 || !total) return parts[0]?.key ?? "";
  if (parts[0].hours / total >= 0.7) return `mostly ${parts[0].key}, some ${listWords(parts.slice(1, 3).map((p) => p.key))}`;
  const named = parts.slice(0, 3).map((p) => p.key).join(", ");
  return parts.length > 3 ? `${named} +${parts.length - 3} more` : named;
}

/** R1's second sentence: the next-biggest difference between days off and workdays. */
export function r1Second(rows: AverageDayRow[]): string {
  const workday = rows.find((r) => r.type === "Workday");
  const dayOff = rows.find((r) => r.type === "Day off");
  if (!workday?.days || !dayOff?.days) return "";
  const diffs = real(workday.hours)
    .map((h) => ({ key: h.key, work: h.hours, off: dayOff.hours.find((x) => x.key === h.key)?.hours ?? 0 }))
    .sort((a, b) => Math.abs(b.off - b.work) - Math.abs(a.off - a.work));
  const next = diffs[1];
  if (!next || Math.abs(next.off - next.work) < 0.1) return "";
  return `${next.key} ${next.off > next.work ? "rises" : "falls"} from ${fmtHours(next.work)} to ${fmtHours(next.off)}.`;
}

export function r1Takeaway(rows: AverageDayRow[]): string {
  const workday = rows.find((r) => r.type === "Workday");
  const dayOff = rows.find((r) => r.type === "Day off");
  const all = rows.find((r) => r.type === "All days");
  if (workday?.days && dayOff?.days) {
    const diffs = real(workday.hours).map((h) => ({
      key: h.key, work: h.hours, off: dayOff.hours.find((x) => x.key === h.key)?.hours ?? 0,
    }));
    const top = largest(diffs, (d) => Math.abs(d.off - d.work));
    if (top && Math.abs(top.off - top.work) >= 0.1) {
      return `Your days off differ most in ${top.key}: ${fmtHours(top.off)} against ${fmtHours(top.work)} on a workday.`;
    }
    return "Your days off look much like your workdays.";
  }
  const top = largest(real(all?.hours ?? []), (h) => h.hours);
  if (!all?.days || !top) return "No full days in this period yet.";
  return `An average day holds ${fmtHours(top.hours)} of ${top.key}, over ${all.days} days.`;
}

export function r2Takeaway(data: DayProbability): string {
  let best = { key: "", share: 0, slot: 0 };
  for (const s of real(data.series)) {
    s.shares.forEach((share, slot) => { if (share > best.share) best = { key: s.key, share, slot }; });
  }
  if (!best.key) return "Nothing is logged in this period.";
  return `${best.key} is your most predictable hour: around ${fmtClock((best.slot * SLOT_MINUTES) / 60)} `
    + `it fills ${fmtPct(best.share, 0)} of days.`;
}

export function r3Takeaway(data: WeekdayHeatmap): string {
  let best = { key: "", day: "", hours: 0 };
  for (const row of real(data.rows)) {
    row.hours.forEach((hours, i) => { if (hours > best.hours) best = { key: row.key, day: data.weekdays[i].name, hours }; });
  }
  if (!best.key) return "Nothing is logged in this period.";
  return `${best.day}s carry the most ${best.key}: ${fmtHours(best.hours)} on an average ${best.day}.`;
}

export function r4Takeaway(data: Nights): string {
  const { bedtime, wake, hours, bedtimeWorkday, bedtimeDayOff } = data.medians;
  if (bedtime === null || wake === null || hours === null) return "No complete nights in this period.";
  const base = `Median bedtime ${fmtClock(NIGHT_START_HOUR + bedtime)}, median wake `
    + `${fmtClock(NIGHT_START_HOUR + wake)}, median sleep ${fmtHours(hours)} over ${data.withSleep} nights.`;
  if (bedtimeWorkday === null || bedtimeDayOff === null) return base;
  const shift = bedtimeDayOff - bedtimeWorkday;
  if (Math.abs(shift) < 0.25) return `${base} Days off barely shift it.`;
  const by = Math.abs(shift) < 1.5 ? `${Math.round(Math.abs(shift) * 60)} min` : fmtHours(Math.abs(shift));
  return `${base} On days off you go to bed ${by} ${shift > 0 ? "later" : "earlier"}.`;
}

export function r5Takeaway(days: BarcodeDay[]): string {
  const counted = days.filter((d) => !d.notInFile && !d.partial);
  const top = largest(counted, (d) => d.logged);
  if (!top) return `${days.length} days at a glance.`;
  const average = counted.reduce((a, d) => a + d.logged, 0) / counted.length;
  return `${days.length} days at a glance: ${fmtHours(average)} logged on an average day, most on `
    + `${fmtDay(top.day)} (${fmtHours(top.logged)}).`;
}
