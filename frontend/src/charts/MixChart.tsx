// O3 "How has my time changed over the period?" (new-ui Overview): one stacked bar per day, week or month,
// then the period's average day with direct labels (it replaces the legend).
import { useState } from "react";
import { OTHER, UNLOGGED, type AverageDayRow, type MixOverTime, type PeriodDays } from "../lib/aggregate";
import { fmtDate, fmtDay, fmtHours, fmtMonth } from "../lib/format";
import { dayAxisLabels, pct, spreadLabels, tooltipSide, type AxisLabel } from "../lib/geometry";
import { fillOf } from "../lib/theme";
import type { Settings } from "../lib/types";
import { Tooltip, type TipRow } from "../components/ui";

const H = 240;
const nameOf = (key: string) => (key === UNLOGGED ? "Unlogged" : key === OTHER ? "Other" : key);
const ring = (key: string) => (key === UNLOGGED ? "inset 0 0 0 1px var(--unlogged-edge)" : "inset 0 1px 0 var(--surface)");

function axisLabels(mix: MixOverTime, weekStart: string): AxisLabel[] {
  const keys = mix.buckets.map((b) => b.key);
  if (mix.kind === "day") return dayAxisLabels(keys, weekStart);
  const every = Math.ceil(keys.length / (mix.kind === "week" ? 10 : 12));
  return keys.map((key, i) => {
    const shown = i % every === 0 || i === keys.length - 1;
    const text = mix.kind === "week" ? fmtDate(key) : fmtMonth(key, i === 0 || key.slice(5, 7) === "01");
    return { text: shown ? text : "", bold: i === keys.length - 1 };
  });
}

interface Props {
  mix: MixOverTime;
  /** The period's average day (All days, calendar days): the "avg" bar and its labels. */
  average: AverageDayRow | null;
  /** One category, or null for all of them. */
  category: string | null;
  settings: Settings;
  days: PeriodDays;
  today: string;
  compact: boolean;
}

export default function MixChart({ mix, average, category, settings, days, today, compact }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = mix.buckets.length;
  const single = category !== null;
  const scale = single
    ? Math.max(2, Math.ceil(Math.max(...mix.buckets.map((b) => b.hours[0]?.hours ?? 0)) / 2) * 2)
    : 24;
  const ticks = single ? [0, scale / 2, scale] : [0, 6, 12, 18, 24];
  const gap = n > 45 ? 1 : n > 32 || compact ? 2 : 4;
  const labels = axisLabels(mix, settings.week_start);
  const notInFile = new Set(days.notInFile);

  const avgParts = !single && average ? average.hours.filter((h) => h.hours > 0.05) : [];
  let cum = 0;
  const sideLabels = single
    ? [{ key: category!, y: (1 - (mix.average ?? 0) / scale) * H, value: `avg ${fmtHours(mix.average ?? 0)}` }]
    : spreadLabels(avgParts.map((h) => {
      const mid = cum + h.hours / 2;
      cum += h.hours;
      return { key: h.key, y: (1 - mid / 24) * H, value: h.hours.toFixed(1) };
    }), 15, H - 6);

  const tip = hover === null ? null : (() => {
    const b = mix.buckets[hover];
    const shown = b.hours.filter((h) => h.hours > 0.01);
    const rows: TipRow[] = (single ? shown : [...shown].reverse())
      .map((h) => ({ name: nameOf(h.key), value: fmtHours(h.hours), fill: fillOf(h.key, settings) }));
    if (!single && b.notYet > 0.01 && !notInFile.has(b.key)) rows.unshift({ name: "not yet", value: fmtHours(b.notYet), fill: "nif" });
    const logged = b.hours.reduce((a, h) => a + (h.key === UNLOGGED ? 0 : h.hours), 0);
    let title: string;
    let tag = "";
    let foot: string | undefined;
    if (mix.kind === "day") {
      title = fmtDay(b.key);
      tag = b.key === today ? "today" : b.dayOff ? "off" : "";
      if (notInFile.has(b.key)) foot = "Not in this file: after the export. Never counted as unlogged.";
      else if (b.key === days.partial) foot = b.key === today ? `In progress: ${fmtHours(logged)} logged so far.` : `${fmtHours(logged)} logged before the export.`;
      else if (!single) foot = `${fmtHours(logged)} logged of ${fmtHours(logged + (b.hours.find((h) => h.key === UNLOGGED)?.hours ?? 0))}`;
    } else {
      title = mix.kind === "week" ? `Week of ${fmtDate(b.key)}` : fmtMonth(b.key, true);
      tag = b.partial ? "part" : "";
      foot = `Average day over ${b.days} day${b.days === 1 ? "" : "s"} in this period.`;
    }
    return { title, tag, rows: notInFile.has(b.key) && mix.kind === "day" ? [] : rows, foot, side: tooltipSide(hover, n) };
  })();

  return (
    <>
      <div className="o3" onMouseLeave={() => setHover(null)}>
        <div className="yaxis">
          {ticks.map((t) => <span key={t} style={{ bottom: pct(t / scale), transform: "translateY(50%)" }}>{t}</span>)}
        </div>
        <div className="o3-plot" style={{ gap }}>
          {ticks.map((t) => <div key={t} className="hline" style={{ bottom: pct(t / scale) }} />)}
          {mix.buckets.map((b, i) => {
            const parts = (single ? b.hours.slice(0, 1) : b.hours).filter((h) => h.hours > 0.01);
            const dotted = !single && b.notYet > 0.01;
            return (
              <div key={b.key} className="o3-col" onMouseEnter={() => setHover(i)}
                style={{ opacity: hover === null || hover === i ? 1 : 0.4 }}>
                {parts.map((h, j) => (
                  <div key={h.key} style={{
                    height: pct(h.hours / scale), background: fillOf(h.key, settings), boxShadow: single ? "none" : ring(h.key),
                    borderRadius: j === parts.length - 1 && !dotted ? "4px 4px 0 0" : 0,
                  }} />
                ))}
                {dotted && <div className="nif" style={{ height: pct(b.notYet / scale), borderRadius: "4px 4px 0 0" }} />}
              </div>
            );
          })}
          {single && <div className="avgline" style={{ bottom: pct((mix.average ?? 0) / scale) }} />}
          {tip && <Tooltip style={{ left: tip.side.left, transform: tip.side.transform }} title={tip.title} tag={tip.tag}
            rows={tip.rows} foot={tip.foot} />}
        </div>
        <div />
        <div className="o3-avg" style={{ opacity: single ? 0 : 1 }} aria-hidden={single}>
          {avgParts.map((h, j) => (
            <div key={h.key} style={{
              height: pct(h.hours / 24), background: fillOf(h.key, settings), boxShadow: ring(h.key),
              borderRadius: j === avgParts.length - 1 ? "4px 4px 0 0" : 0,
            }} />
          ))}
        </div>
        <div className="o3-labels wide-only">
          {sideLabels.map((l) => (
            <div key={l.key} className={`o3-label${l.key === UNLOGGED || l.key === OTHER ? " plain" : ""}`} style={{ top: `${l.y.toFixed(1)}px` }}>
              <span className="tick" style={{ background: l.key === UNLOGGED ? "var(--unlogged-hatch)" : fillOf(l.key, settings) }} />
              <span className="nm">{nameOf(l.key)}</span><span className="v">{l.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="o3-x">
        <div />
        <div className="xcols" style={{ gap }}>
          {mix.buckets.map((b, i) => (
            <div key={b.key} className="xcol">
              <span className={`l${labels[i].bold ? " bold" : ""}`}>{labels[i].text}</span>
              {mix.kind === "day" && n <= 62 && b.dayOff && <span className="off">off</span>}
            </div>
          ))}
        </div>
        <div />
        <div className="o3-avg-label" style={{ opacity: single ? 0 : 1 }}>avg</div>
      </div>
      <div className="legend-narrow narrow-only">
        {sideLabels.map((l) => (
          <span key={l.key}>
            <span className="sw8" style={{ background: fillOf(l.key, settings) }} /><b>{nameOf(l.key)}</b><em>{l.value}</em>
          </span>
        ))}
      </div>
    </>
  );
}
