// Read the design tokens from CSS so charts (drawn on canvas) use the same colors as the page.
import { OTHER, UNLOGGED } from "./aggregate";
import type { Settings } from "./types";

export interface Palette {
  token: (name: string) => string;
  seq: string[];
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim() || "#888888";
  return { token, seq: [0, 1, 2, 3, 4, 5, 6].map((i) => token(`seq-${i}`)) };
}

/** CSS variable name for a category, the "Other" grey or Unlogged. */
export function colorVar(key: string, settings: Settings): string {
  if (key === UNLOGGED) return "unlogged-fill";
  if (key === OTHER) return "other";
  const slot = settings.categories[key]?.color;
  return slot ? `cat-${slot}` : "other";
}
