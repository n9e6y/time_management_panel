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

const GOALS_PATH = "/home/me/.time-analyzer/goals.yaml";
const CORRECTIONS_PATH = "/home/me/.time-analyzer/corrections.yaml";
let calls: { url: string; init?: RequestInit }[] = [];
let goalList: unknown[] = [];
let correctionList: unknown[] = [];

function mockServer(start: CalendarState, overrides: Record<string, () => Promise<Response>> = {}) {
  calls = [];
  goalList = [];
  correctionList = [];
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
      case "GET /api/goals": return json({ goals: goalList, path: GOALS_PATH });
      case "GET /api/corrections": return json({ corrections: correctionList, path: CORRECTIONS_PATH });
      case "PUT /api/corrections": {
        correctionList = JSON.parse(init!.body as string).corrections;
        return json({ corrections: correctionList, path: CORRECTIONS_PATH });
      }
      case "PUT /api/goals": return json({ goals: goalList, path: GOALS_PATH });
      case "GET /api/goals/progress":
        return json({ goals: [], as_of: "2025-09-08", today: "2025-09-08", path: GOALS_PATH });
    }
    return json({ detail: "not found" }, 404);
  }));
}

const file = (name = "my-log.ics") => new File(["BEGIN:VCALENDAR"], name, { type: "text/calendar", lastModified: Date.parse("2025-09-08T09:58:00Z") });
const posts = (path: string) => calls.filter((c) => c.init?.method === "POST" && c.url.startsWith(path));

async function returningUser(state: CalendarState = saved(INFO)) {
  mockServer(state);
  render(<App />);
  await screen.findByText("Where did my time go, and what grew or shrank?");
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
    await screen.findByText("Where did my time go, and what grew or shrank?");
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
    await screen.findByText("Where did my time go, and what grew or shrank?");
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
    await screen.findByText("Where did my time go, and what grew or shrank?");
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Mars/Base" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mars/Base");
  });

  it("saves settings and re-runs the analysis", async () => {
    mockServer(saved(INFO), { "PUT /api/config": () => json({ ...fixtureConfig, source: "config.yaml" }) });
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");
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

describe("pages in the URL (Stage 3.5 Part B)", () => {
  it("opens Rhythm from the nav, puts it in the path and comes back with Back", async () => {
    await returningUser();

    fireEvent.click(screen.getByRole("button", { name: "Rhythm" }));

    expect(await screen.findByText("When do I sleep, and how regular is it?")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/rhythm");

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/overview"));
    expect(await screen.findByText("Where did my time go, and what grew or shrank?")).toBeInTheDocument();
  });

  it("opens straight into Rhythm when the URL says so, keeping the period", async () => {
    window.history.replaceState(null, "", "/rhythm?period=1w");
    mockServer(saved(INFO));
    render(<App />);

    expect(await screen.findByText("What does an average day look like, and do my days off differ?")).toBeInTheDocument();
    expect(posts("/api/analyze")[0].url).toContain("period=1w");
  });

  it("frames the charts the period is too short for, with their reasons", async () => {
    window.history.replaceState(null, "", "/rhythm");
    mockServer(saved(INFO));
    render(<App />);
    await screen.findByText("When do I sleep, and how regular is it?");

    expect(screen.getByText(/needs 14 nights with sleep/)).toBeInTheDocument();
    expect(screen.getByText(/life barcode needs 30 days or more/)).toBeInTheDocument();
    expect(screen.getByText(/each weekday at least twice/)).toBeInTheDocument();
  });
});

describe("the previous period (Stage 3.5 Part B)", () => {
  /** The fixture's calendar starts on the period's first day, so nothing is comparable by default. */
  const reachingBack = () => json({
    ...fixtureAnalysis, calendar: { first_day: "2025-01-01", last_day: "2025-09-08" },
  });

  it("asks for the equal-length period before this one and shows it on the tiles", async () => {
    mockServer(saved(INFO), { "POST /api/analyze": reachingBack });
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");

    await waitFor(() => expect(posts("/api/analyze")).toHaveLength(2));
    expect(posts("/api/analyze")[1].url).toBe("/api/analyze?start=2025-08-24&end=2025-08-31");
    expect(screen.getAllByText(/^prev\./).length).toBeGreaterThan(0);
  });

  it("explains in O1's caption when the calendar does not reach back", async () => {
    await returningUser();

    expect(posts("/api/analyze")).toHaveLength(1);  // nothing to compare: no second call
    expect(screen.getByText(/No previous period: your calendar starts on Mon 1 Sep/)).toBeInTheDocument();
  });
});

describe("goals (Stage 4)", () => {
  const WEEKLY = {
    id: "learn", scope: "LEARN", every: "week", type: "floor", hours: 10, tolerance: 0.1, label: "≥ 10 h",
    first_day: "2025-09-06", last_day: "2025-09-12", running: true, elapsed: 3 / 7, actual: 2, estimated: 0,
    blocks: 1, coverage: 0.8, low_coverage: false, status: "behind", expected: 4.29, expected_min: null,
    expected_max: null, gap: 8, projected: 4.67,
  };

  const withGoals = (goals: unknown[]) => ({
    "GET /api/goals/progress": () =>
      json({ goals, as_of: "2025-09-08", today: "2025-09-08", path: GOALS_PATH }),
  });

  it("invites the first goal when there are none", async () => {
    await returningUser();

    expect(screen.getByText("Is my time going where I want?")).toBeInTheDocument();
    expect(screen.getByText(/No goals yet\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a goal" })).toBeInTheDocument();
  });

  it("shows a goal's progress, its status and what it would take", async () => {
    mockServer(saved(INFO), withGoals([WEEKLY]));
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");

    expect(await screen.findByText("0 of 1 goals on pace · 1 behind.")).toBeInTheDocument();
    const card = screen.getByLabelText("Is my time going where I want?");
    expect(within(card).getByText("LEARN")).toBeInTheDocument();
    expect(within(card).getByText("≥ 10 h")).toBeInTheDocument();
    expect(within(card).getByText("Behind pace")).toBeInTheDocument();
    expect(within(card).getByText(/needs 8.0.h more by Fri 12 Sep/)).toBeInTheDocument();
    expect(within(card).getByText(/as of Mon 8 Sep/)).toBeInTheDocument();
  });

  it("opens the blocks behind a goal", async () => {
    mockServer(saved(INFO), withGoals([WEEKLY]));
    render(<App />);
    const card = await screen.findByLabelText("Is my time going where I want?");

    fireEvent.click(within(card).getByRole("button", { name: /2.0.h/ }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText(/Blocks counting toward LEARN/)).toBeInTheDocument();
    expect(within(drawer).getByText(/calculus ch.4/)).toBeInTheDocument();
  });

  it("says a fixed goal is never judged on hours", async () => {
    mockServer(saved(INFO), withGoals([{
      ...WEEKLY, id: "class", scope: "CLASS", type: "fixed", hours: null, label: "fixed", status: "logged",
      actual: 17, blocks: 9, gap: 0, expected: null, projected: null,
    }]));
    render(<App />);
    const card = await screen.findByLabelText("Is my time going where I want?");

    expect(within(card).getByText("Logged")).toBeInTheDocument();
    expect(within(card).getByText(/17.0.h in 9 blocks · not judged on hours/)).toBeInTheDocument();
  });

  it("adds a goal from Settings and sends it to the backend", async () => {
    await returningUser();
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    await screen.findByText("Settings");

    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goals" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT" && c.url === "/api/goals")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT" && c.url === "/api/goals")!;
    expect(JSON.parse(put.init!.body as string)).toEqual({
      goals: [{ id: "sleep-week", scope: "SLEEP", every: "week", type: "floor", hours: 12 }],
    });
  });

  it("lists every problem when goals can't be saved, and keeps the form", async () => {
    mockServer(saved(INFO), {
      "PUT /api/goals": () => json({ detail: { message: "These goals can't be saved.", problems: ["goals[0].hours: expected a number of hours >= 0, got -1"] } }, 422),
    });
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    await screen.findByText("Settings");
    fireEvent.click(screen.getByRole("button", { name: "Add a goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save goals" }));

    expect(await screen.findByText(/expected a number of hours/)).toBeInTheDocument();
    expect(screen.getByLabelText("Hours")).toBeInTheDocument();
  });

  it("re-reads goals after settings change, since week_start changes how they are judged", async () => {
    mockServer(saved(INFO), { "PUT /api/config": () => json({ ...fixtureConfig, source: "config.yaml" }) });
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");
    const before = calls.filter((c) => c.url === "/api/goals/progress").length;

    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Saturday"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.filter((c) => c.url === "/api/goals/progress").length).toBeGreaterThan(before));
  });
});

describe("when a startup request fails", () => {
  /** The page must say what went wrong; a stuck "Connecting…" hides the reason. */
  it("shows the reason instead of staying on 'Connecting'", async () => {
    mockServer(saved(INFO), { "GET /api/calendar": () => json({ detail: "Not found." }, 404) });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Not found.");
    expect(screen.queryByText(/Connecting to the Time Analyzer server/)).not.toBeInTheDocument();
  });

  it("says how to start the server when no request gets through", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't running/);
  });
});

describe("fixing a title from Data quality", () => {
  /** The fixture calendar is clean, so give the page an analysis that has the issues we want to fix. */
  function flagged() {
    const analysis = structuredClone(fixtureAnalysis);
    const [gym, tagged] = analysis.blocks;
    Object.assign(gym, { uid: "gym-1", title: "GYM: legs", category: "GYM", task: "legs", tags: [] });
    Object.assign(tagged, { uid: "rust-1", title: "LEARN: rust #async-io", category: "LEARN", task: "rust",
      tags: ["async-io"] });
    analysis.report.title_issues = {
      unknown_category: [{ block_id: gym.block_id, title: gym.title, start_local: gym.start_local,
        issues: ["unknown_category"] }],
      unknown_tag: [{ block_id: tagged.block_id, title: tagged.title, start_local: tagged.start_local,
        issues: ["unknown_tag"] }],
    };
    return analysis;
  }

  const openQuality = async (overrides: Record<string, () => Promise<Response>> = {}) => {
    mockServer(saved(INFO), { "POST /api/analyze": () => json(flagged()), ...overrides });
    render(<App />);
    await screen.findByText("Where did my time go, and what grew or shrank?");
    fireEvent.click(screen.getByRole("button", { name: /Data quality/ }));
    return screen.findByText("Which titles need fixing?");
  };

  it("corrects one event's title", async () => {
    await openQuality();

    fireEvent.click(screen.getAllByRole("button", { name: "Fix title…" })[0]);
    const field = screen.getByLabelText("Corrected title");
    fireEvent.change(field, { target: { value: "ME: gym legs" } });
    fireEvent.click(screen.getByRole("button", { name: "This event" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/corrections" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/corrections" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.corrections).toEqual([{ title: "ME: gym legs", uid: "gym-1" }]);
  });

  it("corrects every event written the same way", async () => {
    await openQuality();

    fireEvent.click(screen.getAllByRole("button", { name: "Fix title…" })[0]);
    fireEvent.change(screen.getByLabelText("Corrected title"), { target: { value: "ME: gym legs" } });
    fireEvent.click(screen.getByRole("button", { name: /written this way/ }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/corrections" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/corrections" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.corrections[0].match_title).toBe("GYM: legs");
    expect(sent.corrections[0].uid).toBeUndefined();
  });

  it("re-reads the analysis once a correction is saved, so the page updates", async () => {
    await openQuality();
    const before = posts("/api/analyze").length;

    fireEvent.click(screen.getAllByRole("button", { name: "Fix title…" })[0]);
    fireEvent.change(screen.getByLabelText("Corrected title"), { target: { value: "ME: x" } });
    fireEvent.click(screen.getByRole("button", { name: "This event" }));

    await waitFor(() => expect(posts("/api/analyze").length).toBeGreaterThan(before));
  });

  it("adds an unknown category to the list with one click", async () => {
    await openQuality();

    fireEvent.click(screen.getByRole("button", { name: "Add GYM" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/config" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/config" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.categories.GYM).toEqual({ focus: false, color: expect.any(Number) });
  });

  it("maps a mistyped category onto a real one with one click", async () => {
    await openQuality();

    fireEvent.change(screen.getByLabelText("Map GYM to a category"), { target: { value: "ME" } });

    await waitFor(() => expect(calls.some((c) => c.url === "/api/config" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/config" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.legacy_categories.GYM).toEqual({ map_to: "ME", add_tags: [] });
  });

  it("adds an unknown tag to the known ones with one click", async () => {
    await openQuality();

    fireEvent.click(screen.getByRole("button", { name: /Add #async-io/ }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/config" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/config" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.tags.known).toContain("async-io");
  });

  it("lists the corrections in use and undoes one", async () => {
    await openQuality({
      "GET /api/corrections": () => json({
        corrections: [{ title: "ME: gym legs", match_title: "GYM: legs" }], path: CORRECTIONS_PATH,
      }),
    });
    const card = await screen.findByLabelText("Titles you have corrected");

    expect(within(card).getByText("GYM: legs")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/corrections" && c.init?.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.url === "/api/corrections" && c.init?.method === "PUT")!.init!.body as string);
    expect(sent.corrections).toEqual([]);
  });
});
