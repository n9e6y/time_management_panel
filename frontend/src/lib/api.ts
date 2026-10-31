// Calls to the local backend. In development Vite forwards /api to 127.0.0.1:8000.
import type {
  Analysis, CalendarCheck, CalendarState, Period, PeriodPreset, Settings, SettingsResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems: string[] = [],
  ) {
    super(message);
  }
}

export const SERVER_DOWN =
  "The Time Analyzer server isn't running. Start it with `uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000` and try again.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(SERVER_DOWN, 0);
  }
  if (res.ok) return (await res.json()) as T;
  let detail: unknown = null;
  try {
    detail = (await res.json()).detail;
  } catch {
    // not JSON: the proxy answers this way when the backend is down
  }
  if (detail && typeof detail === "object" && "problems" in detail) {
    const d = detail as { message: string; problems: string[] };
    throw new ApiError(d.message, res.status, d.problems);
  }
  if (typeof detail === "string") throw new ApiError(detail, res.status);
  throw new ApiError(res.status >= 500 ? SERVER_DOWN : `Request failed (${res.status}).`, res.status);
}

export function periodQuery(period: Period): string {
  const params: Record<string, string> = "preset" in period ? { period: period.preset } : { start: period.start, end: period.end };
  return new URLSearchParams(params).toString();
}

/** Analyse the calendar saved on this computer (no body), or a one-off file sent as the raw body. */
export function analyze(period: Period, signal?: AbortSignal, file?: ArrayBuffer): Promise<Analysis> {
  return request(`/api/analyze?${periodQuery(period)}`, {
    method: "POST",
    ...(file ? { headers: { "Content-Type": "text/calendar" }, body: file } : {}),
    signal,
  });
}

/** A file picked in the browser, with the facts the backend stores next to it. */
export interface PickedFile {
  name: string;
  bytes: ArrayBuffer;
  /** The file's modified time: close to when it was exported from Google Calendar. */
  dataAsOf: string;
}

export async function pickFile(file: File): Promise<PickedFile> {
  return { name: file.name, bytes: await file.arrayBuffer(), dataAsOf: new Date(file.lastModified).toISOString() };
}

const calendarQuery = (f: PickedFile) => new URLSearchParams({ name: f.name, data_as_of: f.dataAsOf }).toString();
const calendarBody = (f: PickedFile): RequestInit => ({ headers: { "Content-Type": "text/calendar" }, body: f.bytes });

export const getCalendar = () => request<CalendarState>("/api/calendar");
export const saveCalendar = (f: PickedFile) =>
  request<CalendarState>(`/api/calendar?${calendarQuery(f)}`, { method: "PUT", ...calendarBody(f) });
export const checkCalendar = (f: PickedFile) =>
  request<CalendarCheck>(`/api/calendar/check?${calendarQuery(f)}`, { method: "POST", ...calendarBody(f) });
export const restoreCalendar = () => request<CalendarState>("/api/calendar/restore", { method: "POST" });
export const removeCalendar = () => request<CalendarState>("/api/calendar", { method: "DELETE" });

export const getSettings = () => request<SettingsResponse>("/api/config");

export const saveSettings = (settings: Settings) =>
  request<SettingsResponse>("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

export const getPeriods = () => request<{ presets: PeriodPreset[]; default: string }>("/api/periods");
