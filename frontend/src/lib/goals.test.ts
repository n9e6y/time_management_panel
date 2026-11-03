import { describe, expect, it } from "vitest";
import {
  categoryOf, detail, glyph, goalLines, goalsHeadline, goalsTally, groupLine, rowScale, summarize, tone, upperEnd, word, zones,
} from "./goals";
import type { GoalProgress } from "./types";

const plain = (line: string) => line.replace(/ /g, " ");

function progress(over: Partial<GoalProgress> = {}): GoalProgress {
  return {
    id: "learn", scope: "LEARN", every: "week", type: "floor", hours: 10, tolerance: 0.1, label: "≥ 10 h",
    first_day: "2026-10-31", last_day: "2026-11-06", running: false, elapsed: 1, actual: 10, estimated: 0,
    blocks: 4, coverage: 1, low_coverage: false, status: "met", expected: null, expected_min: null,
    expected_max: null, gap: 0, projected: null, ...over,
  };
}

describe("goal words", () => {
  it("pairs every status with a tone and a glyph", () => {
    expect(tone("met")).toBe("met");
    expect(tone("heading_over")).toBe("over");
    expect(tone("behind")).toBe("behind");
    expect(tone("logged")).toBe("none");
    expect(glyph("missed")).toBe("▼");
    expect(glyph("over")).toBe("▲");
  });

  it("says 'Within pace' for a running cap, not 'On pace'", () => {
    expect(word(progress({ type: "cap", status: "on_pace", running: true }))).toBe("Within pace");
    expect(word(progress({ status: "on_pace", running: true }))).toBe("On pace");
  });

  it("marks a verdict that rests on an estimate", () => {
    expect(word(progress({ status: "close", estimated: 1 }))).toBe("Close (≈)");
    expect(word(progress({ status: "close", estimated: 0 }))).toBe("Close");
  });

  it("says what it would take while the period runs", () => {
    expect(plain(detail(progress({ running: true, status: "behind", gap: 4, expected: 5.7 }))))
      .toBe("needs 4.0 h more by Fri 6 Nov");
    expect(plain(detail(progress({ type: "cap", running: true, status: "heading_over", projected: 5.6 }))))
      .toBe("at this rate ≈ 5.6 h by Fri 6 Nov");
    expect(plain(detail(progress({ running: true, status: "on_pace", expected: 5.7 }))))
      .toBe("expected 5.7 h by now");
  });

  it("says how far off a finished period was", () => {
    expect(plain(detail(progress({ status: "missed", gap: 2.5 })))).toBe("2.5 h short");
    expect(plain(detail(progress({ type: "cap", status: "over", gap: 1.5 })))).toBe("1.5 h past the goal");
  });

  it("names a fixed goal's hours and never judges them", () => {
    expect(plain(detail(progress({ type: "fixed", status: "logged", actual: 17, blocks: 9 }))))
      .toBe("17.0 h in 9 blocks · not judged on hours");
  });

  it("adds the estimate and low-coverage notes", () => {
    const line = plain(detail(progress({ status: "met", estimated: 1.5, low_coverage: true, coverage: 0.64 })));

    expect(line).toBe("≈ 1.5 h estimated · only 64% of the period logged");
  });
});

describe("one row's geometry", () => {
  it("scales to the goal, not to the biggest goal on the card", () => {
    expect(upperEnd(progress())).toBe(10);
    expect(upperEnd(progress({ type: "range", hours: null, min: 49, max: 63 }))).toBe(63);
    expect(rowScale(progress({ actual: 2 }))).toBeCloseTo(13);
    expect(rowScale(progress({ actual: 20 }))).toBeCloseTo(22);  // an overshoot still fits
  });

  it("lays a floor's zones out as out / close / target", () => {
    expect(zones(progress()).map((z) => [z.tone, Number(z.from.toFixed(1)), Number(z.to.toFixed(1))]))
      .toEqual([["out", 0, 9], ["close", 9, 10], ["target", 10, 13]]);
  });

  it("flips them for a cap and brackets the middle for a range", () => {
    expect(zones(progress({ type: "cap", hours: 5 })).map((z) => z.tone)).toEqual(["target", "close", "out"]);
    expect(zones(progress({ type: "range", hours: null, min: 49, max: 63 })).map((z) => z.tone))
      .toEqual(["out", "close", "target", "close", "out"]);
  });

  it("gives a fixed goal no zones, since it has no line to cross", () => {
    expect(zones(progress({ type: "fixed", hours: null }))).toEqual([]);
  });

  it("reads the category off a sub-category scope", () => {
    expect(categoryOf("ME: scrolling")).toBe("ME");
    expect(categoryOf("LEARN")).toBe("LEARN");
  });
});

describe("the hero's verdict", () => {
  /** The design's own example: LEARN behind this week, the other four judged goals fine, one fixed. */
  const week = [
    progress({ id: "learn", running: true, status: "behind", actual: 6, expected: 7.1, gap: 4, projected: 8.45 }),
    progress({ id: "scroll", scope: "ME: scrolling", type: "cap", hours: 5, running: true, status: "on_pace", actual: 3.5 }),
    progress({ id: "sleep", scope: "SLEEP", type: "range", min: 49, max: 63, running: true, status: "close", actual: 41 }),
    progress({ id: "research", scope: "RESEARCH", hours: 4, running: true, status: "on_pace", actual: 4.5 }),
    progress({ id: "learn-m", every: "month", hours: 40, running: true, status: "on_pace", actual: 37.5 }),
    progress({ id: "class", scope: "CLASS", every: "month", type: "fixed", hours: null, running: true, status: "logged" }),
  ];

  it("leads with the goal most off track and sums up the rest", () => {
    expect(summarize(week)).toMatchObject({ total: 6, judged: 5, good: 3, close: 1, behind: 1, fixed: 1 });
    const { head, rest } = goalsHeadline(week);
    expect(plain(head)).toBe("LEARN is 1.1 h behind pace this week.");
    expect(rest).toBe("The other four judged goals are met, on pace or close.");
  });

  it("counts each tone for the tally, leaving out the empty ones", () => {
    expect(goalsTally(week).map((t) => `${t.glyph} ${t.n} ${t.word}`)).toEqual([
      "✓ 3 on pace or met", "○ 1 close", "▼ 1 behind pace", "· 1 fixed, not judged",
    ]);
  });

  it("puts behind before over, and says when others are off pace too", () => {
    const { head, rest } = goalsHeadline([
      progress({ id: "a", scope: "ME", type: "cap", hours: 5, running: true, status: "heading_over", projected: 7, actual: 4 }),
      progress({ id: "b", running: true, status: "behind", actual: 1, expected: 3, gap: 9 }),
    ]);
    expect(plain(head)).toBe("LEARN is 2.0 h behind pace this week.");
    expect(rest).toBe("One other goal is off pace too.");
  });

  it("speaks of a cap heading over in terms of where this rate leads", () => {
    const { head } = goalsHeadline([progress({ scope: "ME", type: "cap", hours: 5, running: true, status: "heading_over", projected: 7.2 })]);
    expect(plain(head)).toBe("ME is heading over its weekly goal: ≈ 7.2 h at this rate.");
  });

  it("reports a finished period by how far it ended from the goal", () => {
    const { head, rest } = goalsHeadline([progress({ status: "met" }), progress({ id: "b", scope: "SLEEP", status: "missed", gap: 3 })]);
    expect(plain(head)).toBe("SLEEP ended 3.0 h short of its weekly goal.");
    expect(rest).toBe("The other judged goal is met.");
  });

  it("says when every judged goal is fine, and mentions the fixed ones", () => {
    const { head, rest } = goalsHeadline([progress({ running: true, status: "on_pace" }), progress({ id: "b", running: true, status: "on_pace" }),
      progress({ id: "c", type: "fixed", status: "logged" })]);
    expect(head).toBe("Both judged goals are on pace or met.");
    expect(rest).toBe("One fixed goal is logged, not judged.");
  });

  it("invites the first goal when there are none", () => {
    expect(goalsHeadline([]).head).toBe("No goals yet.");
  });

  it("says nothing is judged when every goal is fixed", () => {
    expect(goalsHeadline([progress({ type: "fixed", status: "logged" })]).head).toBe("One fixed goal: hours are shown, never judged.");
  });
});

describe("goal group headings and lines", () => {
  it("names the week with weekdays, how far into it we are, and the days off", () => {
    const rows = [progress({ first_day: "2026-10-24", last_day: "2026-10-30", running: true })];
    expect(groupLine(rows, "2026-10-29", ["Friday"])).toBe("Sat 24 – Fri 30 Oct · day 6 of 7, Fri is off");
  });

  it("names the month without weekdays", () => {
    const rows = [progress({ every: "month", first_day: "2026-10-01", last_day: "2026-10-31", running: true })];
    expect(groupLine(rows, "2026-10-29", ["Friday"])).toBe("1 – 31 Oct · day 29 of 31");
  });

  it("labels one goal line, or both ends of a range", () => {
    expect(goalLines(progress())).toEqual([{ at: 10, label: "10 h" }]);
    expect(goalLines(progress({ type: "range", min: 49, max: 63 })).map((l) => l.label)).toEqual(["49", "63 h"]);
    expect(goalLines(progress({ type: "fixed", hours: null }))).toEqual([]);
  });
});
