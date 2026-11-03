// R5 "How did my days look across months?" (new-ui Rhythm): one 24-hour column per day, 00:00 at the top.
import { useState } from "react";
import type { BarcodeDay } from "../lib/aggregate";
import { fmtDay, fmtHours } from "../lib/format";
import { dayAxisLabels, pct, tooltipSide } from "../lib/geometry";
import { dayLengthHours } from "../lib/time";
import { fillOf } from "../lib/theme";
import type { Settings } from "../lib/types";
import { Tooltip } from "../components/ui";

const Y = [0, 6, 12, 18, 24];

export default function Barcode({ days, settings, today }: { days: BarcodeDay[]; settings: Settings; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const gap = n > 90 ? 0 : n > 45 ? 1 : 2;
  const labels = dayAxisLabels(days.map((d) => d.day), settings.week_start);
  const tip = hover === null ? null : (() => {
    const d = days[hover];
    const line = d.notInFile ? "Not in this file: after the export."
      : d.partial ? `${fmtHours(d.logged)} logged so far`
        : `${fmtHours(d.logged)} logged of ${fmtHours(dayLengthHours(d.day, settings.timezone))}`;
    return { title: fmtDay(d.day), tag: d.day === today ? "today" : d.dayOff ? "off" : "", line, side: tooltipSide(hover, n) };
  })();

  return (
    <>
      <div className="r5" onMouseLeave={() => setHover(null)}>
        <div className="yaxis">
          {Y.map((h) => <span key={h} style={{ top: pct(h / 24) }}>{`${String(h).padStart(2, "0")}:00`}</span>)}
        </div>
        <div className="r5-plot" style={{ gap }} role="img" aria-label={`${n} days, one column each`}>
          {days.map((d, i) => {
            const end = d.parts.reduce((a, p) => Math.max(a, p.to), 0);
            return (
              <div key={d.day} className={`r5-col${n <= 90 ? " edged" : ""}`} onMouseEnter={() => setHover(i)}
                style={{ opacity: hover === null || hover === i ? 1 : 0.4 }}>
                {d.notInFile ? <div className="nif" style={{ top: 0, bottom: 0, borderRadius: 3 }} /> : (
                  <>
                    {d.parts.map((p, j) => (
                      <div key={j} style={{
                        top: pct(p.from / 24), height: pct((p.to - p.from) / 24), background: fillOf(p.key, settings),
                        borderRadius: p.from <= 0 ? "3px 3px 0 0" : p.to >= 24 ? "0 0 3px 3px" : 0,
                      }} />
                    ))}
                    {d.partial && end < 24 && <div className="nif" style={{ top: pct(end / 24), bottom: 0, borderRadius: "0 0 3px 3px" }} />}
                  </>
                )}
              </div>
            );
          })}
          {tip && <Tooltip style={{ left: tip.side.left, transform: tip.side.transform }} title={tip.title} tag={tip.tag} line={tip.line} />}
        </div>
      </div>
      <div className="r5" style={{ marginTop: 8 }}>
        <div />
        <div className="xcols" style={{ gap }}>
          {days.map((d, i) => (
            <div key={d.day} className="xcol">
              <span className={`l${labels[i].bold ? " bold" : ""}`}>{labels[i].text}</span>
              {n <= 62 && d.dayOff && <span className="off">off</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
