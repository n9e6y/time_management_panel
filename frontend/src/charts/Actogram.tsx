// R4 "When do I sleep, and how regular is it?" (new-ui Rhythm): one row per night, 18:00 to 18:00.
import { useState } from "react";
import { NIGHT_START_HOUR, type Nights } from "../lib/aggregate";
import { fmtClock, fmtDate, fmtDay, fmtHours } from "../lib/format";
import { pct } from "../lib/geometry";
import { addDays, weekdayOf } from "../lib/time";
import { fillOf } from "../lib/theme";
import type { Settings } from "../lib/types";

const TICKS = [18, 21, 0, 3, 6, 9, 12, 15, 18];
const ROW = 15;
const AXIS = 24;  // the hour row above the nights, with its margin
const clock = (hoursAfterSix: number) => fmtClock(NIGHT_START_HOUR + hoursAfterSix);

export default function Actogram({ nights, settings, notInFile, compact, onNight }: {
  nights: Nights; settings: Settings; notInFile: Set<string>; compact: boolean;
  onNight: (day: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const fill = fillOf(nights.category ?? "", settings);
  const { bedtime, wake } = nights.medians;
  const outside = (day: string) => notInFile.has(day) || notInFile.has(addDays(day, 1));
  const tip = hover === null ? null : (() => {
    const night = nights.nights[hover];
    const main = night.bars.find((b) => b.main);
    const line = outside(night.day) && !night.bars.length ? "Not in this file: after the export."
      : main ? `${clock(main.from)} → ${clock(main.to)} · ${fmtHours(main.to - main.from)}` : "No sleep logged this night.";
    const notes = [];
    if (night.bars.length > 1) notes.push("plus a nap, drawn thin");
    if (night.incomplete && night.bars.length) notes.push("not in the medians");
    if (night.bars.length) notes.push("click for blocks");
    const top = hover < 5 ? AXIS + hover * ROW + 24 : AXIS + hover * ROW - 70;
    return { title: `Night of ${fmtDay(night.day)}${night.dayOff ? " · off" : ""}`, line, foot: notes.join(" · "), top };
  })();

  return (
    <div className="r4" onMouseLeave={() => setHover(null)}>
      <div className="r4-axis">
        <div />
        <div>
          {TICKS.map((h, i) => (
            <span key={i} style={{ left: pct(i / 8), transform: i === 0 ? "none" : i === TICKS.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {`${String(h).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
      </div>
      <div className="r4-body">
        <div className="r4-grid">
          {TICKS.map((_, i) => <div key={i} className="g" style={{ left: pct(i / 8) }} />)}
          {bedtime !== null && <div className="median" style={{ left: pct(bedtime / 24) }} />}
          {wake !== null && <div className="median" style={{ left: pct(wake / 24) }} />}
        </div>
        {nights.nights.map((night, i) => {
          const dotted = outside(night.day) && !night.bars.length;
          return (
            <button key={night.day} type="button" aria-disabled={!night.bars.length}
              className={`r4-row${hover === i ? " hover" : ""}`} onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)} onClick={() => { if (night.bars.length) onNight(night.day); }}
              aria-label={`Night of ${fmtDay(night.day)}`}>
              <span className={`r4-label${weekdayOf(night.day) === settings.week_start ? " ws" : ""}`}>
                <span className="d">{compact ? fmtDate(night.day) : fmtDay(night.day)}</span>
                <span className="off">{night.dayOff ? "off" : ""}</span>
              </span>
              <span className="r4-track">
                {dotted && <span className="r4-nif nif" />}
                {night.bars.map((bar) => (
                  <span key={bar.from} className={`r4-bar${bar.main ? "" : " nap"}`} style={{
                    left: pct(bar.from / 24), width: pct((bar.to - bar.from) / 24), background: fill,
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="r4-foot">
        <div />
        <div>
          {bedtime !== null && <span style={{ left: pct(bedtime / 24) }}>bed {clock(bedtime)}</span>}
          {wake !== null && <span style={{ left: pct(wake / 24) }}>wake {clock(wake)}</span>}
        </div>
      </div>
      {tip && (
        <div className="tip" style={{ top: tip.top }}>
          <div className="tip-head"><span>{tip.title}</span></div>
          <div className="tip-line">{tip.line}</div>
          {tip.foot && <div className="tip-quiet">{tip.foot}</div>}
        </div>
      )}
    </div>
  );
}
