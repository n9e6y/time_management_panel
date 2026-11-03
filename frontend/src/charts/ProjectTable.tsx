// O4 "Which projects took my time, and from where?" (new-ui Overview).
import type { ProjectRow } from "../lib/aggregate";
import { fmtDate, fmtHours, fmtMonth, fmtPct, fmtSpan } from "../lib/format";
import { pct } from "../lib/geometry";
import { mixWords } from "../lib/takeaway";
import type { Settings } from "../lib/types";
import { MixBar } from "../components/ui";

export default function ProjectTable({ rows, settings, trendKind, onShowBlocks }: {
  rows: ProjectRow[]; settings: Settings; trendKind: "week" | "month";
  onShowBlocks: (row: ProjectRow) => void;
}) {
  const peak = Math.max(...rows.flatMap((r) => r.trend.map((t) => t.hours)), 0.0001);
  const unit = trendKind === "week" ? "Per week" : "Per month";
  return (
    <div>
      <div className="o4-head wide-only">
        <span className="a-proj">Project</span><span className="a-hours">Hours</span><span className="a-share">Share</span>
        <span className="a-days">Active days</span><span className="a-range">First – last</span><span className="a-mix">Category mix</span>
        <span className="a-weeks">{unit}</span><span className="a-blocks">Blocks</span>
      </div>
      {rows.map((r) => {
        const range = fmtSpan(r.first, r.last);
        return (
          <div key={r.project} className="o4-row">
            <span className="a-proj">+{r.project}</span>
            <span className="a-hours">{r.hours.toFixed(1)}</span>
            <span className="a-share wide-only">{fmtPct(r.share, 1)}</span>
            <span className="a-days wide-only">{r.activeDays}</span>
            <span className="a-range wide-only">{range}</span>
            <span className="a-mix">
              <MixBar parts={r.mix} settings={settings} />
              <span className="mixtext">{mixWords(r.mix)}</span>
            </span>
            <span className="a-weeks wide-only" role="img"
              aria-label={`${unit}: ${r.trend.map((t) => t.hours.toFixed(1)).join(", ")} h`}>
              {r.trend.map((t) => (
                <span key={t.key} title={`${trendKind === "week" ? `week of ${fmtDate(t.key)}` : fmtMonth(t.key, true)}: ${fmtHours(t.hours)}`}
                  style={{ height: pct(t.hours / peak), background: t.hours ? "var(--text-3)" : "var(--border)" }} />
              ))}
            </span>
            <span className="a-blocks wide-only">
              <button className="linkbtn" onClick={() => onShowBlocks(r)} title={`Show the ${r.blocks} blocks of +${r.project}`}>{r.blocks}</button>
            </span>
            <span className="a-meta narrow-only">
              {fmtPct(r.share, 1)} · {r.activeDays} active days · {range} ·{" "}
              <button className="linkbtn" onClick={() => onShowBlocks(r)}>{r.blocks} blocks</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
