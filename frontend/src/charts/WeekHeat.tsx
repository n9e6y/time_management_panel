// R3 "Which days of my week carry which activity?" (new-ui Rhythm): average hours per weekday, one row per
// category, each row on its own scale.
import { OTHER, UNLOGGED, type WeekdayHeatmap } from "../lib/aggregate";
import { heatStrength } from "../lib/geometry";
import { colorVar } from "../lib/theme";
import type { Settings } from "../lib/types";

const nameOf = (key: string) => (key === UNLOGGED ? "Unlogged" : key === OTHER ? "Other" : key);

export default function WeekHeat({ data, settings }: { data: WeekdayHeatmap; settings: Settings }) {
  const rows = data.rows.filter((r) => r.hours.some((h) => h >= 0.05));
  return (
    <div className="r3" role="table" aria-label="Average hours per weekday">
      <div role="presentation" />
      {data.weekdays.map((w) => (
        <div key={w.name} className="r3-head" role="columnheader" aria-label={w.name}>
          <b>{w.name.slice(0, 3)}</b>
          <span>{w.dayOff ? `off · ×${w.count}` : `×${w.count}`}</span>
        </div>
      ))}
      {rows.map((row) => {
        const max = Math.max(...row.hours);
        const unlogged = row.key === UNLOGGED;
        const base = unlogged ? "var(--text-3)" : `var(--${colorVar(row.key, settings)})`;
        return [
          <div key={`${row.key}-name`} role="rowheader"
            className={`r3-name${unlogged || row.key === OTHER ? " plain" : ""}${unlogged ? " unl" : ""}`}>{nameOf(row.key)}</div>,
          ...row.hours.map((h, i) => {
            const strength = heatStrength(h, max);
            const mix = unlogged ? Math.round(strength * 0.6) : strength;
            return (
              <div key={`${row.key}-${i}`} role="cell" className={`r3-cell${h === max && h > 0 ? " max" : ""}`}
                title={`${nameOf(row.key)} on ${data.weekdays[i].name}: ${h.toFixed(1)} h`}
                style={{ background: strength ? `color-mix(in oklch, ${base} ${mix}%, var(--surface))` : "var(--surface-2)" }}>
                {h < 0.05 ? "–" : h.toFixed(1)}
              </div>
            );
          }),
        ];
      })}
    </div>
  );
}
