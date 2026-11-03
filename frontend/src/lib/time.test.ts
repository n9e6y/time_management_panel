import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dayLengthHours, daysBetween, endOfMonth, minutesOfDay, startOfMonth, todayIn, weekStartOf,
  weekdayOf, weekdaysFrom,
} from "./time";
import { fmtDay, fmtHM, fmtHours, fmtRange } from "./format";

describe("time", () => {
  it("does day arithmetic across months", () => {
    expect(addDays("2025-08-31", 1)).toBe("2025-09-01");
    expect(daysBetween("2025-09-01", "2025-09-03")).toEqual(["2025-09-01", "2025-09-02", "2025-09-03"]);
    expect(weekdayOf("2025-09-06")).toBe("Saturday");
    expect(weekdaysFrom("Saturday")).toEqual(
      ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  });

  it("knows real day lengths on clock changes", () => {
    expect(dayLengthHours("2025-03-30", "Europe/Berlin")).toBe(23);
    expect(dayLengthHours("2025-10-26", "Europe/Berlin")).toBe(25);
    expect(dayLengthHours("2025-09-02", "Asia/Tehran")).toBe(24);
  });

  it("finds today in the user's zone and reads local times", () => {
    expect(todayIn("Asia/Tehran", new Date("2025-09-07T21:00:00Z"))).toBe("2025-09-08");  // 00:30 local
    expect(minutesOfDay("2025-09-02T09:30:00+03:30")).toBe(570);
  });
});

describe("format", () => {
  it("uses the design's number and date formats", () => {
    expect(fmtHours(218.46)).toBe("218.5 h");
    expect(fmtHours(52, true)).toBe("≈ 52.0 h");
    expect(fmtHM(1.5)).toBe("1:30");
    expect(fmtDay("2025-09-02")).toBe("Tue 2 Sep");
    expect(fmtRange("2025-09-01", "2025-09-08")).toBe("1 Sep – 8 Sep 2025");
    expect(fmtRange("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026");
  });
});

describe("months and weeks", () => {
  it("walks whole months and clamps to the month's length", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");  // leap year
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(startOfMonth("2026-10-29")).toBe("2026-10-01");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });

  it("finds the start of the week the user's week begins on", () => {
    expect(weekStartOf("2026-10-29", "Saturday")).toBe("2026-10-24");  // Thu -> previous Sat
    expect(weekStartOf("2026-10-24", "Saturday")).toBe("2026-10-24");
    expect(weekStartOf("2026-10-29", "Monday")).toBe("2026-10-26");
  });
});
