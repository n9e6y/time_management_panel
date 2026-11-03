// Day arithmetic on "YYYY-MM-DD" strings, and timezone helpers built on Intl (no extra library).

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every day from first to last, inclusive. */
export function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

export function weekdayOf(day: string): string {
  const [y, m, d] = parts(day);
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** Weekdays in display order, starting on the user's week_start. */
export function weekdaysFrom(weekStart: string): string[] {
  const i = Math.max(0, WEEKDAYS.indexOf(weekStart));
  return [...WEEKDAYS.slice(i), ...WEEKDAYS.slice(0, i)];
}

/** Minutes the zone is ahead of UTC at the given instant. */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const get = (type: string) => Number(fmt.formatToParts(new Date(utcMs)).find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

function localMidnightUtc(day: string, tz: string): number {
  const [y, m, d] = parts(day);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMinutes(guess, tz) * 60000;
  return guess - tzOffsetMinutes(first, tz) * 60000;
}

/** Real length of a local day: 23 or 25 hours on clock-change days. */
export function dayLengthHours(day: string, tz: string): number {
  return (localMidnightUtc(addDays(day, 1), tz) - localMidnightUtc(day, tz)) / 3_600_000;
}

/** Today's date in the given zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now);
}

/** Minutes since local midnight from a local ISO timestamp ("2025-09-02T09:30:00+03:30"). */
export function minutesOfDay(isoLocal: string): number {
  return Number(isoLocal.slice(11, 13)) * 60 + Number(isoLocal.slice(14, 16));
}

// --- months (the "vs previous period" rule for calendar presets, and O3/R5 month buckets) ------

/** First day of the month a day falls in. */
export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Shift a day by whole months, keeping the day of the month (clamped to the month's length). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = parts(day);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 8)}${String(Math.min(d, length)).padStart(2, "0")}`;
}

/** Last day of the month a day falls in. */
export function endOfMonth(day: string): string {
  return addDays(addMonths(startOfMonth(day), 1), -1);
}

/** Start of the week a day falls in, following the user's week_start. */
export function weekStartOf(day: string, weekStart: string): string {
  const names = weekdaysFrom(weekStart);
  return addDays(day, -names.indexOf(weekdayOf(day)));
}
