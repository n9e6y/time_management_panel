// O1 "Where did my time go, and what grew or shrank?" and O2 "What was X made of?" (new-ui Overview).
import { DELTA_ARROW_HOURS, KIND_LABEL, UNLOGGED, type CategoryRow, type SubcategoryRow } from "../lib/aggregate";
import { fmtPct } from "../lib/format";
import { pct } from "../lib/geometry";
import { fillOf } from "../lib/theme";
import type { Settings } from "../lib/types";

/** `+22.5`, `−4.0`, `0.0`: O1's vs-prev. column, without the unit. */
export function fmtDelta(delta: number): string {
  if (Math.abs(delta) < 0.05) return "0.0";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`;
}

export function CategoryTable({ rows, settings, selected, comparable, onSelect }: {
  rows: CategoryRow[]; settings: Settings; selected: string | null;
  /** There is a previous period to compare with (or a reason there isn't): show the column. */
  comparable: boolean;
  onSelect: (key: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.hours), 1);
  return (
    <div aria-label="Hours per category">
      <div className="o1-head">
        <span>Category</span><span>Hours</span>
        <span className="wide-only" style={{ textAlign: "right" }}>Share</span>
        <span className="wide-only" style={{ textAlign: "right" }}>Per day</span>
        <span style={{ textAlign: "right" }}>{comparable ? "vs prev." : ""}</span>
      </div>
      <div className="o1-rows">
        {rows.map((r) => {
          const unlogged = r.key === UNLOGGED;
          const can = !unlogged && r.hours > 0;
          const delta = r.delta;
          const arrow = delta !== undefined && Math.abs(delta) >= DELTA_ARROW_HOURS ? (delta > 0 ? "▲" : "▼") : "";
          const className = `o1-row${can ? " can" : ""}${unlogged ? " unlogged" : ""}${r.hours === 0 ? " zero" : ""}`;
          const cells = (
            <>
              <span className="o1-name">
                <span className="n">{r.label}</span>
                {KIND_LABEL[r.kind] && <span className="note">{KIND_LABEL[r.kind]}</span>}
              </span>
              <span className="o1-bar">
                <span className="b" style={{
                  width: pct((r.hours / max) * 0.8), minWidth: r.hours > 0 ? 3 : 0, background: fillOf(r.key, settings),
                }} />
                <span className="h">{r.hours.toFixed(1)}</span>
              </span>
              <span className="o1-num wide-only">{fmtPct(r.share, 1)}</span>
              <span className="o1-num wide-only">{r.perDay.toFixed(1)}</span>
              <span className="o1-delta">
                {comparable && (delta === undefined ? "—" : <>{fmtDelta(delta)}<span className="arrow">{arrow}</span></>)}
              </span>
            </>
          );
          return can ? (
            <button key={r.key} type="button" className={className} aria-pressed={r.key === selected}
              onClick={() => onSelect(r.key)} title={`Show what ${r.key} was made of`}>{cells}</button>
          ) : <div key={r.key} className={className}>{cells}</div>;
        })}
      </div>
    </div>
  );
}

export function PartsBars({ rows, category, settings }: { rows: SubcategoryRow[]; category: string; settings: Settings }) {
  const max = Math.max(...rows.map((r) => r.hours), 0.0001);
  const rest = (r: SubcategoryRow) => / others$/.test(r.label);
  return (
    <div className="o2-rows" role="list" aria-label={`Sub-categories of ${category}`}>
      {rows.map((r) => (
        <div key={r.label} className={`o2-row${rest(r) ? " rest" : ""}`} role="listitem">
          <span className="n" title={r.label}>{r.label}</span>
          <span className="bar">
            <span style={{ width: pct((r.hours / max) * 0.78), background: fillOf(category, settings) }} />
            <span>{r.estimated ? "≈" : ""}{r.hours.toFixed(1)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
