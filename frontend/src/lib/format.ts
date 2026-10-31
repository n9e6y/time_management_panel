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

export function fmtBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
