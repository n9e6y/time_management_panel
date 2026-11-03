// R2 "When in the day does each thing happen?" (new-ui Rhythm): share of days in each 15-minute slot,
// stacked to 100%, with the unlogged rest as the hatched background.
import { useMemo, useState, type MouseEvent } from "react";
import { OTHER, SLOT_MINUTES, UNLOGGED, type DayProbability } from "../lib/aggregate";
import { fmtClock, fmtPct } from "../lib/format";
import { pct, stackPaths } from "../lib/geometry";
import { fillOf } from "../lib/theme";
import type { Settings } from "../lib/types";
import { Tooltip } from "../components/ui";

const nameOf = (key: string) => (key === UNLOGGED ? "Unlogged" : key === OTHER ? "Other" : key);
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** A label on each band that fills at least 30% of days somewhere: at the middle of its widest peak. */
export function peakLabels(series: { key: string; shares: number[] }[]): { key: string; x: number; y: number; share: number }[] {
  const lower = new Array<number>(series[0]?.shares.length ?? 0).fill(0);
  const found: { key: string; x: number; y: number; share: number }[] = [];
  for (const s of series) {
    const top = Math.max(...s.shares);
    if (top >= 0.3) {
      const run = s.shares.map((v, i) => (v >= top - 0.001 ? i : -1)).filter((i) => i >= 0);
      const slot = run[Math.floor(run.length / 2)];
      found.push({
        key: s.key, share: s.shares[slot],
        x: Math.min(0.94, Math.max(0.05, (slot + 0.5) / s.shares.length)), y: 1 - (lower[slot] + s.shares[slot] / 2),
      });
    }
    s.shares.forEach((v, i) => { lower[i] += v; });
  }
  const kept: typeof found = [];
  for (const label of found) {
    if (!kept.some((k) => Math.abs(k.x - label.x) < 0.11 && Math.abs(k.y - label.y) < 0.09)) kept.push(label);
  }
  return kept;
}

export default function DayArea({ data, settings }: { data: DayProbability; settings: Settings }) {
  const [slot, setSlot] = useState<number | null>(null);
  const bands = useMemo(() => data.series.filter((s) => s.key !== UNLOGGED && s.shares.some((v) => v > 0)), [data]);
  const paths = useMemo(() => stackPaths(bands.map((s) => s.shares)), [bands]);
  const labels = useMemo(() => peakLabels(bands), [bands]);
  const slots = data.series[0]?.shares.length ?? 96;

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    const next = Math.max(0, Math.min(slots - 1, Math.floor(((e.clientX - box.left) / box.width) * slots)));
    if (next !== slot) setSlot(next);
  };
  const minute = (s: number) => (s * SLOT_MINUTES) / 60;
  const right = slot !== null && slot < slots * 0.62;

  return (
    <>
      <div className="r2">
        <div className="yaxis">
          <span style={{ top: 0, transform: "translateY(-50%)" }}>100%</span>
          <span style={{ top: "50%", transform: "translateY(-50%)" }}>50%</span>
          <span style={{ bottom: 0, transform: "translateY(50%)" }}>0</span>
        </div>
        <div className="r2-plot" onMouseMove={onMove} onMouseLeave={() => setSlot(null)}>
          <svg viewBox="0 0 960 1000" preserveAspectRatio="none" role="img"
            aria-label={`Share of ${data.days} days in each 15-minute slot`}>
            {paths.map((d, i) => <path key={bands[i].key} d={d} style={{ fill: fillOf(bands[i].key, settings) }} />)}
          </svg>
          {HOURS.slice(1, -1).map((h) => <div key={h} className="vline" style={{ left: pct(h / 24) }} />)}
          {labels.map((l) => (
            <div key={l.key} className="peak" style={{ left: pct(l.x), top: pct(l.y) }}>
              {nameOf(l.key)}<span>{fmtPct(l.share, 0)}</span>
            </div>
          ))}
          {slot !== null && (
            <>
              <div className="cursor" style={{ left: pct((slot + 0.5) / slots) }} />
              <Tooltip style={{ left: pct((slot + 0.5) / slots), transform: right ? "translateX(10px)" : "translateX(calc(-100% - 10px))" }}
                title={`${fmtClock(minute(slot))}–${fmtClock(minute(slot + 1))}`} tag={`of ${data.days} days`}
                rows={data.series.filter((s) => s.shares[slot] > 0.004).sort((a, b) => b.shares[slot] - a.shares[slot])
                  .map((s) => ({ name: nameOf(s.key), value: fmtPct(s.shares[slot], 0), fill: fillOf(s.key, settings) }))} />
            </>
          )}
        </div>
      </div>
      <div className="r2" style={{ marginTop: 8 }}>
        <div />
        <div className="xticks">
          {HOURS.map((h, i) => (
            <span key={h} style={{ left: pct(h / 24), transform: i === 0 ? "none" : i === HOURS.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {`${String(h).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
