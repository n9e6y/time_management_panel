// How a measured goal reads on screen: its words, its glyph and the geometry of one bullet row.
// Pure and tested; the row itself is drawn in GoalRows.tsx.
import { fmtDay, fmtHours, fmtPct } from "./format";
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

/** The goal card's one-line answer: "2 of 4 goals on pace". */
export function goalsTakeaway(items: GoalProgress[]): string {
  if (!items.length) return "No goals yet. Add one in Settings to see whether your time goes where you want.";
  const s = summarize(items);
  if (!s.judged) return `${s.fixed} fixed goal${s.fixed === 1 ? "" : "s"}: hours are shown, never judged.`;
  const verb = s.running ? "on pace" : "met";
  const parts = [`${s.good} of ${s.judged} goals ${verb}`];
  if (s.close) parts.push(`${s.close} close`);
  if (s.behind) parts.push(`${s.behind} ${s.running ? "behind" : "missed"}`);
  if (s.over) parts.push(`${s.over} over`);
  if (s.fixed) parts.push(`${s.fixed} fixed`);
  return `${parts.join(" · ")}.`;
}
