import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { asOfLabel } from "./components/CalendarSlot";
import { fixtureAnalysis, fixtureConfig, fixturePeriods } from "./test/fixture";
import type { CalendarInfo, CalendarState } from "./lib/types";

vi.mock("./components/Chart", () => ({ default: ({ label }: { label: string }) => <div data-testid="chart">{label}</div> }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const INFO: CalendarInfo = {
  name: "my-log.ics", size: 2048, sha256: "x".repeat(64), loaded_at: "2025-09-08T10:00:00+00:00",
  data_as_of: "2025-09-08T09:58:00+00:00", first_day: "2025-09-01", last_day: "2025-09-08", events: 10, known_share: 0.9,
};
const saved = (info: CalendarInfo | null, has_previous = false): CalendarState => ({ calendar: info, has_previous, folder: "/home/me/.time-analyzer/calendar" });

let calls: { url: string; init?: RequestInit }[] = [];

function mockServer(start: CalendarState, overrides: Record<string, () => Promise<Response>> = {}) {
  calls = [];
  let state = start;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    if (overrides[key]) return overrides[key]();
    switch (key) {
      case "GET /api/config": return json(fixtureConfig);
      case "GET /api/periods": return json(fixturePeriods);
      case "GET /api/calendar": return json(state);
      case "PUT /api/calendar": {
        const name = new URLSearchParams(url.split("?")[1]).get("name")!;
        state = saved({ ...INFO, name }, !!state.calendar);
        return json(state);
      }
      case "POST /api/calendar/check": return json({ current: state.calendar, new: { ...INFO, name: "new.ics" }, warnings: [] });
      case "POST /api/calendar/restore": state = saved(INFO, true); return json(state);
      case "DELETE /api/calendar": state = saved(null); return json(state);
      case "POST /api/analyze": return json(fixtureAnalysis);
    }
    return json({ detail: "not found" }, 404);
  }));
}

const file = (name = "my-log.ics") => new File(["BEGIN:VCALENDAR"], name, { type: "text/calendar", lastModified: Date.parse("2025-09-08T09:58:00Z") });
const posts = (path: string) => calls.filter((c) => c.init?.method === "POST" && c.url.startsWith(path));

async function returningUser(state: CalendarState = saved(INFO)) {
  mockServer(state);
  render(<App />);
  await screen.findByText("Where did my time go?");
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => vi.unstubAllGlobals());

describe("first run", () => {
  it("saves the file, asks to check the week, then opens the Overview", async () => {
    mockServer(saved(null));
    render(<App />);
    expect(await screen.findByText(/Where did your time go/)).toBeInTheDocument();
    expect(screen.getByText(/\.time-analyzer\/calendar/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Calendar file"), { target: { files: [file()] } });
    expect(await screen.findByLabelText("Week starts on")).toHaveValue("Saturday");
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/calendar?name=my-log.ics&data_as_of=2025-09-08T09%3A58%3A00.000Z");
    expect(put.init!.body).toBeInstanceOf(ArrayBuffer);

    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    await screen.findByText("Where did my time go?");
    expect(calls.some((c) => c.init?.method === "PUT" && c.url === "/api/config")).toBe(false);  // nothing changed
    const logged = screen.getByText("Logged").closest(".tile")!;
    expect(within(logged as HTMLElement).getByText(/41\.0/)).toBeInTheDocument();
  });
});

describe("returning user", () => {
  it("opens the dashboard without an upload and analyses the saved file", async () => {
    await returningUser();
    expect(screen.queryByText(/Where did your time go/)).not.toBeInTheDocument();
    expect(posts("/api/analyze")[0].init!.body).toBeUndefined();
    expect(screen.getByRole("button", { name: "Calendar file" })).toHaveTextContent("my-log.ics");
  });

  it("re-analyses the saved file when the period changes and keeps it in the URL", async () => {
    await returningUser();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "this_week" } });
    await waitFor(() => expect(posts("/api/analyze")).toHaveLength(2));
    expect(posts("/api/analyze")[1].url).toBe("/api/analyze?period=this_week");
    expect(window.location.search).toBe("?period=this_week");
  });

  it("shows the file's facts and where it is saved", async () => {
    await returningUser();
    fireEvent.click(screen.getByRole("button", { name: "Calendar file" }));
    const pop = screen.getByRole("dialog", { name: "Calendar file details" });
    expect(pop).toHaveTextContent("10 events");
    expect(pop).toHaveTextContent("1 Sep – 8 Sep 2025");
    expect(pop).toHaveTextContent("/home/me/.time-analyzer/calendar");
  });
});

describe("replace, undo and remove", () => {
  it("replaces a newer export straight away and offers Undo", async () => {
    await returningUser();
    fireEvent.change(screen.getByLabelText("Replace calendar file"), { target: { files: [file("new.ics")] } });
    expect(await screen.findByText("Loaded new.ics.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calendar file" })).toHaveTextContent("new.ics");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Calendar file" })).toHaveTextContent("my-log.ics"));
    expect(calls.some((c) => c.url === "/api/calendar/restore")).toBe(true);
  });

  it("asks first when the new file looks like a different calendar, with Cancel as the safe default", async () => {
    mockServer(saved(INFO), {
      "POST /api/calendar/check": () => json({
        current: INFO, new: { ...INFO, name: "work.ics" },
        warnings: [{ code: "few_known_categories", current: 0.9, new: 0.04 }],
      }),
    });
    render(<App />);
    await screen.findByText("Where did my time go?");
    fireEvent.change(screen.getByLabelText("Replace calendar file"), { target: { files: [file("work.ics")] } });

    const sheet = await screen.findByRole("dialog", { name: "This file looks different" });
    expect(sheet).toHaveTextContent("4% of its titles have a known category (yours: 90%)");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });

  it("removes the file after confirming and returns to the welcome page", async () => {
    await returningUser();
    fireEvent.click(screen.getByRole("button", { name: "Calendar file" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from this computer" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /Remove my-log\.ics/ })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Where did your time go/)).toBeInTheDocument();
  });
});

describe("other pages and errors", () => {
  it("lists the skipped events on Data quality", async () => {
    await returningUser();
    fireEvent.click(screen.getByRole("button", { name: /Data quality/ }));
    expect(await screen.findByText("Birthday reminder")).toBeInTheDocument();
  });

  it("shows every settings problem and keeps the form", async () => {
    mockServer(saved(INFO), { "PUT /api/config": () => json({ detail: { message: "These settings can't be saved.", problems: ["timezone: Unknown timezone: 'Mars/Base'"] } }, 422) });
    render(<App />);
    await screen.findByText("Where did my time go?");
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Mars/Base" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mars/Base");
  });

  it("saves settings and re-runs the analysis", async () => {
    mockServer(saved(INFO), { "PUT /api/config": () => json({ ...fixtureConfig, source: "config.yaml" }) });
    render(<App />);
    await screen.findByText("Where did my time go?");
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Saturday"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved. Results updated.")).toBeInTheDocument();
    expect(posts("/api/analyze")).toHaveLength(2);
  });

  it("says how to start the server when it isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/server isn't running/);
  });
});

describe("data as of", () => {
  it("is plain when fresh and marked stale after a day", () => {
    const now = new Date("2025-09-08T12:00:00Z");
    expect(asOfLabel("2025-09-08T09:58:00Z", now).stale).toBe(false);
    const old = asOfLabel("2025-09-05T09:58:00Z", now);
    expect(old.stale).toBe(true);
    expect(old.text).toMatch(/3 days ago/);
  });
});
