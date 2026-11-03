import { describe, expect, it } from "vitest";
import { categoryOf, detail, glyph, goalsTakeaway, rowScale, summarize, tone, upperEnd, word, zones } from "./goals";
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

describe("the card's one-line answer", () => {
  it("counts what is on pace while the week runs", () => {
    const items = [
      progress({ id: "a", running: true, status: "on_pace" }),
      progress({ id: "b", running: true, status: "behind" }),
      progress({ id: "c", running: true, status: "heading_over" }),
      progress({ id: "d", running: true, status: "logged", type: "fixed" }),
    ];

    expect(summarize(items)).toMatchObject({ total: 4, judged: 3, good: 1, behind: 1, over: 1, fixed: 1 });
    expect(goalsTakeaway(items)).toBe("1 of 3 goals on pace · 1 behind · 1 over · 1 fixed.");
  });

  it("switches to 'met' once the period is over", () => {
    expect(goalsTakeaway([progress({ status: "met" }), progress({ id: "b", status: "missed" })]))
      .toBe("1 of 2 goals met · 1 missed.");
  });

  it("invites the first goal when there are none", () => {
    expect(goalsTakeaway([])).toContain("No goals yet.");
  });

  it("says nothing is judged when every goal is fixed", () => {
    expect(goalsTakeaway([progress({ type: "fixed", status: "logged" })]))
      .toBe("1 fixed goal: hours are shown, never judged.");
  });
});
