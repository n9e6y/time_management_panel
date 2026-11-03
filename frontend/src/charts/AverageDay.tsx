// R1 "What does an average day look like, and do my days off differ?" (new-ui Rhythm hero).
import { OTHER, UNLOGGED, type AverageDayRow } from "../lib/aggregate";
import { pct } from "../lib/geometry";
import { fillOf, inkOn } from "../lib/theme";
import type { Settings } from "../lib/types";

const nameOf = (key: string) => (key === UNLOGGED ? "Unlogged" : key === OTHER ? "Other" : key);
/** Rows with fewer days than this are rough (page-rhythm.md). */
export const ROUGH_DAYS = 5;

/** The parts too thin to carry a label in the All days bar: listed under the bars instead. */
export function smallParts(rows: AverageDayRow[], threshold = 0.08): string[] {
  const all = rows[0];
  if (!all?.days) return [];
  const total = all.hours.reduce((a, h) => a + h.hours, 0) || 24;
  return all.hours.filter((h) => h.key !== UNLOGGED && h.hours > 0.05 && h.hours / total < threshold).map((h) => h.key);
}

export default function AverageDay({ rows, settings, compact }: { rows: AverageDayRow[]; settings: Settings; compact: boolean }) {
  const nameAt = compact ? 0.26 : 0.17;
  const valueAt = compact ? 0.12 : 0.08;
  const keys = smallParts(rows, valueAt);
  return (
    <>
      <div className="r1-rows">
        {rows.map((row) => {
          const total = row.hours.reduce((a, h) => a + h.hours, 0) || 24;
          const rough = row.days > 0 && row.days < ROUGH_DAYS;
          return (
            <div key={row.type} className="r1-row">
              <div className="r1-name">
                <b>{row.type}</b>
                <span className={rough ? "rough" : undefined}>{row.days ? `${row.days} day${row.days === 1 ? "" : "s"}` : "no days"}{rough ? " · rough" : ""}</span>
              </div>
              <div className="r1-bar" role="img" aria-label={`${row.type}: ${row.hours.filter((h) => h.hours > 0.05).map((h) => `${nameOf(h.key)} ${h.hours.toFixed(1)} h`).join(", ")}`}>
                {row.days > 0 && row.hours.filter((h) => h.hours > 0.05).map((h) => {
                  const w = h.hours / total;
                  return (
                    <div key={h.key} className="r1-part" title={`${nameOf(h.key)} ${h.hours.toFixed(1)} h`} style={{
                      width: pct(w), background: fillOf(h.key, settings), color: inkOn(h.key, settings),
                      boxShadow: h.key === UNLOGGED ? "inset 0 0 0 1px var(--unlogged-edge)" : "inset -1.5px 0 0 var(--surface)",
                    }}>
                      <span className="nm">{w >= nameAt ? nameOf(h.key) : ""}</span>
                      <span className="v">{w >= valueAt ? h.hours.toFixed(1) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {keys.length > 0 && (
        <div className="keyline">
          {keys.map((key) => (
            <span key={key}>
              <span className="sw8" style={{ background: fillOf(key, settings) }} /><b>{nameOf(key)}</b>
              {rows.map((r) => (r.days ? (r.hours.find((h) => h.key === key)?.hours ?? 0).toFixed(1) : "–")).join(" · ")}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
