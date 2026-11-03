import { describe, expect, it } from "vitest";
import { fixtureCtx, syntheticCtx } from "../test/fixture";
import {
  averageDay, barcode, categoryRows, dayProbability, mixOverTime, projectRows, sleepNights, subcategoryRows, totals,
  weekdayHeatmap, withDeltas,
} from "./aggregate";
import {
  o1Takeaway, o2Takeaway, o3Takeaway, o4Takeaway, r1Takeaway, r2Takeaway, r3Takeaway, r4Takeaway, r5Takeaway,
} from "./takeaway";

const long = () => syntheticCtx("2026-09-01", "2026-10-15");
/** Hours carry a thin space (tokens.md §3); these tests compare the words with ordinary spaces. */
const plain = (line: string) => line.replace(/\u2009/g, " ");

describe("takeaway lines", () => {
  it("O1 names the biggest category, and what moved when there is a previous period", () => {
    const rows = categoryRows(fixtureCtx());

    expect(plain(o1Takeaway(rows, false))).toBe("SLEEP took the most time: 31.0 h (18% of the period).");

    const previous = rows.map((r) => (r.key === "LEARN" ? { ...r, hours: r.hours + 5 } : { ...r, hours: 0 }));
    const line = plain(o1Takeaway(withDeltas(rows, previous), true));
    expect(line).toContain("SLEEP grew most (+31.0 h)");
    expect(line).toContain("LEARN fell most (−5.0 h)");
  });

  it("O1 says so when nothing grew", () => {
    const rows = categoryRows(fixtureCtx());

    expect(plain(o1Takeaway(withDeltas(rows, rows), true)))
      .toBe("SLEEP took the most time: 31.0 h (18% of the period). Nothing grew against the period before.");
  });

  it("O2 names the biggest part of the chosen category", () => {
    const ctx = fixtureCtx();

    expect(plain(o2Takeaway(subcategoryRows(ctx, "SLEEP"), "SLEEP"))).toContain("of SLEEP");
    expect(plain(o2Takeaway([], "JOB"))).toBe("Nothing is logged under JOB in this period.");
  });

  it("O3 compares the first whole bucket with the last", () => {
    const ctx = long();
    ctx.analysis.segments = ctx.analysis.segments.filter((s) => !(s.category === "LEARN" && s.date > "2026-09-20"));
    const mix = mixOverTime(ctx);
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(plain(o3Takeaway(mix, null)))
      .toBe("From the first whole week to the last, LEARN fell the most: −2.0 h a day.");
  });

  it("O3 in single-category mode reports the average and the best bucket", () => {
    const mix = mixOverTime(long(), "LEARN");
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(plain(o3Takeaway(mix, "LEARN"))).toContain("LEARN averaged 2.0 h a day across");
  });

  it("O4 totals the projects and names the largest", () => {
    const ctx = long();

    expect(plain(o4Takeaway(projectRows(ctx), totals(ctx)))).toContain("+exam-prep was the largest at 90.0 h");
    expect(plain(o4Takeaway([], totals(ctx)))).toBe("No +project tags in this period.");
  });

  it("R1 names the category days off differ in most", () => {
    expect(plain(r1Takeaway(averageDay(long(), "calendar"))))
      .toBe("Your days off differ most in CLASS: 0.0 h against 3.0 h on a workday.");
  });

  it("R2 names the most predictable hour", () => {
    const data = dayProbability(long(), "All days");
    if ("notEnough" in data) throw new Error("expected shares");

    expect(plain(r2Takeaway(data))).toMatch(/is your most predictable hour: around \d\d:\d\d it fills \d+% of days\./);
  });

  it("R3 names the weekday that carries the most of something", () => {
    const data = weekdayHeatmap(long());
    if ("notEnough" in data) throw new Error("expected a heatmap");

    expect(plain(r3Takeaway(data))).toMatch(/^\w+s carry the most \w+: \d+\.\d h on an average \w+\.$/);
  });

  it("R4 reports the medians and the days-off shift", () => {
    const data = sleepNights(long());
    if ("notEnough" in data) throw new Error("expected nights");

    expect(plain(r4Takeaway(data))).toBe(
      "Median bedtime 23:30, median wake 07:30, median sleep 8.0 h over 45 nights. Days off barely shift it.");
  });

  it("R5 reports the average day and the most logged one", () => {
    const days = barcode(long());
    if ("notEnough" in days) throw new Error("expected days");

    expect(plain(r5Takeaway(days)))
      .toMatch(/^45 days at a glance: \d+\.\d h logged on an average day, most on \w+ \d+ \w+ \(\d+\.\d h\)\.$/);
  });
});
