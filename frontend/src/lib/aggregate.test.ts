import { describe, expect, it } from "vitest";
import { fixtureCtx, syntheticCtx } from "../test/fixture";
import {
  averageDay, barcode, bucketKind, categoryRows, coverage, coverageShare, dayProbability, groupOf, median, mixOverTime,
  periodDays, previousRange, projectRows, sleepNights, subcategoryRows, totals, weekdayHeatmap, withDeltas,
  MIN_DAYS_R5, MIN_NIGHTS_R4, NIGHT_START_HOUR, UNLOGGED,
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

// --- Stage 3.5 Part B --------------------------------------------------------------------------

describe("the previous period", () => {
  it("takes the days immediately before a rolling period", () => {
    const ctx = syntheticCtx("2026-10-01", "2026-10-30");
    ctx.analysis.calendar.first_day = "2025-03-03";

    expect(previousRange(ctx.analysis, "1m")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(previousRange(ctx.analysis, null)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });

  it("compares a part-month with the same stretch of the previous month", () => {
    const ctx = syntheticCtx("2026-10-01", "2026-10-15");  // "This month", 15 days in
    ctx.analysis.calendar.first_day = "2025-03-03";

    expect(previousRange(ctx.analysis, "this_month")).toEqual({ start: "2026-09-01", end: "2026-09-15" });
  });

  it("never asks a short month for more days than it has", () => {
    const ctx = syntheticCtx("2026-03-01", "2026-03-31");
    ctx.analysis.calendar.first_day = "2025-03-03";

    expect(previousRange(ctx.analysis, "this_month")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("compares a part-year with the same stretch of the previous year", () => {
    const ctx = syntheticCtx("2026-01-01", "2026-01-20");
    ctx.analysis.calendar.first_day = "2024-03-03";

    expect(previousRange(ctx.analysis, "this_year")).toEqual({ start: "2025-01-01", end: "2025-01-20" });
  });

  it("says there is none when the calendar starts later", () => {
    const ctx = syntheticCtx("2026-10-01", "2026-10-30");
    ctx.analysis.calendar.first_day = "2026-09-15";

    expect(previousRange(ctx.analysis, "1m")).toEqual({ unavailable: true, calendarFirstDay: "2026-09-15" });
  });
});

describe("O1 Δ column", () => {
  it("is this period's hours minus the previous period's", () => {
    const now = categoryRows(syntheticCtx("2026-10-10", "2026-10-16"));
    const before = categoryRows(syntheticCtx("2026-10-03", "2026-10-09"));

    const rows = withDeltas(now, before);

    // Both weeks hold one Friday (day off, no CLASS), so every category matches.
    expect(rows.find((r) => r.key === "CLASS")!.delta).toBeCloseTo(0);
    expect(rows.find((r) => r.key === "LEARN")!.delta).toBeCloseTo(0);
  });

  it("shows a category that only the previous period had as a fall to zero", () => {
    const now = categoryRows(syntheticCtx("2026-10-10", "2026-10-16"));
    const before = [...categoryRows(syntheticCtx("2026-10-03", "2026-10-09")),
      { key: "GYM", kind: "unknown" as const, slot: null, label: "GYM", hours: 4, share: 0.02, perDay: 0.5 }];

    const rows = withDeltas(now, before);
    const gym = rows.find((r) => r.key === "GYM")!;

    expect([gym.hours, gym.delta]).toEqual([0, -4]);
    expect(rows[rows.length - 1].key).toBe(UNLOGGED);  // Unlogged stays last
  });
});

describe("O3 how the mix changed", () => {
  it("buckets by day, week or month from the number of days", () => {
    expect(bucketKind(8)).toBe("day");
    expect(bucketKind(31)).toBe("day");
    expect(bucketKind(32)).toBe("week");
    expect(bucketKind(182)).toBe("week");
    expect(bucketKind(183)).toBe("month");
  });

  it("gives one bar per day, each adding up to the day's length", () => {
    const mix = mixOverTime(syntheticCtx("2026-10-01", "2026-10-07"));
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(mix.kind).toBe("day");
    expect(mix.buckets).toHaveLength(7);
    const sunday = mix.buckets[0];  // Thu 1 Oct, a workday: 7.5 + 3 + 2 + 2 + 0.5 = 15 h logged
    expect(hoursOf(sunday.hours, "CLASS")).toBeCloseTo(3);
    expect(hoursOf(sunday.hours, UNLOGGED)).toBeCloseTo(9);
    expect(sunday.hours.reduce((a, h) => a + h.hours, 0) + sunday.notYet).toBeCloseTo(24);
  });

  it("averages hours per day inside week buckets, so a part week compares fairly", () => {
    const mix = mixOverTime(syntheticCtx("2026-10-01", "2026-11-30"));  // 61 days -> weeks
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(mix.kind).toBe("week");
    const whole = mix.buckets.filter((b) => !b.partial);
    expect(whole.length).toBeGreaterThan(5);
    for (const b of whole) {
      expect(b.days).toBe(7);
      // 6 workdays x 15 h + 1 day off x 12 h = 102 h over 7 days
      expect(b.hours.reduce((a, h) => a + h.hours, 0)).toBeCloseTo(24);
      expect(hoursOf(b.hours, "CLASS")).toBeCloseTo(18 / 7);
    }
    expect(mix.buckets[0].partial).toBe(true);  // the week Thu 1 Oct falls in starts before the period
  });

  it("marks the first and last partial week and leaves whole ones alone", () => {
    const mix = mixOverTime(syntheticCtx("2026-10-03", "2026-11-27"));  // Sat -> Fri: whole weeks
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(mix.buckets.every((b) => !b.partial)).toBe(true);
  });

  it("keeps days after the export out of Unlogged and calls them 'not yet'", () => {
    const ctx = { ...syntheticCtx("2026-10-01", "2026-10-07"), today: "2026-10-07", dataAsOf: "2026-10-05" };
    const mix = mixOverTime(ctx);
    if ("notEnough" in mix) throw new Error("expected buckets");

    const after = mix.buckets.filter((b) => b.key > "2026-10-05");
    expect(after).toHaveLength(2);
    for (const b of after) {
      expect(b.notYet).toBeCloseTo(24);
      expect(hoursOf(b.hours, UNLOGGED)).toBe(0);
      expect(b.partial).toBe(true);
    }
  });

  it("drops the stack and reports the average for one category", () => {
    const mix = mixOverTime(syntheticCtx("2026-10-03", "2026-10-09"), "LEARN");
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(mix.buckets[0].hours.map((h) => h.key)).toEqual(["LEARN"]);
    expect(mix.average).toBeCloseTo(2);  // 2 h every day
  });

  it("needs two buckets to show a change", () => {
    expect(mixOverTime(syntheticCtx("2026-10-05", "2026-10-05"))).toEqual({ notEnough: true, need: 2, have: 1 });
  });
});

describe("O4 projects", () => {
  it("counts block hours per project, with where they came from", () => {
    const rows = projectRows(syntheticCtx("2026-10-01", "2026-10-07"));

    expect(rows).toHaveLength(1);
    const [exam] = rows;
    expect([exam.project, exam.hours, exam.blocks, exam.activeDays]).toEqual(["exam-prep", 14, 7, 7]);
    expect([exam.first, exam.last]).toEqual(["2026-10-01", "2026-10-07"]);
    expect(exam.mix).toEqual([{ key: "LEARN", hours: 14 }]);
    expect(exam.share).toBeCloseTo(14 / (7 * 24));
  });

  it("is empty when no title carries a +project", () => {
    const ctx = syntheticCtx("2026-10-01", "2026-10-07");
    ctx.analysis.blocks.forEach((b) => { b.projects = []; });

    expect(projectRows(ctx)).toEqual([]);
  });

  it("counts a block with two projects in both rows", () => {
    const ctx = syntheticCtx("2026-10-01", "2026-10-07");
    ctx.analysis.blocks.filter((b) => b.projects.length).forEach((b) => { b.projects = ["exam-prep", "finals"]; });

    const rows = projectRows(ctx);

    expect(rows.map((r) => [r.project, r.hours])).toEqual([["exam-prep", 14], ["finals", 14]]);
  });
});

describe("R4 sleep actogram", () => {
  it("joins an evening and the morning after into one night on an 18:00 axis", () => {
    const nights = sleepNights(syntheticCtx("2026-09-01", "2026-10-15"));
    if ("notEnough" in nights) throw new Error("expected nights");

    expect(nights.category).toBe("SLEEP");
    const night = nights.nights.find((n) => n.day === "2026-09-10")!;
    expect(night.bars).toHaveLength(1);
    // asleep 23:30 (5.5 h after 18:00) until 07:30 (13.5 h after 18:00)
    expect([night.bars[0].from, night.bars[0].to]).toEqual([5.5, 13.5]);
    expect(night.bars[0].main).toBe(true);
    expect(NIGHT_START_HOUR + nights.medians.bedtime!).toBeCloseTo(23.5);
    expect((NIGHT_START_HOUR + nights.medians.wake!) % 24).toBeCloseTo(7.5);
    expect(nights.medians.hours).toBeCloseTo(8);
  });

  it("leaves the last night out of the medians, since its morning is past the period", () => {
    const nights = sleepNights(syntheticCtx("2026-09-01", "2026-10-15"));
    if ("notEnough" in nights) throw new Error("expected nights");

    const last = nights.nights[nights.nights.length - 1];
    expect([last.day, last.incomplete]).toEqual(["2026-10-15", true]);
    expect(last.bars[0].to).toBe(6);  // only the 23:30-24:00 part is in the file
    expect(nights.medians.hours).toBeCloseTo(8);  // so it does not drag the median down
  });

  it("keeps a night with nothing logged as an empty row and names it", () => {
    const ctx = syntheticCtx("2026-09-01", "2026-10-15");
    // The night of the 21st is its bedtime plus the morning of the 22nd: remove both.
    ctx.analysis.segments = ctx.analysis.segments.filter((s) => !(s.category === "SLEEP"
      && (s.date === "2026-09-21" || (s.date === "2026-09-22" && s.start_local.includes("T00:")))));

    const nights = sleepNights(ctx);
    if ("notEnough" in nights) throw new Error("expected nights");

    expect(nights.nights.find((n) => n.day === "2026-09-20")!.bars).toHaveLength(1);  // bedtime only
    expect(nights.nights.find((n) => n.day === "2026-09-21")!.bars).toEqual([]);
    expect(nights.empty).toEqual(["2026-09-21"]);
  });

  it("marks naps as the shorter stretches of a night", () => {
    const ctx = syntheticCtx("2026-09-01", "2026-10-15");
    const nap = structuredClone(ctx.analysis.segments.find((s) => s.category === "SLEEP")!);
    Object.assign(nap, { date: "2026-09-10", start_local: "2026-09-10T15:00:00+03:30", duration_min: 45 });
    ctx.analysis.segments.push(nap);

    const nights = sleepNights(ctx);
    if ("notEnough" in nights) throw new Error("expected nights");

    const night = nights.nights.find((n) => n.day === "2026-09-09")!;
    expect(night.bars.map((b) => b.main)).toEqual([true, false]);  // the night, then the 15:00 nap
  });

  it("needs 14 nights with sleep", () => {
    expect(sleepNights(syntheticCtx("2026-09-01", "2026-09-10")))
      .toEqual({ notEnough: true, need: MIN_NIGHTS_R4, have: 10 });
  });

  it("says nothing when sleep is logged under another name", () => {
    const ctx = syntheticCtx("2026-09-01", "2026-10-15");
    delete ctx.settings.categories.SLEEP;
    ctx.analysis.segments.forEach((s) => { if (s.category === "SLEEP") s.category = "REST"; });

    expect(sleepNights(ctx)).toEqual({ notEnough: true, need: MIN_NIGHTS_R4, have: 0 });
  });
});

describe("R5 life barcode", () => {
  it("gives one column per day with its parts in clock order", () => {
    const days = barcode(syntheticCtx("2026-09-01", "2026-10-15"));
    if ("notEnough" in days) throw new Error("expected days");

    expect(days).toHaveLength(45);
    const workday = days.find((d) => d.day === "2026-09-10")!;
    expect(workday.parts.map((p) => [p.key, p.from, p.to])).toEqual([
      ["SLEEP", 0, 7.5], ["CLASS", 9, 12], ["LEARN", 13, 15], ["ME", 19, 21], ["SLEEP", 23.5, 24],
    ]);
    expect(workday.logged).toBeCloseTo(15);
    expect(days.find((d) => d.dayOff)!.parts.some((p) => p.key === "CLASS")).toBe(false);
  });

  it("needs 30 days", () => {
    expect(barcode(syntheticCtx("2026-09-01", "2026-09-20")))
      .toEqual({ notEnough: true, need: MIN_DAYS_R5, have: 20 });
  });
});

describe("median", () => {
  it("averages the middle two of an even count and ignores order", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

// The acceptance criterion for Part B: O1's Δ, O3 and O4 on the fixture, against numbers computed
// by hand from tests/fixtures/google_export_sample.ics.
describe("Part B on the fixture, hand-computed", () => {
  it("O3 gives one bar per day with the fixture's own hours", () => {
    const mix = mixOverTime(fixtureCtx());
    if ("notEnough" in mix) throw new Error("expected buckets");

    expect(mix.kind).toBe("day");
    expect(mix.buckets.map((b) => b.key)).toEqual([
      "2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05", "2025-09-06", "2025-09-07", "2025-09-08",
    ]);
    // 2 Sep: SLEEP 8 h, LEARN 2 h, ME 1 h, so 13 h unlogged of a 24-hour day.
    const second = mix.buckets[1];
    expect(hoursOf(second.hours, "SLEEP")).toBe(8);
    expect(hoursOf(second.hours, "LEARN")).toBe(2);
    expect(hoursOf(second.hours, "ME")).toBe(1);
    expect(hoursOf(second.hours, UNLOGGED)).toBe(13);
    expect(second.partial).toBe(false);
    // 4 Sep is a Thursday with only 1.5 h of RESEARCH.
    expect(hoursOf(mix.buckets[3].hours, "RESEARCH")).toBe(1.5);
    expect(hoursOf(mix.buckets[3].hours, UNLOGGED)).toBe(22.5);
    // 5 Sep is the Friday day off, and 8 Sep is today: logged only, the rest "not yet".
    expect(mix.buckets[4].dayOff).toBe(true);
    const today = mix.buckets[7];
    expect([today.partial, hoursOf(today.hours, UNLOGGED)]).toEqual([true, 0]);
    expect(today.notYet).toBe(24 - today.hours.reduce((a, h) => a + h.hours, 0));
  });

  it("O1's Δ against the week before holds the fixture's hours", () => {
    const ctx = fixtureCtx();
    const rows = withDeltas(categoryRows(ctx), []);  // nothing logged before: every Δ is the period itself

    expect(rows.find((r) => r.key === "SLEEP")!.delta).toBe(31);     // 1 + 8 + 7 + 8 + 7
    expect(rows.find((r) => r.key === "CLASS")!.delta).toBe(2);      // 6 and 7 Sep, 1 h each
    expect(rows.find((r) => r.key === "RESEARCH")!.delta).toBe(1.5);
    expect(rows.find((r) => r.key === "JOB")!.delta).toBe(0);        // configured, never logged
  });

  it("O4 finds the fixture's one project", () => {
    const rows = projectRows(fixtureCtx());

    expect(rows).toEqual([{
      project: "exam-prep", hours: 2, share: rows[0].share, blocks: 1, activeDays: 1,
      first: "2025-09-02", last: "2025-09-02", mix: [{ key: "LEARN", hours: 2 }],
    }]);
    expect(rows[0].share).toBeCloseTo(2 / totals(fixtureCtx()).denominatorHours);
  });
});
