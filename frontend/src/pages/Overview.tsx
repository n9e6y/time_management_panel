import { useCallback, useMemo, useState } from "react";
import Chart from "../components/Chart";
import { Card, NotEnoughData, Segmented, StatTile } from "../components/ui";
import { averageDayBars, categoryBars, dayProbabilityArea, subcategoryBars, weekdayHeat } from "../charts/options";
import {
  averageDay, categoryRows, dayProbability, periodDays, subcategoryRows, totals, weekdayHeatmap, UNLOGGED, type Ctx, type DayType,
  type Denominator,
} from "../lib/aggregate";
import { fmtHours, fmtPct } from "../lib/format";
import type { Block } from "../lib/types";

interface Props {
  ctx: Ctx;
  onShowBlocks: (title: string, blocks: Block[]) => void;
  onUsePreset: (preset: string) => void;
}

export default function Overview({ ctx, onShowBlocks, onUsePreset }: Props) {
  const { analysis, settings } = ctx;
  const t = useMemo(() => totals(ctx), [ctx]);
  const days = useMemo(() => periodDays(ctx), [ctx]);
  const rows = useMemo(() => categoryRows(ctx), [ctx]);
  const firstWithTime = rows.find((r) => r.key !== UNLOGGED && r.hours > 0)?.key ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && rows.some((r) => r.key === picked && r.hours > 0) ? picked : firstWithTime;
  const [denominator, setDenominator] = useState<Denominator>("calendar");
  const [dayType, setDayType] = useState<DayType>("All days");

  const subRows = useMemo(() => (selected ? subcategoryRows(ctx, selected) : []), [ctx, selected]);
  const avg = useMemo(() => averageDay(ctx, denominator), [ctx, denominator]);
  const probability = useMemo(() => dayProbability(ctx, dayType), [ctx, dayType]);
  const heat = useMemo(() => weekdayHeatmap(ctx), [ctx]);

  const o1 = useMemo(() => categoryBars(rows, settings, selected), [rows, settings, selected]);
  const o2 = useMemo(() => (selected ? subcategoryBars(subRows, selected, settings) : null), [subRows, selected, settings]);
  const o3 = useMemo(() => averageDayBars(avg, settings), [avg, settings]);
  const o4 = useMemo(() => ("notEnough" in probability ? null : dayProbabilityArea(probability, settings)), [probability, settings]);
  const o5 = useMemo(() => ("notEnough" in heat ? null : weekdayHeat(heat)), [heat]);

  const blocksOf = useCallback((category: string) => analysis.blocks.filter((b) => b.category === category), [analysis]);
  const onO1Click = useCallback((e: { name: string }) => {
    if (e.name === UNLOGGED) return;
    setPicked(e.name);
  }, []);
  const disabledTypes = Object.fromEntries((["Workday", "Day off"] as DayType[])
    .map((type) => [type, dayProbability(ctx, type)])
    .filter(([, r]) => typeof r === "object" && "notEnough" in r)
    .map(([type, r]) => [type, `Needs ${(r as { need: number }).need} days of this type; the period has ${(r as { have: number }).have}.`]));

  if (analysis.segments.length === 0) {
    return (
      <NotEnoughData
        first={`No logged time between ${analysis.range.first_day} and ${analysis.range.last_day}.`}
        second={analysis.calendar.first_day ? `Your calendar file covers ${analysis.calendar.first_day} to ${analysis.calendar.last_day}.` : "The calendar file has no events."}
        action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>}
      />
    );
  }

  return (
    <>
      <div className="tiles">
        <StatTile label="Logged" value={t.loggedHours.toFixed(1)} unit="h" context={`${fmtPct(t.loggedHours / t.denominatorHours, 0)} of ${fmtHours(t.denominatorHours)} available`} />
        <StatTile label="Average per day" value={t.avgPerDay.toFixed(1)} unit="h" context={`over ${t.fullDays} calendar days`} />
        <StatTile label="Focus sessions" value={String(t.focusSessions)} context={`blocks of ${settings.focus.min_minutes}+ min in focus categories`} />
        <StatTile label="Blocks" value={String(t.blocks)} context={`${t.skipped} skipped`} />
      </div>
      <div className="grid">
        <Card code="O1" title="Where did my time go?" className="span2"
          controls={selected && <button className="btn" onClick={() => onShowBlocks(`${selected} blocks`, blocksOf(selected))}>Show {selected} blocks</button>}
          caption={`Share of ${fmtHours(t.denominatorHours)}: ${t.fullDays} full days${days.todayInProgress ? " plus today's logged hours (today is in progress)" : ""}. Per day = full days only. Click a bar to see what it was made of.`}>
          <Chart label="Hours per category" height={Math.max(160, rows.length * 34)} option={o1} onClick={onO1Click} />
        </Card>
        <Card code="O2" title={`What was ${selected ?? "it"} made of?`}
          caption={subRows.some((r) => r.estimated) ? "≈ hours come from titles split on \" - \", divided evenly: an estimate." : "Sub-categories ranked by hours."}>
          {o2 ? <Chart label={`Sub-categories of ${selected}`} height={Math.max(120, subRows.length * 32)} option={o2} />
            : <NotEnoughData first="Nothing logged yet." second="Pick a category with time in O1." />}
        </Card>
        <Card code="O3" title="What does an average day look like?"
          controls={<Segmented<Denominator> options={["calendar", "logged"]} value={denominator} onChange={setDenominator} />}
          caption={denominator === "calendar" ? "Divided by every calendar day of that type (unlogged days lower the average)." : "Divided only by days with something logged."}>
          <Chart label="Average day" height={190} option={o3} />
          {avg.some((r) => r.days > 0 && r.days < 7) && <div className="caption">⚠ Rows with fewer than 7 days are rough.</div>}
        </Card>
        <Card code="O4" title="When in the day does each thing happen?" className="span2"
          controls={<Segmented<DayType> options={["All days", "Workday", "Day off"]} value={dayType} onChange={setDayType} disabled={disabledTypes} />}
          caption={"notEnough" in probability ? undefined : `Share of ${probability.days} days in each 15-minute slot.`}>
          {o4 ? <Chart label="Time of day" height={300} option={o4} />
            : <NotEnoughData first="Time of day needs at least 7 days." second={`This choice has ${"notEnough" in probability ? probability.have : 0}.`} action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />}
        </Card>
        <Card code="O5" title="Which days of my week carry which activity?" className="span2"
          caption={"notEnough" in heat ? undefined : `Average hours per weekday, weeks starting ${settings.week_start}.`}>
          {o5 ? <div className="scroll"><div style={{ minWidth: 560 }}><Chart label="Weekday heatmap" height={60 + ("notEnough" in heat ? 0 : heat.rows.length * 34)} option={o5} /></div></div>
            : <NotEnoughData first="Weekday pattern needs each weekday at least twice (14 days)." second={`This period has ${"notEnough" in heat ? heat.have : 0} full days.`} action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />}
        </Card>
      </div>
    </>
  );
}
