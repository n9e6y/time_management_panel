// Read the design tokens from CSS so charts (drawn on canvas) use the same colors as the page, and keep
// the light/dark choice the top bar's toggle makes.
import { useEffect, useState } from "react";
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

/** The CSS background of a category in the HTML charts; Unlogged is hatched (tokens: `--hatch`). */
export function fillOf(key: string, settings: Settings): string {
  return key === UNLOGGED ? "var(--hatch)" : `var(--${colorVar(key, settings)})`;
}

/** Text drawn on top of a category's fill (R1's in-bar labels): light or dark per hue, per theme. */
export function inkOn(key: string, settings: Settings): string {
  if (key === UNLOGGED) return "var(--text-2)";
  const name = colorVar(key, settings);
  return name.startsWith("cat-") ? `var(--on-${name})` : "var(--on-other)";
}

// --- light / dark ----------------------------------------------------------------------------------

export type Theme = "light" | "dark";
const STORAGE_KEY = "time-analyzer-theme";

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;  // storage blocked: follow the system
  }
}

/**
 * The theme on `<html data-theme>`. It follows the system until the toggle is used; the choice is then
 * remembered in this browser only.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (storedTheme() || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => { if (!storedTheme()) setTheme(media.matches ? "dark" : "light"); };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  const toggle = () => setTheme((current) => {
    const next: Theme = current === "dark" ? "light" : "dark";
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* not remembered, still switched */ }
    return next;
  });
  return [theme, toggle];
}

/** Phone width (the design's 390 px frames): the layouts that need it in code, not only in CSS. */
export const COMPACT_QUERY = "(max-width: 760px)";

export function useCompact(): boolean {
  const query = () => typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
  const [compact, setCompact] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}
