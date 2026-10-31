import { describe, expect, it } from "vitest";
import { fixtureCtx } from "../test/fixture";
import {
  averageDay, categoryRows, coverage, coverageShare, dayProbability, groupOf, periodDays, subcategoryRows, totals,
  weekdayHeatmap, UNLOGGED,
} from "./aggregate";

const hoursOf = (rows: { key: string; hours: number }[], key: string) => rows.find((r) => r.key === key)!.hours;

describe("days and totals", () => {
  it("leaves today out while it is in progress", () => {
    const days = periodDays(fixtureCtx());
    expect(days.all).toHaveLength(8);
    expect(days.full).toHaveLength(7);
    expect(days.todayInProgress).toBe(true);
  });

  it("matches the backend's 41.0 h and counts unlogged time per day", () => {
    const t = totals(fixtureCtx());
    expect(t.loggedHours).toBe(41);
    expect(t.denominatorHours).toBe(7 * 24);
    expect(t.unloggedHours).toBe(127);
    expect(t.avgPerDay).toBeCloseTo(41 / 7);
    expect([t.focusSessions, t.blocks, t.skipped, t.issues]).toEqual([3, 10, 2, 2]);
  });
});

describe("not in this file", () => {
  it("treats the export day as partial and later days as not in the file, never as unlogged", () => {
    const ctx = { ...fixtureCtx(), today: "2025-09-10", dataAsOf: "2025-09-06" };
    ctx.analysis.range.last_day = "2025-09-10";
    const days = periodDays(ctx);
    expect(days.full).toEqual(["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05"]);
    expect(days.partial).toBe("2025-09-06");
    expect(days.notInFile).toEqual(["2025-09-07", "2025-09-08", "2025-09-09", "2025-09-10"]);
    const t = totals(ctx);
    expect(t.denominatorHours).toBe(5 * 24 + 8);  // 5 full days + 8 h logged on the export day
    expect(t.unloggedHours).toBe(5 * 24 - 32);   // full days only: 3 + 11 + 8.5 + 1.5 + 8 = 32 h logged
    const cells = coverage(ctx);
    expect(cells.find((c) => c.day === "2025-09-08")!.notInFile).toBe(true);
    expect(cells.find((c) => c.day === "2025-09-06")!.partial).toBe(true);
  });

  it("an export from today changes nothing", () => {
    expect(periodDays({ ...fixtureCtx(), dataAsOf: "2025-09-08" })).toEqual(periodDays(fixtureCtx()));
  });
});

describe("O1 categories", () => {
  it("lists configured categories in config order, 0 h included, then Unlogged", () => {
    const rows = categoryRows(fixtureCtx());
    expect(rows.map((r) => r.label)).toEqual(["SLEEP", "JOB", "CLASS", "LEARN", "RESEARCH", "SOCIAL", "ME", UNLOGGED]);
    expect(rows.map((r) => r.hours)).toEqual([31, 0, 2, 2, 1.5, 2, 2.5, 127]);
    expect(rows[0].share).toBeCloseTo(31 / 168);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
  });

  it("keeps legacy, unknown and uncategorized time as separate rows", () => {
    const ctx = fixtureCtx();
    ctx.analysis.segments[0].category = "URGENT";
    ctx.analysis.segments[1].category = "GYM";
    ctx.analysis.segments[2].category = "UNCATEGORIZED";
    const kinds = categoryRows(ctx).filter((r) => r.kind !== "category").map((r) => r.kind).sort();
    expect(kinds).toEqual(["legacy", "uncategorized", "unknown"]);
    expect(groupOf("GYM", ctx.settings).slot).toBeNull();
  });
});

describe("O2 sub-categories", () => {
  it("ranks sub-categories and marks split hours as estimates", () => {
    const ctx = fixtureCtx();
    expect(subcategoryRows(ctx, "SLEEP").map((r) => [r.label, r.hours, r.estimated])).toEqual([
      ["night", 24, false], ["night late", 7, false]]);
    const lunch = ctx.analysis.blocks.find((b) => b.task === "lunch")!;
    lunch.subcategories = ["lunch", "news"];
    expect(subcategoryRows(ctx, "ME").find((r) => r.label === "lunch")!.estimated).toBe(true);
  });
});

describe("O3 average day", () => {
  it("divides by calendar days by default and by logged days on request", () => {
    const [all, work, off] = averageDay(fixtureCtx(), "calendar");
    expect([all.days, work.days, off.days]).toEqual([7, 6, 1]);  // Friday 5 Sep is the day off
    expect(hoursOf(all.hours, "SLEEP")).toBeCloseTo(31 / 7);
    expect(hoursOf(off.hours, "SLEEP")).toBe(8);
    expect(all.hours.reduce((a, h) => a + h.hours, 0)).toBeCloseTo(24);
    expect(averageDay(fixtureCtx(), "logged")[0].days).toBe(7);  // every full day has something logged
  });
});

describe("O4 time of day", () => {
  it("needs 7 days of the chosen type", () => {
    expect(dayProbability(fixtureCtx(), "Day off")).toEqual({ notEnough: true, need: 7, have: 1 });
  });

  it("gives each 15-minute slot shares that add up to 1", () => {
    const result = dayProbability(fixtureCtx(), "All days");
    if ("notEnough" in result) throw new Error("expected data");
    const sleep = result.series.find((s) => s.key === "SLEEP")!.shares;
    expect(sleep[3 * 4]).toBeCloseTo(4 / 7);  // 03:00: asleep on 4 of the 7 nights
    for (let slot = 0; slot < 96; slot++) {
      expect(result.series.reduce((a, s) => a + s.shares[slot], 0)).toBeCloseTo(1);
    }
  });
});

describe("O5 weekday heatmap", () => {
  it("needs each weekday at least twice", () => {
    expect(weekdayHeatmap(fixtureCtx())).toEqual({ notEnough: true, need: 14, have: 7 });
  });

  it("starts columns on week_start and averages per weekday", () => {
    const ctx = fixtureCtx();
    ctx.analysis.range.first_day = "2025-08-25";  // 14 full days
    const result = weekdayHeatmap(ctx);
    if ("notEnough" in result) throw new Error("expected data");
    expect(result.weekdays.map((w) => w.name)[0]).toBe("Saturday");
    expect(result.weekdays.find((w) => w.name === "Friday")!.dayOff).toBe(true);
    const sleep = result.rows.find((r) => r.key === "SLEEP")!.hours;
    expect(sleep[result.weekdays.findIndex((w) => w.name === "Friday")]).toBe(4);  // 8 h over 2 Fridays
  });
});

describe("D1 coverage", () => {
  it("shows every day with its logged share and marks today", () => {
    const days = coverage(fixtureCtx());
    expect(days.find((d) => d.day === "2025-09-02")!.share).toBeCloseTo(11 / 24);
    expect(days.find((d) => d.day === "2025-09-08")!.today).toBe(true);
    expect(coverageShare(fixtureCtx())).toBeCloseTo(41 / 168);
  });
});
