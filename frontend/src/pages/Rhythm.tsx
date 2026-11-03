import { useCallback, useMemo, useState } from "react";
import Chart from "../components/Chart";
import { Card, NotEnoughData, SectionLabel, Segmented, StatTile } from "../components/ui";
import { averageDayBars, dayProbabilityArea, lifeBarcode, sleepActogram, weekdayHeat } from "../charts/options";
import {
  averageDay, barcode, dayProbability, sleepCategory, sleepNights, weekdayHeatmap, MIN_DAYS_R5, MIN_NIGHTS_R4,
  NIGHT_START_HOUR, type Ctx, type DayType, type Denominator,
} from "../lib/aggregate";
import { fmtClock, fmtDay } from "../lib/format";
import { addDays, minutesOfDay } from "../lib/time";
import { r1Takeaway, r2Takeaway, r3Takeaway, r4Takeaway, r5Takeaway } from "../lib/takeaway";
import type { Block } from "../lib/types";

interface Props {
  ctx: Ctx;
  onShowBlocks: (title: string, blocks: Block[]) => void;
  onUsePreset: (preset: string) => void;
}

/** "When do things happen in my day, my week and my nights?" (ux-v2 page-rhythm.md) */
export default function Rhythm({ ctx, onShowBlocks, onUsePreset }: Props) {
  const { analysis, settings } = ctx;
  const [denominator, setDenominator] = useState<Denominator>("calendar");
  const [dayType, setDayType] = useState<DayType>("All days");

  const avg = useMemo(() => averageDay(ctx, denominator), [ctx, denominator]);
  const probability = useMemo(() => dayProbability(ctx, dayType), [ctx, dayType]);
  const heat = useMemo(() => weekdayHeatmap(ctx), [ctx]);
  const sleepName = useMemo(() => sleepCategory(ctx), [ctx]);
  const nights = useMemo(() => sleepNights(ctx), [ctx]);
  const days = useMemo(() => barcode(ctx), [ctx]);

  const r1 = useMemo(() => averageDayBars(avg, settings), [avg, settings]);
  const r2 = useMemo(() => ("notEnough" in probability ? null : dayProbabilityArea(probability, settings)), [probability, settings]);
  const r3 = useMemo(() => ("notEnough" in heat ? null : weekdayHeat(heat)), [heat]);
  const r4 = useMemo(() => ("notEnough" in nights ? null : sleepActogram(nights, settings)), [nights, settings]);
  const r5 = useMemo(() => ("notEnough" in days ? null : lifeBarcode(days, settings)), [days, settings]);

  /** The blocks of one night: after 18:00 on that date, or before 18:00 on the next. */
  const nightBlocks = useCallback((day: string) => analysis.blocks.filter((b) => {
    if (b.category !== sleepName) return false;
    const date = b.start_local.slice(0, 10);
    const evening = minutesOfDay(b.start_local) >= NIGHT_START_HOUR * 60;
    return (date === day && evening) || (date === addDays(day, 1) && !evening);
  }), [analysis, sleepName]);

  const onNightClick = useCallback((e: { data?: unknown }) => {
    const night = (e.data as { night?: string } | undefined)?.night;
    if (night) onShowBlocks(`Blocks of the night of ${fmtDay(night)}`, nightBlocks(night));
  }, [nightBlocks, onShowBlocks]);

  const disabledTypes = Object.fromEntries((["Workday", "Day off"] as DayType[])
    .map((type) => [type, dayProbability(ctx, type)])
    .filter(([, r]) => typeof r === "object" && "notEnough" in r)
    .map(([type, r]) => [type, `Needs ${(r as { need: number }).need} days of this type; the period has ${(r as { have: number }).have}.`]));

  if (analysis.segments.length === 0) {
    return (
      <NotEnoughData first={`No logged time between ${analysis.range.first_day} and ${analysis.range.last_day}.`}
        second="Rhythm needs logged blocks to show when things happen."
        action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>} />
    );
  }

  const clock = (hoursAfterSix: number | null) => (hoursAfterSix === null ? "—" : fmtClock(NIGHT_START_HOUR + hoursAfterSix));

  return (
    <>
      <SectionLabel>Day</SectionLabel>
      <div className="grid">
        <Card code="R1" title="What does an average day look like, and do my days off differ?" className="span2"
          lede={r1Takeaway(avg)}
          controls={<Segmented<Denominator> options={["calendar", "logged"]} value={denominator} onChange={setDenominator} />}
          caption={denominator === "calendar" ? "Divided by every calendar day of that type (unlogged days lower the average)." : "Divided only by days with something logged."}>
          <Chart label="Average day" height={190} option={r1} />
          {avg.some((r) => r.days > 0 && r.days < 5) && <div className="caption">⚠ Rows with fewer than 5 days are rough.</div>}
        </Card>
        <Card code="R2" title="When in the day does each thing happen?" className="span2"
          lede={"notEnough" in probability ? undefined : r2Takeaway(probability)}
          controls={<Segmented<DayType> options={["All days", "Workday", "Day off"]} value={dayType} onChange={setDayType} disabled={disabledTypes} />}
          caption={"notEnough" in probability ? undefined : `Share of ${probability.days} days in each 15-minute slot.`}>
          {r2 ? <Chart label="Time of day" height={300} option={r2} />
            : <NotEnoughData first="Time of day needs at least 7 days." second={`This choice has ${"notEnough" in probability ? probability.have : 0}.`} action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />}
        </Card>
      </div>

      <SectionLabel>Week</SectionLabel>
      <div className="grid">
        <Card code="R3" title="Which days of my week carry which activity?" className="span2"
          lede={"notEnough" in heat ? undefined : r3Takeaway(heat)}
          caption={"notEnough" in heat ? undefined : `Average hours per weekday, weeks starting ${settings.week_start}.`}>
          {r3 && !("notEnough" in heat)
            ? <div className="scroll"><div style={{ minWidth: 560 }}><Chart label="Weekday heatmap" height={60 + heat.rows.length * 34} option={r3} /></div></div>
            : <NotEnoughData first="Weekday pattern needs each weekday at least twice (14 days)." second={`This period has ${"notEnough" in heat ? heat.have : 0} full days.`} action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />}
        </Card>
      </div>

      <SectionLabel>Nights</SectionLabel>
      <div className="grid">
        <Card code="R4" title="When do I sleep, and how regular is it?" className="span2"
          lede={"notEnough" in nights ? undefined : r4Takeaway(nights)}
          caption={"notEnough" in nights ? undefined
            : `Each row is the night that starts on that date, 18:00 to 18:00. Only ${nights.category} blocks; naps are drawn thin.`
              + ` ${nights.withSleep} nights with sleep${nights.empty.length ? `, ${nights.empty.length} complete night(s) with none (${nights.empty.map(fmtDay).join(", ")})` : ""}.`
              + " Bedtime and wake are the night's first start and last end, approximate until the main-sleep rule (Stage 5)."}>
          {r4 && !("notEnough" in nights) ? (
            <>
              <div className="scroll"><div style={{ minWidth: 520 }}>
                <Chart label="Sleep actogram" height={Math.max(220, nights.nights.length * 14 + 60)} option={r4}
                  onClick={onNightClick} />
              </div></div>
              <div className="tiles four">
                <StatTile label="Median bedtime" value={clock(nights.medians.bedtime)}
                  context={nights.medians.bedtimeDayOff === null ? undefined : `days off ${clock(nights.medians.bedtimeDayOff)}`} />
                <StatTile label="Median wake" value={clock(nights.medians.wake)}
                  context={nights.medians.wakeDayOff === null ? undefined : `days off ${clock(nights.medians.wakeDayOff)}`} />
                <StatTile label="Median sleep" value={nights.medians.hours === null ? "—" : nights.medians.hours.toFixed(1)}
                  unit={nights.medians.hours === null ? undefined : "h"} context="per complete night" />
                <StatTile label="Bedtime spread" value="—" context="Stage 5 (standard deviation)" />
              </div>
            </>
          ) : (
            <NotEnoughData
              first={sleepName === null ? "No sleep category in your settings."
                : `The sleep actogram needs ${MIN_NIGHTS_R4} nights with sleep.`}
              second={sleepName === null
                ? "If you log sleep under another name, rename it in Settings or check Data quality."
                : `This period has ${"notEnough" in nights ? nights.have : 0}.`}
              action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />
          )}
        </Card>
      </div>

      <SectionLabel>Months</SectionLabel>
      <div className="grid">
        <Card code="R5" title="How did my days look across months?" className="span2"
          lede={"notEnough" in days ? undefined : r5Takeaway(days)}
          caption={"notEnough" in days ? undefined
            : "One column per day, 00:00 at the top. Days off have a tinted column; days after the export are dotted. An overview, not a chart to read values from: hover a column for its day."}>
          {r5 && !("notEnough" in days)
            ? <div className="scroll"><div style={{ minWidth: Math.max(560, days.length * 7) }}><Chart label="Life barcode" height={260} option={r5} /></div></div>
            : <NotEnoughData first={`The life barcode needs ${MIN_DAYS_R5} days or more.`}
              second={`This period has ${"notEnough" in days ? days.have : 0}.`}
              action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>} />}
        </Card>
      </div>
    </>
  );
}
