import { useMemo } from "react";
import Chart from "../components/Chart";
import FixTitle from "../components/FixTitle";
import { Card, StatTile } from "../components/ui";
import { coverageCalendar } from "../charts/options";
import { coverage, coverageShare, type Ctx } from "../lib/aggregate";
import { fmtDay, fmtHM, fmtPct } from "../lib/format";
import { ISSUE_INFO, SKIP_REASON } from "../lib/issues";
import type { Correction, Settings } from "../lib/types";

interface Props {
  ctx: Ctx;
  onOpenSettings: () => void;
  corrections: Correction[];
  /** Save the whole list; returns problems, or null when saved. */
  onSaveCorrections: (corrections: Correction[]) => Promise<string[] | null>;
  onSaveSettings: (settings: Settings) => Promise<string[] | null>;
}

export default function DataQuality({ ctx, onOpenSettings, corrections, onSaveCorrections, onSaveSettings }: Props) {
  const { analysis, settings } = ctx;
  const days = useMemo(() => coverage(ctx), [ctx]);
  const d1 = useMemo(() => coverageCalendar(days, ctx.settings.week_start), [days, ctx.settings.week_start]);
  const issues = Object.entries(analysis.report.title_issues);
  const issueBlocks = new Set(issues.flatMap(([, items]) => items.map((i) => i.block_id))).size;
  const overlapHours = analysis.report.overlaps.reduce((a, o) => a + o.minutes / 60, 0);
  const titleOf = (id: number) => analysis.blocks.find((b) => b.block_id === id)?.title ?? `block ${id}`;
  const blockOf = (id: number) => analysis.blocks.find((b) => b.block_id === id);
  const weeks = Math.ceil(days.length / 7) + 1;
  const known = Object.keys(settings.categories);

  const addCorrection = (correction: Correction) =>
    onSaveCorrections([...corrections.filter((c) => (c.uid ? c.uid !== correction.uid : c.match_title !== correction.match_title)), correction]);
  const dropCorrection = (correction: Correction) => onSaveCorrections(corrections.filter((c) => c !== correction));

  const addCategory = (name: string) => {
    const used = new Set(Object.values(settings.categories).map((c) => c.color));
    const free = Array.from({ length: 9 }, (_, i) => i + 1).find((slot) => !used.has(slot)) ?? null;
    return onSaveSettings({ ...settings, categories: { ...settings.categories, [name]: { focus: false, color: free } } });
  };
  const mapCategory = (from: string, to: string) =>
    onSaveSettings({ ...settings, legacy_categories: { ...settings.legacy_categories, [from]: { map_to: to, add_tags: [] } } });
  const addTag = (tag: string) =>
    onSaveSettings({ ...settings, tags: { known: [...settings.tags.known, tag] } });

  /** The fixes offered for one flagged event, by what is wrong with it. */
  function Fixes({ code, blockId, title }: { code: string; blockId: number; title: string }) {
    const block = blockOf(blockId);
    const unknownTags = (block?.tags ?? []).filter((tag) => !settings.tags.known.includes(tag));
    const sameTitle = analysis.blocks.filter((b) => b.title.trim() === title.trim()).length;
    return (
      <div className="fixes">
        {code === "unknown_category" && block && !known.includes(block.category) && (
          <>
            <button className="linkbtn" onClick={() => addCategory(block.category)}>Add {block.category}</button>
            <label className="faint small">
              {" or map to "}
              <select className="select small" aria-label={`Map ${block.category} to a category`} defaultValue=""
                onChange={(e) => e.target.value && mapCategory(block.category, e.target.value)}>
                <option value="">choose…</option>
                {known.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </>
        )}
        {code === "unknown_tag" && unknownTags.map((tag) => (
          <button className="linkbtn" key={tag} onClick={() => addTag(tag)}>Add #{tag} to known tags</button>
        ))}
        <FixTitle title={title} uid={block?.uid ?? ""} sameTitle={sameTitle} onFix={addCorrection} />
        {(code === "unknown_category" || code === "unknown_tag") && (
          <button className="linkbtn faint small" onClick={onOpenSettings}>Open Settings</button>
        )}
      </div>
    );
  }

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
              <thead><tr><th>Issue</th><th>Title</th><th>When</th><th>Fix it here</th></tr></thead>
              <tbody>
                {issues.flatMap(([code, items]) => items.map((item, i) => (
                  <tr key={`${code}-${item.block_id}`}>
                    <td>{i === 0 && (
                      <>
                        <span className="chip warn">⚠ {ISSUE_INFO[code]?.label ?? code}</span>{" "}
                        <span className="faint small">{items.length}</span>
                        <div className="faint small">{ISSUE_INFO[code]?.fix}</div>
                      </>
                    )}</td>
                    <td>{item.title}</td>
                    <td className="faint">{fmtDay(item.start_local.slice(0, 10))} {item.start_local.slice(11, 16)}</td>
                    <td><Fixes code={code} blockId={item.block_id} title={item.title} /></td>
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
        <Card code="D5" title="Titles you have corrected" className="span2"
          caption="Saved next to your calendar and applied every time it is read, so they survive a new export. Your Google Calendar is not changed: fix it there too if you want the typo gone for good.">
          {corrections.length === 0
            ? <p className="muted">No corrections. Use “Fix title…” above to rewrite a title without re-exporting.</p>
            : (
              <table>
                <thead><tr><th>Applies to</th><th>Corrected title</th><th className="num">Events</th><th /></tr></thead>
                <tbody>
                  {corrections.map((c) => (
                    <tr key={c.uid ?? c.match_title}>
                      <td>{c.uid ? <>one event <span className="faint small">(and its repeats)</span></> : <>every event titled <code>{c.match_title}</code></>}</td>
                      <td>{c.title}</td>
                      <td className="num">{analysis.report.corrected?.[c.uid ? `uid:${c.uid}` : `title:${c.match_title}`] ?? 0}</td>
                      <td className="num"><button className="linkbtn" onClick={() => dropCorrection(c)}>Undo</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Card>
      </div>
    </>
  );
}
