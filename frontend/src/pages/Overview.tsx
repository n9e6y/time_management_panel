import { useCallback, useMemo, useRef, useState } from "react";
import GoalRows from "../components/GoalRows";
import { Card, NotEnoughData, SectionHead, StatTile, useDismiss } from "../components/ui";
import { CategoryTable, PartsBars } from "../charts/CategoryTable";
import MixChart from "../charts/MixChart";
import ProjectTable from "../charts/ProjectTable";
import {
  averageDay, categoryRows, coverage, mixOverTime, periodDays, projectRows, projectTrendKind, subcategoryRows, totals,
  withDeltas, UNLOGGED, type Ctx,
} from "../lib/aggregate";
import { fmtDay, fmtHours, fmtPct, fmtRange, fmtSpan } from "../lib/format";
import { pct } from "../lib/geometry";
import { goalsHeadline, goalsTally } from "../lib/goals";
import { o1Takeaway, o2Takeaway, o3Takeaway, o4Takeaway } from "../lib/takeaway";
import { fillOf, useCompact } from "../lib/theme";
import type { Block, GoalsProgress } from "../lib/types";

interface Props {
  ctx: Ctx;
  /** The same analysis for the previous period, when the calendar reaches that far back. */
  previous: Ctx | null;
  /** Why there is no previous period, for the captions. */
  noPrevious: string | null;
  /** Goals measured over the week and month happening now; null while they load or with no calendar. */
  goals: GoalsProgress | null;
  /** "Last 30 days", "This month", "Custom range": the stats band's heading. */
  periodLabel: string;
  onOpenSettings: () => void;
  onShowBlocks: (title: string, blocks: Block[]) => void;
  onUsePreset: (preset: string) => void;
}

const monthName = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

/** "Is my time going where I want?" and "Where did it go, and how did that change?" (new-ui Overview). */
export default function Overview({ ctx, previous, noPrevious, goals, periodLabel, onOpenSettings, onShowBlocks, onUsePreset }: Props) {
  const { analysis, settings } = ctx;
  const compact = useCompact();
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
  const average = useMemo(() => averageDay(ctx, "calendar")[0] ?? null, [ctx]);
  const projects = useMemo(() => projectRows(ctx), [ctx]);
  const spark = useMemo(() => coverage(ctx).filter((d) => !d.partial && !d.notInFile), [ctx]);

  const blocksOf = useCallback((category: string) => analysis.blocks.filter((b) => b.category === category), [analysis]);
  const goalBlocks = useCallback((scope: string) => {
    const [category, sub] = scope.split(":").map((part) => part.trim());
    return analysis.blocks.filter((b) => b.category.toUpperCase() === category.toUpperCase()
      && (!sub || b.subcategories.some((s) => s.toLowerCase() === sub.toLowerCase())));
  }, [analysis]);
  const choices = Object.keys(settings.categories).filter((c) => rows.some((r) => r.key === c && r.hours > 0));
  const { first_day: first, last_day: last } = analysis.range;

  return (
    <>
      <section className="hero">
        {goals && <GoalsPanel goals={goals} settings={settings} onOpenSettings={onOpenSettings}
          onShowBlocks={(item) => onShowBlocks(`Blocks counting toward ${item.scope} ${item.label}`, goalBlocks(item.scope))} />}
        <div className="band" role="region" aria-label={`${periodLabel} in numbers`}>
          <div className="band-head">
            <span className="eyebrow strong">{periodLabel}</span>
            <span className="sub">
              {fmtSpan(first, last)}
              {previous ? ` · prev. = ${fmtSpan(previous.analysis.range.first_day, previous.analysis.range.last_day)}` : " · nothing earlier to compare with"}
            </span>
          </div>
          <div className="stats">
            <StatTile label="Logged" value={t.loggedHours.toFixed(1)} unit="h"
              context={`${fmtPct(t.denominatorHours ? t.loggedHours / t.denominatorHours : 0, 0)} of ${fmtHours(t.denominatorHours)} available`}
              previous={prevTotals ? fmtPct(prevTotals.denominatorHours ? prevTotals.loggedHours / prevTotals.denominatorHours : 0, 0) : null}>
              <div className="meter6"><span style={{ width: pct(t.denominatorHours ? t.loggedHours / t.denominatorHours : 0) }} /></div>
            </StatTile>
            <StatTile label="Per day" value={t.avgPerDay.toFixed(1)} unit="h" context={`over ${t.fullDays} calendar days`}
              previous={prevTotals ? fmtHours(prevTotals.avgPerDay) : null}>
              {spark.length > 1 && (
                <div className="spark" role="img" aria-label="Logged share of each full day">
                  {spark.map((d) => <span key={d.day} title={`${fmtDay(d.day)}: ${fmtHours(d.hours)}`} style={{ height: pct(Math.min(1, d.share)) }} />)}
                </div>
              )}
            </StatTile>
            <StatTile label="Focus sessions" value={String(t.focusSessions)}
              context={`blocks of ${settings.focus.min_minutes}+ min in focus categories`}
              previous={prevTotals ? String(prevTotals.focusSessions) : null} />
            <StatTile label="Blocks" value={String(t.blocks)} context={`${t.skipped} skipped`}
              previous={prevTotals ? String(prevTotals.blocks) : null} />
          </div>
        </div>
      </section>

      {analysis.segments.length === 0 ? (
        <div style={{ marginTop: 32 }}>
          <NotEnoughData
            first={`No logged time between ${fmtDay(first)} and ${fmtDay(last)}.`}
            second={analysis.calendar.first_day ? `Your calendar file covers ${fmtRange(analysis.calendar.first_day, analysis.calendar.last_day!)}.` : "The calendar file has no events."}
            action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>}
          />
        </div>
      ) : (
        <>
          <SectionHead title="Where it went" note={fmtRange(first, last)} />
          <div className="grid o12">
            <Card code="O1" title="Where did my time go, and what grew or shrank?"
              lede={o1Takeaway(rows, !!previous)}
              controls={selected && <button className="btn" onClick={() => onShowBlocks(`${selected} blocks`, blocksOf(selected))}>Show {selected} blocks</button>}
              caption={<>
                {`Share of ${fmtHours(t.denominatorHours)}: ${t.fullDays} full days${days.todayInProgress ? " plus today's logged hours (today is in progress)" : ""}. Per day = full days only.`}
                {previous ? ` vs prev. = hours minus the ${fmtRange(previous.analysis.range.first_day, previous.analysis.range.last_day)} period; changes under 2 h are drawn without an arrow.` : ""}
                {noPrevious ? ` ${noPrevious}` : ""}
                {" Click a bar to see what it was made of."}
              </>}>
              <CategoryTable rows={rows} settings={settings} selected={selected} comparable={!!previous || !!noPrevious} onSelect={setPicked} />
            </Card>
            <Card code="O2" title={`What was ${selected ?? "it"} made of?`} dot={selected ? fillOf(selected, settings) : undefined}
              lede={selected ? o2Takeaway(subRows, selected) : undefined}
              caption={subRows.some((r) => r.estimated) ? "≈ hours come from titles split on \" - \", divided evenly: an estimate." : "Sub-categories ranked by hours."}>
              {selected && subRows.length ? <PartsBars rows={subRows} category={selected} settings={settings} />
                : <NotEnoughData first="Nothing logged yet." second="Pick a category with time in the table." />}
            </Card>
          </div>

          <SectionHead title="How it changed" note={"notEnough" in mix ? undefined : `one bar per ${mix.kind}`} />
          <Card code="O3" title="How has my time changed over the period?"
            lede={"notEnough" in mix ? undefined : o3Takeaway(mix, only || null)}
            controls={<CategoryPicker value={only} choices={choices} onChange={setOnly} settings={settings} />}
            caption={"notEnough" in mix ? undefined : only
              ? `${only} hours per day${mix.kind === "day" ? "" : `, averaged over each ${mix.kind}`}; the dashed line is the period average.${mix.kind === "day" ? " \"off\" marks a day off." : ""}`
              : `Hours per day${mix.kind === "day" ? "" : `, averaged over each ${mix.kind}`}; each full day adds up to 24 h. avg = the period's average day. Hatched = unlogged (inside the file, nothing logged). Dotted = not yet or not in this file, never counted as unlogged.${mix.kind === "day" ? " \"off\" marks a day off." : ""}`}>
            {"notEnough" in mix
              ? <NotEnoughData first="One bucket only: choose a longer period to see change."
                second={`This period makes ${mix.have} bar.`}
                action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />
              : <MixChart mix={mix} average={average} category={only || null} settings={settings} days={days} today={ctx.today} compact={compact} />}
          </Card>

          <SectionHead title="Projects" note="+project tags" />
          <Card code="O4" title="Which projects took my time, and from where?"
            lede={projects.length ? o4Takeaway(projects) : undefined}
            caption={projects.length ? "Block hours, so they are not estimates. A block can carry two projects; it then counts in both rows, so rows can add up to more than the total." : undefined}>
            {projects.length
              ? <ProjectTable rows={projects} settings={settings} trendKind={projectTrendKind(days.all.length)}
                onShowBlocks={(r) => onShowBlocks(`+${r.project} blocks`, analysis.blocks.filter((b) => b.projects.includes(r.project)))} />
              : <p className="faint">No +project tags in this period. Add <code>+name</code> to a title to track a project.</p>}
          </Card>
        </>
      )}
    </>
  );
}

/** The goal half of the hero: verdict, tally and Edit on the left, the rows on the right. */
function GoalsPanel({ goals, settings, onOpenSettings, onShowBlocks }: {
  goals: GoalsProgress; settings: Ctx["settings"]; onOpenSettings: () => void;
  onShowBlocks: (item: GoalsProgress["goals"][number]) => void;
}) {
  const { head, rest } = goalsHeadline(goals.goals);
  const spans = [
    goals.goals.some((g) => g.every === "week") && "this week",
    goals.goals.some((g) => g.every === "month") && monthName(goals.goals.find((g) => g.every === "month")!.first_day),
  ].filter(Boolean).join(" and ");
  return (
    <div className="hero-top" role="region" aria-label="Is my time going where I want?">
      <div className="hero-left">
        <div className="intro">
          <div className="eyebrow">Is my time going where I want?</div>
          <div className="sub">Goals{spans ? ` · ${spans}` : ""}</div>
        </div>
        <h1>{head}{rest && <>{" "}<span className="rest">{rest}</span></>}</h1>
        {goals.goals.length > 0 && (
          <div className="tally">
            {goalsTally(goals.goals).map((row) => (
              <div key={row.tone}>
                <span className={`glyph st-${row.tone}`} aria-hidden="true">{row.glyph}</span>
                <span className="n">{row.n}</span><span className="word">{row.word}</span>
              </div>
            ))}
          </div>
        )}
        <div className="bottom">
          <div><button className="btn" onClick={onOpenSettings}>{goals.goals.length ? "Edit goals" : "Add a goal"}</button></div>
        </div>
      </div>
      <div className="hero-right">
        {goals.goals.length ? (
          <>
            <GoalRows items={goals.goals} settings={settings} asOf={goals.as_of} onShowBlocks={onShowBlocks} />
            <div className="goal-key">
              <span><span className="k-logged" />logged</span>
              <span><span className="k-goal" />goal</span>
              <span><span className="k-expected" />expected by now</span>
              <span><span className="k-rate" />at this rate</span>
              <p className="caption">
                {`Judged over this week and this calendar month, as of ${fmtDay(goals.as_of)}${goals.as_of !== goals.today ? " (the day your file was exported)" : ""}. `}
                The line is the goal, the upright mark what is expected by now. Unlogged time never counts toward a goal. Click a row for the blocks that counted.
              </p>
            </div>
          </>
        ) : (
          <p className="goal-empty">A goal is a category and an amount: at least 10 h of LEARN a week, at most 5 h of
            ME: scrolling. Add one in Settings and this panel starts answering the question.</p>
        )}
      </div>
    </div>
  );
}

/** O3's "Show ● All categories ▾" picker. */
function CategoryPicker({ value, choices, onChange, settings }: {
  value: string; choices: string[]; onChange: (v: string) => void; settings: Ctx["settings"];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const dot = (key: string) => (key ? fillOf(key, settings) : "var(--text-3)");
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="pick" aria-expanded={open} aria-label="Categories in O3" onClick={() => setOpen(!open)}>
        <span className="muted">Show</span><span className="dot8" style={{ background: dot(value) }} />
        <b>{value || "All categories"}</b><span className="caret">▾</span>
      </button>
      {open && (
        <div className="listbox" role="listbox" aria-label="Categories in O3">
          {["", ...choices].map((key) => (
            <button key={key || "all"} role="option" aria-selected={value === key} onClick={() => { onChange(key); setOpen(false); }}>
              <span className="dot8" style={{ background: dot(key) }} />{key || "All categories"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
