// How a measured goal reads on screen: its words, its glyph and the geometry of one bullet row.
// Pure and tested; the row itself is drawn in GoalRows.tsx.
import { fmtDay, fmtHours, fmtPct, fmtSpan, fmtWeekdays } from "./format";
import { daysBetween } from "./time";
import type { GoalProgress, GoalStatus } from "./types";

/** The category a goal's scope belongs to: "ME: scrolling" is coloured as ME. */
export function categoryOf(scope: string): string {
  return scope.split(":", 1)[0].trim();
}

/** Status colors live in CSS as --st-met, --st-close, --st-behind, --st-over and --st-none. */
export type StatusTone = "met" | "close" | "behind" | "over" | "none";

const TONE: Record<GoalStatus, StatusTone> = {
  met: "met", within: "met", in_range: "met", on_pace: "met",
  close: "close",
  missed: "behind", below: "behind", behind: "behind",
  over: "over", above: "over", heading_over: "over",
  logged: "none",
};

const GLYPH: Record<StatusTone, string> = { met: "✓", close: "○", behind: "▼", over: "▲", none: "·" };

const WORD: Record<GoalStatus, string> = {
  met: "Met", within: "Within", in_range: "In range", close: "Close", missed: "Missed", over: "Over",
  below: "Below", above: "Above", on_pace: "On pace", behind: "Behind pace", heading_over: "Heading over",
  logged: "Logged",
};

export function tone(status: GoalStatus): StatusTone {
  return TONE[status];
}

export function glyph(status: GoalStatus): string {
  return GLYPH[TONE[status]];
}

/** "On pace", or "Close (≈)" when an estimate is what decided it (IA §7). */
export function word(item: GoalProgress): string {
  const base = item.status === "on_pace" && item.type === "cap" ? "Within pace" : WORD[item.status];
  return item.status === "close" && item.estimated > 0 ? `${base} (≈)` : base;
}

/** The one detail line under the status: what it would take, or what this rate leads to. */
export function detail(item: GoalProgress): string {
  const notes: string[] = [];
  if (item.type === "fixed") {
    notes.push(`${fmtHours(item.actual)} in ${item.blocks} block${item.blocks === 1 ? "" : "s"} · not judged on hours`);
  } else if (item.running) {
    if (item.status === "behind") {
      notes.push(`needs ${fmtHours(item.gap)} more by ${fmtDay(item.last_day)}`);
    } else if (item.status === "heading_over" && item.projected !== null) {
      notes.push(`at this rate ≈ ${fmtHours(item.projected)} by ${fmtDay(item.last_day)}`);
    } else if (item.type === "range" && item.expected_min !== null && item.expected_max !== null) {
      notes.push(`expected ${fmtHours(item.expected_min)}–${fmtHours(item.expected_max)} by now`);
    } else if (item.expected !== null) {
      notes.push(`expected ${fmtHours(item.expected)} by now`);
    }
  } else if (item.gap > 0) {
    const over = item.status === "over" || item.status === "above";
    notes.push(`${fmtHours(item.gap)} ${over ? "past the goal" : "short"}`);
  }
  if (item.estimated > 0) notes.push(`≈ ${fmtHours(item.estimated)} estimated`);
  if (item.low_coverage) notes.push(`only ${fmtPct(item.coverage, 0)} of the period logged`);
  return notes.join(" · ");
}

/** The upper end a goal asks for: the floor, the cap, or the top of the range. */
export function upperEnd(item: GoalProgress): number {
  if (item.type === "range") return item.max ?? 0;
  return item.hours ?? 0;
}

/**
 * Every row has its own scale (tokens.md §4): a 4 h goal must not be a sliver next to a 63 h one.
 * It reaches 1.3 × what the goal asks for, and always far enough to show the bar and the projection.
 */
export function rowScale(item: GoalProgress): number {
  const ends = [upperEnd(item) * 1.3, item.actual * 1.1, (item.projected ?? 0) * 1.1];
  return Math.max(...ends, 1);
}

/** The goal line(s) on a row and the label under each: `10 h`, or `49` and `63 h` for a range. */
export function goalLines(item: GoalProgress): { at: number; label: string }[] {
  const n = (h: number) => String(Number(h.toFixed(1)));
  if (item.type === "range") {
    return [{ at: item.min ?? 0, label: n(item.min ?? 0) }, { at: item.max ?? 0, label: `${n(item.max ?? 0)} h` }];
  }
  if (item.type === "fixed" || !item.hours) return [];
  return [{ at: item.hours, label: `${n(item.hours)} h` }];
}

/** The zone rail under the bar: out of range, close to the goal, then on target. */
export function zones(item: GoalProgress): { from: number; to: number; tone: "out" | "close" | "target" }[] {
  const scale = rowScale(item);
  const tolerance = item.tolerance ?? 0.1;
  if (item.type === "floor") {
    const target = item.hours ?? 0;
    return [
      { from: 0, to: target * (1 - tolerance), tone: "out" },
      { from: target * (1 - tolerance), to: target, tone: "close" },
      { from: target, to: scale, tone: "target" },
    ];
  }
  if (item.type === "cap") {
    const target = item.hours ?? 0;
    return [
      { from: 0, to: target, tone: "target" },
      { from: target, to: target * (1 + tolerance), tone: "close" },
      { from: target * (1 + tolerance), to: scale, tone: "out" },
    ];
  }
  if (item.type === "range") {
    const low = item.min ?? 0;
    const high = item.max ?? 0;
    return [
      { from: 0, to: low * (1 - tolerance), tone: "out" },
      { from: low * (1 - tolerance), to: low, tone: "close" },
      { from: low, to: high, tone: "target" },
      { from: high, to: high * (1 + tolerance), tone: "close" },
      { from: high * (1 + tolerance), to: scale, tone: "out" },
    ];
  }
  return [];
}

export interface GoalsSummary {
  total: number;
  /** Goals with a verdict (everything but `fixed`). */
  judged: number;
  good: number;
  behind: number;
  over: number;
  close: number;
  fixed: number;
  running: boolean;
}

export function summarize(items: GoalProgress[]): GoalsSummary {
  const counts = { met: 0, close: 0, behind: 0, over: 0, none: 0 };
  for (const item of items) counts[tone(item.status)] += 1;
  return {
    total: items.length, judged: items.length - counts.none, good: counts.met, behind: counts.behind,
    over: counts.over, close: counts.close, fixed: counts.none, running: items.some((i) => i.running),
  };
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Which tone is worst: what the headline speaks about first. */
const SEVERITY: Record<StatusTone, number> = { behind: 0, over: 1, close: 2, met: 3, none: 4 };

/** How far a running goal is behind where it should be by now (falls back to what it still needs). */
function behindBy(item: GoalProgress): number {
  const expected = item.expected ?? item.expected_min;
  return expected !== null && expected > item.actual ? expected - item.actual : item.gap;
}

function headlineFor(item: GoalProgress): string {
  const span = item.every === "week" ? "week" : "month";
  const goal = item.every === "week" ? "weekly goal" : "monthly goal";
  switch (tone(item.status)) {
    case "behind":
      return item.running ? `${item.scope} is ${fmtHours(behindBy(item))} behind pace this ${span}.`
        : `${item.scope} ended ${fmtHours(item.gap)} short of its ${goal}.`;
    case "over":
      if (!item.running) return `${item.scope} went ${fmtHours(item.gap)} past its ${goal}.`;
      return item.projected !== null
        ? `${item.scope} is heading over its ${goal}: ≈ ${fmtHours(item.projected)} at this rate.`
        : `${item.scope} is heading over its ${goal}.`;
    default:
      return item.running ? `${item.scope} is close to pace this ${span}.` : `${item.scope} came close to its ${goal}.`;
  }
}

/**
 * The goal panel's verdict (new-ui Overview hero): the goal most off track in one sentence, then a
 * quieter sentence about the rest. Every word comes from the measured goals.
 */
export function goalsHeadline(items: GoalProgress[]): { head: string; rest: string } {
  if (!items.length) {
    return { head: "No goals yet.", rest: "Add one in Settings to see whether your time goes where you want." };
  }
  const s = summarize(items);
  const fixedNote = s.fixed ? `${capitalize(numberWord(s.fixed))} fixed ${plural(s.fixed, "goal is", "goals are")} logged, not judged.` : "";
  if (!s.judged) return { head: `${capitalize(numberWord(s.fixed))} fixed ${plural(s.fixed, "goal", "goals")}: hours are shown, never judged.`, rest: "" };

  const judged = items.filter((i) => tone(i.status) !== "none");
  const worst = [...judged].sort((a, b) => SEVERITY[tone(a.status)] - SEVERITY[tone(b.status)]
    || (tone(a.status) === "behind" ? behindBy(b) - behindBy(a) : b.gap - a.gap))[0];
  if (tone(worst.status) === "met") {
    const verb = s.running ? "on pace or met" : "met";
    const head = s.judged === 1 ? `Your one judged goal is ${verb}.`
      : s.judged === 2 ? `Both judged goals are ${verb}.` : `All ${numberWord(s.judged)} judged goals are ${verb}.`;
    return { head, rest: fixedNote };
  }

  const others = judged.filter((i) => i !== worst);
  const off = others.filter((i) => ["behind", "over"].includes(tone(i.status))).length;
  const close = others.filter((i) => tone(i.status) === "close").length;
  let rest = "";
  if (others.length && off) {
    rest = `${capitalize(numberWord(off))} other ${plural(off, "goal is", "goals are")} off pace too.`;
  } else if (others.length) {
    const the = others.length === 1 ? "The other judged goal is" : `The other ${numberWord(others.length)} judged goals are`;
    rest = `${the} ${close ? "met, on pace or close" : s.running ? "met or on pace" : "met"}.`;
  }
  return { head: headlineFor(worst), rest };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The tally under the verdict: how many goals sit in each tone, worst-first words, zero rows left out. */
export function goalsTally(items: GoalProgress[]): { tone: StatusTone; glyph: string; n: number; word: string }[] {
  const s = summarize(items);
  const rows: { tone: StatusTone; n: number; word: string }[] = [
    { tone: "met", n: s.good, word: s.running ? "on pace or met" : "met" },
    { tone: "close", n: s.close, word: "close" },
    { tone: "behind", n: s.behind, word: s.running ? "behind pace" : "missed" },
    { tone: "over", n: s.over, word: s.running ? "over or heading over" : "over" },
    { tone: "none", n: s.fixed, word: "fixed, not judged" },
  ];
  return rows.filter((r) => r.n > 0).map((r) => ({ ...r, glyph: GLYPH[r.tone] }));
}

/** A goal group's heading line: `Sat 24 – Fri 30 Oct · day 6 of 7, Fri is off`. */
export function groupLine(rows: GoalProgress[], asOf: string, daysOff: string[]): string {
  const [first] = rows;
  const weekly = first.every === "week";
  const parts = [fmtSpan(first.first_day, first.last_day, weekly)];
  if (first.running) {
    const upTo = asOf < first.last_day ? asOf : first.last_day;
    parts.push(`day ${daysBetween(first.first_day, upTo).length} of ${daysBetween(first.first_day, first.last_day).length}`);
  }
  const off = weekly && daysOff.length ? `, ${fmtWeekdays(daysOff)} ${plural(daysOff.length, "is", "are")} off` : "";
  return `${parts.join(" · ")}${off}`;
}
