import { describe, expect, it } from "vitest";
import { fixtureCtx, syntheticCtx } from "../test/fixture";
import {
  averageDay, barcode, categoryRows, dayProbability, mixOverTime, projectRows, sleepNights, subcategoryRows,
  weekdayHeatmap, withDeltas,
} from "./aggregate";
import {
  mixWords, o1Takeaway, o2Takeaway, o3Takeaway, o4Takeaway, r1Second, r1Takeaway, r2Takeaway, r3Takeaway, r4Takeaway,
  r5Takeaway,
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

  it("O3 by day names the day with the most of the one category", () => {
    const mix = mixOverTime(syntheticCtx("2026-10-01", "2026-10-20"), "LEARN");
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(plain(o3Takeaway(mix, "LEARN"))).toBe("LEARN averaged 2.0 h a day across 20 days; the most was 2.0 h on Thu 1 Oct.");
  });

  it("O4 names the largest project, its share, its days and where it came from", () => {
    expect(plain(o4Takeaway(projectRows(long()))))
      .toBe("+exam-prep took 90.0 h, 8.3% of your time, on 45 days; all of it came from LEARN.");
    expect(plain(o4Takeaway([]))).toBe("No +project tags in this period.");
  });

  it("O4 says 'most of it' or lists the sources, depending on the mix", () => {
    const [row] = projectRows(long());
    const mixed = { ...row, hours: 38.5, mix: [{ key: "LEARN", hours: 30 }, { key: "CLASS", hours: 8.5 }] };
    expect(plain(o4Takeaway([mixed]))).toContain("; most of it came from LEARN.");
    const spread = { ...row, hours: 14, mix: [{ key: "LEARN", hours: 6 }, { key: "RESEARCH", hours: 5.5 }, { key: "ME", hours: 2.5 }] };
    expect(plain(o4Takeaway([spread]))).toContain("; it came from LEARN, RESEARCH and ME.");
  });

  it("words a project's category mix", () => {
    expect(mixWords([{ key: "LEARN", hours: 30 }, { key: "CLASS", hours: 8.5 }])).toBe("mostly LEARN, some CLASS");
    expect(mixWords([{ key: "RESEARCH", hours: 5.5 }, { key: "LEARN", hours: 6 }, { key: "ME", hours: 2.5 }])).toBe("LEARN, RESEARCH, ME");
    expect(mixWords([{ key: "RESEARCH", hours: 6 }])).toBe("RESEARCH");
  });

  it("R1 names the category days off differ in most", () => {
    expect(plain(r1Takeaway(averageDay(long(), "calendar"))))
      .toBe("Your days off differ most in CLASS: 0.0 h against 3.0 h on a workday.");
  });

  it("R1's second sentence names the next difference, and stays quiet when there is none", () => {
    expect(r1Second(averageDay(long(), "calendar"))).toBe("");
    const rows = averageDay(long(), "calendar").map((r) => (r.type !== "Day off" ? r
      : { ...r, hours: r.hours.map((h) => (h.key === "SOCIAL" ? { ...h, hours: 2.6 } : h)) }));
    expect(plain(r1Second(rows))).toBe("SOCIAL rises from 0.0 h to 2.6 h.");
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

  it("R4 says by how many minutes days off move bedtime", () => {
    const data = sleepNights(long());
    if ("notEnough" in data) throw new Error("expected nights");
    data.medians.bedtimeDayOff = data.medians.bedtimeWorkday! + 53 / 60;

    expect(r4Takeaway(data)).toContain("On days off you go to bed 53 min later.");
  });

  it("R5 reports the average day and the most logged one", () => {
    const days = barcode(long());
    if ("notEnough" in days) throw new Error("expected days");

    expect(plain(r5Takeaway(days)))
      .toMatch(/^45 days at a glance: \d+\.\d h logged on an average day, most on \w+ \d+ \w+ \(\d+\.\d h\)\.$/);
  });
});
