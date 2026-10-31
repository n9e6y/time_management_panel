import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureAnalysis, fixtureConfig, fixturePeriods } from "./test/fixture";

vi.mock("./components/Chart", () => ({ default: ({ label }: { label: string }) => <div data-testid="chart">{label}</div> }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let calls: { url: string; init?: RequestInit }[] = [];

function mockServer(overrides: Record<string, () => Promise<Response>> = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.split("?")[0];
    const key = `${init?.method ?? "GET"} ${path}`;
    if (overrides[key]) return overrides[key]();
    if (key === "GET /api/config") return json(fixtureConfig);
    if (key === "GET /api/periods") return json(fixturePeriods);
    if (key === "POST /api/analyze") return json(fixtureAnalysis);
    return json({ detail: "not found" }, 404);
  }));
}

async function upload() {
  render(<App />);
  const input = await screen.findByLabelText("Calendar file");
  fireEvent.change(input, { target: { files: [new File(["BEGIN:VCALENDAR"], "my-log.ics", { type: "text/calendar" })] } });
  await screen.findByRole("navigation", { name: "Main" });
  await screen.findByText("Where did my time go?");
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("starts on the welcome page and shows the user's week settings", async () => {
    mockServer();
    render(<App />);
    expect(await screen.findByText("See where your time goes")).toBeInTheDocument();
    expect(screen.getByText(/week starts on Saturday; days off: Friday/)).toBeInTheDocument();
  });

  it("uploads the file as the raw body and renders the Overview with the fixture totals", async () => {
    mockServer();
    await upload();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/analyze?period=1m");
    expect(post.init!.body).toBeInstanceOf(ArrayBuffer);
    const logged = screen.getByText("Logged").closest(".tile")!;
    expect(within(logged as HTMLElement).getByText(/41\.0/)).toBeInTheDocument();
    expect(screen.getAllByTestId("chart").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Weekday pattern needs each weekday at least twice/)).toBeInTheDocument();
    expect(screen.getByText(/my-log\.ics/)).toBeInTheDocument();
  });

  it("re-sends the same file when the period changes and keeps it in the URL", async () => {
    mockServer();
    await upload();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "this_week" } });
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(2));
    expect(calls.at(-1)!.url).toBe("/api/analyze?period=this_week");
    expect(window.location.search).toBe("?period=this_week");
  });

  it("lists the skipped events on Data quality", async () => {
    mockServer();
    await upload();
    fireEvent.click(screen.getByRole("button", { name: /2 issues/ }));
    expect(await screen.findByText("Birthday reminder")).toBeInTheDocument();
    expect(screen.getByText("All-day event (not a time block)")).toBeInTheDocument();
  });

  it("shows every settings problem and keeps the form", async () => {
    mockServer({ "PUT /api/config": () => json({ detail: { message: "These settings can't be saved.", problems: ["timezone: Unknown timezone: 'Mars/Base'"] } }, 422) });
    await upload();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Mars/Base" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mars/Base");
  });

  it("saves settings and re-runs the analysis with the same file", async () => {
    mockServer({ "PUT /api/config": () => json({ ...fixtureConfig, source: "config.yaml" }) });
    await upload();
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Saturday"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved. Results updated.")).toBeInTheDocument();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(JSON.parse(put.init!.body as string).days_off).toEqual(["Friday", "Saturday"]);
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(2);
  });

  it("says how to start the server when it isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/server isn't running/);
  });
});
