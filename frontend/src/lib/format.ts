// Number and date formats from the design tokens (tokens.md §3).

const THIN = " ";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `218.5 h`; estimates get a leading `≈`. */
export function fmtHours(hours: number, estimated = false): string {
  return `${estimated ? "≈ " : ""}${hours.toFixed(1)}${THIN}h`;
}

/** `1:30` for tooltips and the drawer. */
export function fmtHM(hours: number): string {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

export function fmtPct(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** `Tue 2 Sep` */
export function fmtDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** `1 Sep – 8 Sep 2025` */
export function fmtRange(first: string, last: string): string {
  const a = new Date(`${first}T00:00:00Z`);
  const b = new Date(`${last}T00:00:00Z`);
  const left = `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${a.getUTCFullYear() !== b.getUTCFullYear() ? ` ${a.getUTCFullYear()}` : ""}`;
  return `${left} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

/**
 * A short span for headings: `1 – 31 Oct`, `30 Sep – 29 Oct`, or with weekdays `Sat 24 – Fri 30 Oct`.
 * Years appear only when the two ends are in different years.
 */
export function fmtSpan(first: string, last: string, weekdays = false): string {
  const a = new Date(`${first}T00:00:00Z`);
  const b = new Date(`${last}T00:00:00Z`);
  const wd = (d: Date) => (weekdays ? `${DAYS[d.getUTCDay()]} ` : "");
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const right = `${wd(b)}${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}${sameYear ? "" : ` ${b.getUTCFullYear()}`}`;
  if (first === last) return right;
  if (sameYear && a.getUTCMonth() === b.getUTCMonth()) return `${wd(a)}${a.getUTCDate()} – ${right}`;
  const left = `${wd(a)}${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? "" : ` ${a.getUTCFullYear()}`}`;
  return `${left} – ${right}`;
}

/** `3 Oct`: a date without its weekday, for axis labels. */
export function fmtDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** `Oct`, or `Jan 2026` when the year needs saying. */
export function fmtMonth(day: string, withYear = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** `Wed 28 Oct · 08:30–10:00`, the drawer's line for one block. */
export function fmtWhen(startLocal: string, endLocal: string): string {
  return `${fmtDay(startLocal.slice(0, 10))} · ${startLocal.slice(11, 16)}–${endLocal.slice(11, 16)}`;
}

/** `Fri`, `Thu and Fri`, `Sat, Sun and Mon`: short weekday names in a sentence. */
export function fmtWeekdays(names: string[]): string {
  const short = names.map((n) => n.slice(0, 3));
  return short.length <= 1 ? (short[0] ?? "") : `${short.slice(0, -1).join(", ")} and ${short[short.length - 1]}`;
}

export function fmtBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `23:30` from decimal hours; wraps past midnight (25.5 -> `01:30`). */
export function fmtClock(hours: number): string {
  const minutes = Math.round(((hours % 24) + 24) % 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** `+6.5 h` / `−2.0 h`, with a real minus sign. */
export function fmtSigned(hours: number): string {
  return `${hours < 0 ? "−" : "+"}${Math.abs(hours).toFixed(1)}${THIN}h`;
}
