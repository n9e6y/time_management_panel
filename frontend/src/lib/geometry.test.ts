import { describe, expect, it } from "vitest";
import { peakLabels } from "../charts/DayArea";
import { fmtDate, fmtSpan, fmtWeekdays, fmtWhen } from "./format";
import { dayAxisLabels, heatStrength, pct, spreadLabels, stackPaths, tooltipSide } from "./geometry";
import { daysBetween } from "./time";

describe("layout arithmetic", () => {
  it("writes shares as CSS percentages and never draws a negative one", () => {
    expect(pct(0.5)).toBe("50.000%");
    expect(pct(-0.2)).toBe("0.000%");
  });

  it("spreads side labels at least a gap apart and keeps them inside the chart", () => {
    const out = spreadLabels([{ key: "a", y: 100 }, { key: "b", y: 105 }, { key: "c", y: 238 }], 15, 234);
    expect(out.map((l) => l.key)).toEqual(["a", "b", "c"]);
    expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(15);
    expect(out[2].y).toBeLessThanOrEqual(234);
  });

  it("stacks area paths from the bottom, one closed path per series", () => {
    const [low, high] = stackPaths([[0.5, 0.5], [0.5, 0.25]], 100, 100);
    expect(low.startsWith("M0,50.0")).toBe(true);      // the first series tops out at 50%
    expect(high).toContain("75.0,25.0");                // the second sits on top: 0.5 + 0.25 at slot 1
    expect(high.endsWith("Z")).toBe(true);
    expect(stackPaths([])).toEqual([]);
  });

  it("scales a heat cell to its own row, and leaves near-zero cells empty", () => {
    expect(heatStrength(4, 4)).toBe(60);
    expect(heatStrength(2, 4)).toBe(34);
    expect(heatStrength(0.01, 4)).toBe(0);
  });

  it("puts a tooltip right of a column on the left of the chart, left of it on the right", () => {
    expect(tooltipSide(2, 30).transform).toBe("translateX(8px)");
    expect(tooltipSide(25, 30).transform).toContain("-100%");
  });

  it("labels day columns at week starts and on the last day, naming the month once", () => {
    const days = daysBetween("2026-09-30", "2026-10-29");
    const labels = dayAxisLabels(days, "Saturday").filter((l) => l.text);
    expect(labels.map((l) => l.text)).toEqual(["3 Oct", "10", "17", "24", "29 Oct"]);
    expect(labels[labels.length - 1].bold).toBe(true);
  });

  it("labels month starts on long periods", () => {
    const labels = dayAxisLabels(daysBetween("2025-11-15", "2026-02-10"), "Saturday").filter((l) => l.text);
    expect(labels.map((l) => l.text)).toEqual(["Nov 2025", "Dec", "Jan 2026", "Feb"]);
  });
});

describe("short date formats", () => {
  it("collapses a span to what differs", () => {
    expect(fmtSpan("2026-10-01", "2026-10-31")).toBe("1 – 31 Oct");
    expect(fmtSpan("2026-09-30", "2026-10-29")).toBe("30 Sep – 29 Oct");
    expect(fmtSpan("2026-10-24", "2026-10-30", true)).toBe("Sat 24 – Fri 30 Oct");
    expect(fmtSpan("2025-12-29", "2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(fmtDate("2026-10-03")).toBe("3 Oct");
  });

  it("lists weekdays in a sentence and writes a block's time", () => {
    expect(fmtWeekdays(["Friday"])).toBe("Fri");
    expect(fmtWeekdays(["Thursday", "Friday"])).toBe("Thu and Fri");
    expect(fmtWhen("2026-10-28T08:30:00+03:30", "2026-10-28T10:00:00+03:30")).toBe("Wed 28 Oct · 08:30–10:00");
  });
});

describe("R2's peak labels", () => {
  it("labels a band that fills 30% of days somewhere, at the middle of its peak", () => {
    const shares = (v: number[]) => v;
    const labels = peakLabels([
      { key: "SLEEP", shares: shares([1, 1, 1, 0]) },
      { key: "ME", shares: shares([0, 0, 0, 0.2]) },
    ]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ key: "SLEEP", share: 1 });
    expect(labels[0].y).toBeCloseTo(0.5);
  });
});
