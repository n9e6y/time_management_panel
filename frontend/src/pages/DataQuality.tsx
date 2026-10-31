import { useMemo } from "react";
import Chart from "../components/Chart";
import { Card, StatTile } from "../components/ui";
import { coverageCalendar } from "../charts/options";
import { coverage, coverageShare, type Ctx } from "../lib/aggregate";
import { fmtDay, fmtHM, fmtPct } from "../lib/format";
import { ISSUE_INFO, SKIP_REASON } from "../lib/issues";

export default function DataQuality({ ctx, onOpenSettings }: { ctx: Ctx; onOpenSettings: () => void }) {
  const { analysis } = ctx;
  const days = useMemo(() => coverage(ctx), [ctx]);
  const d1 = useMemo(() => coverageCalendar(days, ctx.settings.week_start), [days, ctx.settings.week_start]);
  const issues = Object.entries(analysis.report.title_issues);
  const issueBlocks = new Set(issues.flatMap(([, items]) => items.map((i) => i.block_id))).size;
  const overlapHours = analysis.report.overlaps.reduce((a, o) => a + o.minutes / 60, 0);
  const titleOf = (id: number) => analysis.blocks.find((b) => b.block_id === id)?.title ?? `block ${id}`;
  const weeks = Math.ceil(days.length / 7) + 1;

  return (
    <>
      <h1>Data quality</h1>
      <div className="tiles">
        <StatTile label="Coverage" value={fmtPct(coverageShare(ctx), 0)} context="of full days' hours are logged" />
        <StatTile label="Title issues" value={String(issueBlocks)} context="blocks to fix in your calendar" />
        <StatTile label="Skipped events" value={String(analysis.report.skipped.length)} context="not counted as time" />
        <StatTile label="Overlaps" value={String(analysis.report.overlaps.length)} context={`${fmtHM(overlapHours)} counted twice`} />
      </div>
      <div className="grid">
        <Card code="D1" title="Which days can I trust?" className="span2" caption="Share of each day that is logged. Darker = more logged. Today is still in progress.">
          <div className="scroll"><Chart label="Coverage calendar" height={Math.min(1400, 90 + weeks * 30)} option={d1} /></div>
        </Card>
        <Card code="D2" title="Which titles need fixing?" className="span2">
          {issues.length === 0 ? <p className="muted">No title issues in this period.</p> : (
            <table>
              <thead><tr><th>Issue</th><th>Title</th><th>When</th><th>How to fix</th></tr></thead>
              <tbody>
                {issues.flatMap(([code, items]) => items.map((item, i) => (
                  <tr key={`${code}-${item.block_id}`}>
                    <td>{i === 0 ? <><span className="chip warn">⚠ {ISSUE_INFO[code]?.label ?? code}</span> <span className="faint small">{items.length}</span></> : null}</td>
                    <td>{item.title}</td>
                    <td className="faint">{fmtDay(item.start_local.slice(0, 10))} {item.start_local.slice(11, 16)}</td>
                    <td className="faint">{i === 0 && <>{ISSUE_INFO[code]?.fix}{(code === "unknown_category" || code === "unknown_tag") && <> <button className="linkbtn" onClick={onOpenSettings}>Open Settings</button></>}</>}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}
        </Card>
        <Card code="D3" title="What was left out?">
          {analysis.report.skipped.length === 0 ? <p className="muted">Nothing was skipped.</p> : (
            <table>
              <thead><tr><th>Event</th><th>Reason</th></tr></thead>
              <tbody>{analysis.report.skipped.map((s, i) => <tr key={i}><td>{s.title}<div className="faint small">{s.start?.slice(0, 10)}</div></td><td>{SKIP_REASON[s.reason] ?? s.reason}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card code="D4" title="Where is time counted twice?">
          {analysis.report.overlaps.length === 0 ? <p className="muted">No overlapping blocks.</p> : (
            <table>
              <thead><tr><th>Blocks</th><th className="num">Overlap</th></tr></thead>
              <tbody>{analysis.report.overlaps.map((o, i) => <tr key={i}><td>{titleOf(o.block_a)}<br />{titleOf(o.block_b)}</td><td className="num">{fmtHM(o.minutes / 60)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
