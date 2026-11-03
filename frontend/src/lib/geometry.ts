// Layout arithmetic for the charts drawn as HTML and SVG (new-ui design, 2026-11-03). Pure and tested,
// so a chart component only maps these numbers onto elements.
import { fmtDate, fmtMonth } from "./format";
import { weekdayOf } from "./time";

/** A share (0-1) as a CSS percentage; negative shares draw as nothing. */
export function pct(share: number): string {
  return `${(Math.max(0, share) * 100).toFixed(3)}%`;
}

/**
 * Direct labels down the side of a stacked bar (O3's average day): keep each near its band's middle,
 * at least `gap` px apart, and inside `0…max` px.
 */
export function spreadLabels<T extends { y: number }>(items: T[], gap: number, max: number): T[] {
  const out = items.map((item) => ({ ...item })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) {
    if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  }
  const overflow = out.length ? out[out.length - 1].y - max : 0;
  if (overflow > 0) out.forEach((item) => { item.y -= overflow; });
  return out;
}

/**
 * Stacked area paths for R2: one closed path per series, the first series at the bottom. Points sit at
 * the middle of each slot and the edges are held flat to the chart's sides. Coordinates are in a
 * `width × height` box with y growing downwards.
 */
export function stackPaths(series: number[][], width = 960, height = 1000): string[] {
  const slots = series[0]?.length ?? 0;
  if (!slots) return [];
  const x = (slot: number) => ((slot + 0.5) * width) / slots;
  const y = (share: number) => (height * (1 - Math.min(1, share))).toFixed(1);
  const lower = new Array<number>(slots).fill(0);
  return series.map((shares) => {
    const upper = lower.map((low, slot) => low + shares[slot]);
    const top = [`0,${y(upper[0])}`, ...upper.map((v, slot) => `${x(slot).toFixed(1)},${y(v)}`), `${width},${y(upper[slots - 1])}`];
    const bottom = [`${width},${y(lower[slots - 1])}`,
      ...lower.map((v, slot) => `${x(slot).toFixed(1)},${y(v)}`).reverse(), `0,${y(lower[0])}`];
    upper.forEach((v, slot) => { lower[slot] = v; });
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  });
}

/**
 * R3's cell strength: a percentage to mix the category color into the surface. Every row has its own
 * scale, so the row's busiest weekday is always the darkest; values under 0.05 h stay empty.
 */
export function heatStrength(value: number, rowMax: number): number {
  if (value < 0.05 || rowMax <= 0) return 0;
  return Math.round(8 + 52 * (value / rowMax));
}

/** Where a column's tooltip goes: right of the column in the left part of the chart, else left of it. */
export function tooltipSide(index: number, count: number): { left: string; transform: string } {
  const right = index < count * 0.62;
  return {
    left: pct((right ? index + 1 : index) / count),
    transform: right ? "translateX(8px)" : "translateX(calc(-100% - 8px))",
  };
}

export interface AxisLabel {
  text: string;
  bold: boolean;
}

/**
 * Labels under one column per day (O3, R5). Up to ~2 months: the week starts and the last day, with the
 * month named on the first label and wherever it changes. Longer: the first of each month.
 */
export function dayAxisLabels(days: string[], weekStart: string): AxisLabel[] {
  const last = days.length - 1;
  if (days.length > 62) {
    return days.map((day, i) => {
      if (i !== 0 && !day.endsWith("-01")) return { text: "", bold: false };
      return { text: fmtMonth(day, i === 0 || day.slice(5, 7) === "01"), bold: false };
    });
  }
  let month = "";
  return days.map((day, i) => {
    const marked = weekdayOf(day) === weekStart || i === last;
    if (!marked) return { text: "", bold: false };
    const name = day.slice(0, 7);
    const text = i === last || name !== month ? fmtDate(day) : String(Number(day.slice(8)));
    month = name;
    return { text, bold: i === last };
  });
}
