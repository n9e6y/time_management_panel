import { useCallback, useMemo, useState } from "react";
import Chart from "../components/Chart";
import GoalRows from "../components/GoalRows";
import { Card, MixBar, NotEnoughData, StatTile } from "../components/ui";
import { categoryBars, mixBars, subcategoryBars } from "../charts/options";
import {
  categoryRows, mixOverTime, periodDays, projectRows, subcategoryRows, totals, withDeltas, UNLOGGED, type Ctx,
} from "../lib/aggregate";
import { fmtDay, fmtHours, fmtPct, fmtRange } from "../lib/format";
import { goalsTakeaway } from "../lib/goals";
import { o1Takeaway, o2Takeaway, o3Takeaway, o4Takeaway } from "../lib/takeaway";
import type { Block, GoalsProgress } from "../lib/types";

interface Props {
  ctx: Ctx;
  /** The same analysis for the previous period, when the calendar reaches that far back. */
  previous: Ctx | null;
  /** Why there is no previous period, for the captions. */
  noPrevious: string | null;
  /** Goals measured over the week and month happening now; null while they load or with no calendar. */
  goals: GoalsProgress | null;
  onOpenSettings: () => void;
  onShowBlocks: (title: string, blocks: Block[]) => void;
  onUsePreset: (preset: string) => void;
}

/** "Where did my time go, and how did that change?" (ux-v2 page-overview.md) */
export default function Overview({ ctx, previous, noPrevious, goals, onOpenSettings, onShowBlocks, onUsePreset }: Props) {
  const { analysis, settings } = ctx;
  const t = useMemo(() => totals(ctx), [ctx]);
  const prevTotals = useMemo(() => (previous ? totals(previous) : null), [previous]);
  const days = useMemo(() => periodDays(ctx), [ctx]);
  const rows = useMemo(() => {
    const own = categoryRows(ctx);
    return previous ? withDeltas(own, categoryRows(previous)) : own;
  }, [ctx, previous]);

  const firstWithTime = rows.find((r) => r.key !== UNLOGGED && r.hours > 0)?.key ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && rows.some((r) => r.key === picked && r.hours > 0) ? picked : firstWithTime;
  const [only, setOnly] = useState<string>("");  // O3: all categories, or just one

  const subRows = useMemo(() => (selected ? subcategoryRows(ctx, selected) : []), [ctx, selected]);
  const mix = useMemo(() => mixOverTime(ctx, only || null), [ctx, only]);
  const projects = useMemo(() => projectRows(ctx), [ctx]);

  const o1 = useMemo(() => categoryBars(rows, settings, selected, !!previous || !!noPrevious), [rows, settings, selected, previous, noPrevious]);
  const o2 = useMemo(() => (selected ? subcategoryBars(subRows, selected, settings) : null), [subRows, selected, settings]);
  const o3 = useMemo(() => ("notEnough" in mix ? null : mixBars(mix, settings, only || null)), [mix, settings, only]);

  const blocksOf = useCallback((category: string) => analysis.blocks.filter((b) => b.category === category), [analysis]);
  const onO1Click = useCallback((e: { name: string }) => {
    if (e.name === UNLOGGED) return;
    setPicked(e.name);
  }, []);
  const choices = Object.keys(settings.categories).filter((c) => rows.some((r) => r.key === c && r.hours > 0));

  if (analysis.segments.length === 0) {
    return (
      <NotEnoughData
        first={`No logged time between ${analysis.range.first_day} and ${analysis.range.last_day}.`}
        second={analysis.calendar.first_day ? `Your calendar file covers ${fmtRange(analysis.calendar.first_day, analysis.calendar.last_day!)}.` : "The calendar file has no events."}
        action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>}
      />
    );
  }

  const goalBlocks = useCallback((scope: string) => {
    const [category, sub] = scope.split(":").map((part) => part.trim());
    return analysis.blocks.filter((b) => b.category.toUpperCase() === category.toUpperCase()
      && (!sub || b.subcategories.some((s) => s.toLowerCase() === sub.toLowerCase())));
  }, [analysis]);

  return (
    <>
      {goals && (
        <Card code="G" title="Is my time going where I want?" className="span2 goalcard"
          lede={goalsTakeaway(goals.goals)}
          controls={<button className="btn" onClick={onOpenSettings}>{goals.goals.length ? "Edit goals" : "Add a goal"}</button>}
          caption={goals.goals.length
            ? `Judged over this week and this calendar month, as of ${fmtDay(goals.as_of)}${goals.as_of !== goals.today ? " (the day your file was exported)" : ""}. `
              + "The line is the goal, the upright mark what is expected by now. Unlogged time never counts toward a goal."
            : undefined}>
          {goals.goals.length
            ? <GoalRows items={goals.goals} settings={settings}
                onShowBlocks={(item) => onShowBlocks(`Blocks counting toward ${item.scope} ${item.label}`, goalBlocks(item.scope))} />
            : <p className="faint">A goal is a category and an amount: at least 10 h of LEARN a week, at most 5 h of
              ME: scrolling. Add one in Settings and this card starts answering the question.</p>}
        </Card>
      )}
      <div className="tiles">
        <StatTile label="Logged" value={t.loggedHours.toFixed(1)} unit="h"
          context={`${fmtPct(t.loggedHours / t.denominatorHours, 0)} of ${fmtHours(t.denominatorHours)} available`}
          previous={prevTotals ? fmtPct(prevTotals.loggedHours / prevTotals.denominatorHours, 0) : null} />
        <StatTile label="Per day" value={t.avgPerDay.toFixed(1)} unit="h" context={`over ${t.fullDays} calendar days`}
          previous={prevTotals ? fmtHours(prevTotals.avgPerDay) : null} />
        <StatTile label="Focus sessions" value={String(t.focusSessions)}
          context={`blocks of ${settings.focus.min_minutes}+ min in focus categories`}
          previous={prevTotals ? String(prevTotals.focusSessions) : null} />
        <StatTile label="Blocks" value={String(t.blocks)} context={`${t.skipped} skipped`}
          previous={prevTotals ? String(prevTotals.blocks) : null} />
      </div>
      <div className="grid">
        <Card code="O1" title="Where did my time go, and what grew or shrank?" className="span2"
          lede={o1Takeaway(rows, !!previous)}
          controls={selected && <button className="btn" onClick={() => onShowBlocks(`${selected} blocks`, blocksOf(selected))}>Show {selected} blocks</button>}
          caption={<>
            {`Share of ${fmtHours(t.denominatorHours)}: ${t.fullDays} full days${days.todayInProgress ? " plus today's logged hours (today is in progress)" : ""}. Per day = full days only.`}
            {previous ? ` vs prev. = hours minus the ${fmtRange(previous.analysis.range.first_day, previous.analysis.range.last_day)} period; changes under 2 h are drawn without an arrow.` : ""}
            {noPrevious ? ` ${noPrevious}` : ""}
            {" Click a bar to see what it was made of."}
          </>}>
          <Chart label="Hours per category" height={Math.max(160, rows.length * 34)} option={o1} onClick={onO1Click} />
        </Card>
        <Card code="O2" title={`What was ${selected ?? "it"} made of?`}
          lede={selected ? o2Takeaway(subRows, selected) : undefined}
          caption={subRows.some((r) => r.estimated) ? "≈ hours come from titles split on \" - \", divided evenly: an estimate." : "Sub-categories ranked by hours."}>
          {o2 ? <Chart label={`Sub-categories of ${selected}`} height={Math.max(120, subRows.length * 32)} option={o2} />
            : <NotEnoughData first="Nothing logged yet." second="Pick a category with time in O1." />}
        </Card>
        <Card code="O3" title="How has my time changed over the period?" className="span2"
          lede={"notEnough" in mix ? undefined : o3Takeaway(mix, only || null)}
          controls={
            <label className="faint">Show{" "}
              <select className="select" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Categories in O3">
                <option value="">All categories</option>
                {choices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          }
          caption={"notEnough" in mix ? undefined
            : `Average hours per day in each ${mix.kind}; whole ${mix.kind}s add up to a full day. "part" marks a ${mix.kind} the period cuts short, "off" a day off. Dotted = after the export, never counted as unlogged.`}>
          {o3 && !("notEnough" in mix)
            ? <div className="scroll"><div style={{ minWidth: Math.max(560, mix.buckets.length * 26) }}><Chart label="Mix over time" height={280} option={o3} /></div></div>
            : <NotEnoughData first="One bucket only: choose a longer period to see change."
              second={`This period makes ${"notEnough" in mix ? mix.have : 0} bar(s).`}
              action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />}
        </Card>
        <Card code="O4" title="Which projects took my time, and from where?" className="span2"
          lede={projects.length ? o4Takeaway(projects, t) : undefined}
          caption={projects.length ? "Block hours, so they are not estimates. A block can carry two projects; it then counts in both rows, so rows can add up to more than the total." : undefined}>
          {projects.length ? (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Project</th><th className="num">Hours</th><th className="num">Share</th>
                    <th className="num">Active days</th><th>First – last</th><th>Category mix</th><th className="num">Blocks</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((r) => (
                    <tr key={r.project}>
                      <td>+{r.project}</td>
                      <td className="num">{fmtHours(r.hours)}</td>
                      <td className="num">{fmtPct(r.share, 1)}</td>
                      <td className="num">{r.activeDays}</td>
                      <td>{fmtRange(r.first, r.last)}</td>
                      <td><MixBar parts={r.mix} settings={settings} /></td>
                      <td className="num">
                        <button className="linkbtn" onClick={() => onShowBlocks(`+${r.project} blocks`, analysis.blocks.filter((b) => b.projects.includes(r.project)))}>
                          {r.blocks}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="faint">No +project tags in this period. Add <code>+name</code> to a title to track a project.</p>
          )}
        </Card>
      </div>
    </>
  );
}
