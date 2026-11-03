import { useCallback, useMemo, useState } from "react";
import { Card, NotEnoughData, SectionHead, Segmented, StatTile } from "../components/ui";
import Actogram from "../charts/Actogram";
import AverageDay, { ROUGH_DAYS, smallParts } from "../charts/AverageDay";
import Barcode from "../charts/Barcode";
import DayArea from "../charts/DayArea";
import WeekHeat from "../charts/WeekHeat";
import {
  averageDay, barcode, dayProbability, periodDays, sleepCategory, sleepNights, weekdayHeatmap, MIN_DAYS_O4, MIN_DAYS_R5,
  MIN_NIGHTS_R4, NIGHT_START_HOUR, type Ctx, type DayType, type Denominator,
} from "../lib/aggregate";
import { fmtClock, fmtDay, fmtRange, fmtWeekdays } from "../lib/format";
import { addDays, minutesOfDay } from "../lib/time";
import { r1Second, r1Takeaway, r2Takeaway, r3Takeaway, r4Takeaway, r5Takeaway } from "../lib/takeaway";
import { useCompact } from "../lib/theme";
import type { Block } from "../lib/types";

interface Props {
  ctx: Ctx;
  onShowBlocks: (title: string, blocks: Block[]) => void;
  onUsePreset: (preset: string) => void;
}

const DAY_TYPES: DayType[] = ["All days", "Workday", "Day off"];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "When do things happen in my day, my week and my nights?" (new-ui Rhythm). */
export default function Rhythm({ ctx, onShowBlocks, onUsePreset }: Props) {
  const { analysis, settings } = ctx;
  const compact = useCompact();
  const [denominator, setDenominator] = useState<Denominator>("calendar");
  const [dayType, setDayType] = useState<DayType>("All days");

  const days = useMemo(() => periodDays(ctx), [ctx]);
  const avg = useMemo(() => averageDay(ctx, denominator), [ctx, denominator]);
  const sameBars = useMemo(() => {
    const [a, b] = [averageDay(ctx, "calendar"), averageDay(ctx, "logged")];
    return a.every((row, i) => row.days === b[i].days);
  }, [ctx]);
  const probability = useMemo(() => dayProbability(ctx, dayType), [ctx, dayType]);
  const heat = useMemo(() => weekdayHeatmap(ctx), [ctx]);
  const sleepName = useMemo(() => sleepCategory(ctx), [ctx]);
  const nights = useMemo(() => sleepNights(ctx), [ctx]);
  const barDays = useMemo(() => barcode(ctx), [ctx]);
  const notInFile = useMemo(() => new Set(days.notInFile), [days]);

  /** The blocks of one night: after 18:00 on that date, or before 18:00 on the next. */
  const nightBlocks = useCallback((day: string) => analysis.blocks.filter((b) => {
    if (b.category !== sleepName) return false;
    const date = b.start_local.slice(0, 10);
    const evening = minutesOfDay(b.start_local) >= NIGHT_START_HOUR * 60;
    return (date === day && evening) || (date === addDays(day, 1) && !evening);
  }), [analysis, sleepName]);

  const disabledTypes = useMemo(() => Object.fromEntries((["Workday", "Day off"] as DayType[])
    .map((type) => [type, dayProbability(ctx, type)] as const)
    .filter(([, r]) => "notEnough" in r)
    .map(([type, r]) => [type, `Needs ${MIN_DAYS_O4} days of this type; the period has ${"have" in r ? r.have : 0}.`])), [ctx]);

  const [all, workday, dayOff] = avg;
  const keys = smallParts(avg, compact ? 0.12 : 0.08);
  const offNames = settings.days_off;
  const clock = (hoursAfterSix: number | null) => (hoursAfterSix === null ? "—" : fmtClock(NIGHT_START_HOUR + hoursAfterSix));
  const head = r1Takeaway(avg);
  const second = r1Second(avg);

  return (
    <>
      <section className="hero">
        <div className="hero-top" role="region" aria-label="What does an average day look like, and do my days off differ?">
          <div className="hero-left">
            <div className="intro">
              <div className="eyebrow">What does an average day look like?</div>
              <div className="sub">
                Average day · {all.days} full {plural(all.days, "day", "days")} · {offNames.length ? `days off are ${fmtWeekdays(offNames)}` : "no days off set"}
              </div>
            </div>
            <h1>{head}{second && <>{" "}<span className="rest">{second}</span></>}</h1>
            <div className="bottom">
              <span className="label">Divide by</span>
              <Segmented<Denominator> label="Average over" options={["calendar", "logged"]} value={denominator} onChange={setDenominator}
                labels={{ calendar: "Calendar days", logged: "Logged days" }} />
            </div>
          </div>
          <div className="hero-right">
            <div className="head"><span className="eyebrow strong">Hours of an average day</span><span>each bar adds up to 24 h</span></div>
            <AverageDay rows={avg} settings={settings} compact={compact} />
            <div className="note">
              {denominator === "calendar" ? "Divided by every calendar day of that type (unlogged days lower the average)." : "Divided only by days with something logged."}
              {sameBars ? " Every full day in this period has something logged, so both choices give the same bars." : ""}
              {avg.some((r) => r.days > 0 && r.days < ROUGH_DAYS) ? ` Rows with fewer than ${ROUGH_DAYS} days are rough.` : ""}
              {keys.length ? " Small parts (key above) read all days · workday · day off." : ""}
            </div>
          </div>
        </div>
        <div className="band" role="region" aria-label="Nights in numbers">
          <div className="band-head">
            <span className="eyebrow strong">Nights</span>
            <span className="sub">
              {"notEnough" in nights ? "night = 18:00 to 18:00"
                : `${nights.nights.filter((n) => !n.incomplete && n.bars.length).length} complete nights · night = 18:00 to 18:00`}
            </span>
          </div>
          {"notEnough" in nights ? (
            <div className="notice-line">
              {sleepName === null ? "No sleep category in your settings, so there are no night medians."
                : `Sleep medians need ${MIN_NIGHTS_R4} nights with sleep; this period has ${nights.have}.`}
            </div>
          ) : (
            <div className="stats">
              <StatTile label="Median bedtime" value={clock(nights.medians.bedtime)}
                context={nights.medians.bedtimeWorkday === null ? undefined : `workdays ${clock(nights.medians.bedtimeWorkday)}`}
                context2={nights.medians.bedtimeDayOff === null ? undefined : `days off ${clock(nights.medians.bedtimeDayOff)}`} />
              <StatTile label="Median wake" value={clock(nights.medians.wake)}
                context={nights.medians.wakeWorkday === null ? undefined : `workdays ${clock(nights.medians.wakeWorkday)}`}
                context2={nights.medians.wakeDayOff === null ? undefined : `days off ${clock(nights.medians.wakeDayOff)}`} />
              <StatTile label="Median sleep" value={nights.medians.hours === null ? "—" : nights.medians.hours.toFixed(1)}
                unit={nights.medians.hours === null ? undefined : "h"} context="per complete night" context2="naps not included" />
              <StatTile label="Days averaged" value={String(all.days)}
                context={`${workday.days} ${plural(workday.days, "workday", "workdays")} · ${dayOff.days} ${plural(dayOff.days, "day off", "days off")}`}
                context2={`full days only${days.todayInProgress ? "; today is in progress" : ""}`} />
            </div>
          )}
        </div>
      </section>

      {analysis.segments.length === 0 ? (
        <div style={{ marginTop: 32 }}>
          <NotEnoughData first={`No logged time between ${fmtDay(analysis.range.first_day)} and ${fmtDay(analysis.range.last_day)}.`}
            second="Rhythm needs logged blocks to show when things happen."
            action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>} />
        </div>
      ) : (
        <>
          <SectionHead title="Day" note="when things happen" />
          <Card code="R2" title="When in the day does each thing happen?"
            lede={"notEnough" in probability ? undefined : r2Takeaway(probability)}
            controls={<Segmented<DayType> label="Day type" options={DAY_TYPES} value={dayType} onChange={setDayType} disabled={disabledTypes} />}
            caption={"notEnough" in probability ? undefined
              : `Share of ${probability.days} days in each 15-minute slot; the bands add up to 100%. Hatched = unlogged. A day type needs ${MIN_DAYS_O4} days of its kind to draw.`}>
            {"notEnough" in probability
              ? <NotEnoughData first={`Time of day needs at least ${MIN_DAYS_O4} days.`} second={`This choice has ${probability.have}.`}
                action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />
              : <DayArea data={probability} settings={settings} />}
          </Card>

          <SectionHead title="Week" note={`weeks start on ${settings.week_start}`} />
          <Card code="R3" title="Which days of my week carry which activity?"
            lede={"notEnough" in heat ? undefined : r3Takeaway(heat)}
            caption={"notEnough" in heat ? undefined
              : "Average hours per weekday over full days. Each row has its own scale: the darkest cell is that row's busiest weekday, in bold."
                + (offNames.length ? ` ${fmtWeekdays(offNames)} ${plural(offNames.length, "is your day", "are your days")} off.` : "")}>
            {"notEnough" in heat
              ? <NotEnoughData first="Weekday pattern needs each weekday at least twice (14 days)." second={`This period has ${heat.have} full days.`}
                action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />
              : <div className="scroll"><div style={{ minWidth: compact ? 340 : 560 }}><WeekHeat data={heat} settings={settings} /></div></div>}
          </Card>

          <SectionHead title="Nights" note="18:00 to 18:00" />
          <Card code="R4" title="When do I sleep, and how regular is it?"
            lede={"notEnough" in nights ? undefined : r4Takeaway(nights)}
            caption={"notEnough" in nights ? undefined : (() => {
              const naps = nights.nights.reduce((a, n) => a + n.bars.filter((b) => !b.main).length, 0);
              return `Each row is the night that starts on that date, 18:00 to 18:00. Only ${nights.category} blocks; `
                + (naps ? `the ${naps} ${plural(naps, "nap is", "naps are")} drawn thin and do not move bedtime or wake. ` : "naps would be drawn thin and do not move bedtime or wake. ")
                + `Dashed lines are the medians. ${nights.withSleep} nights with sleep`
                + (nights.empty.length ? `; ${nights.empty.length} complete night(s) with none (${nights.empty.map(fmtDay).join(", ")})` : "")
                + "." + (notInFile.size ? " Dotted rows are after the export." : "") + " Click a night for its blocks.";
            })()}>
            {"notEnough" in nights ? (
              <NotEnoughData
                first={sleepName === null ? "No sleep category in your settings." : `The sleep actogram needs ${MIN_NIGHTS_R4} nights with sleep.`}
                second={sleepName === null
                  ? "If you log sleep under another name, rename it in Settings or check Data quality."
                  : `This period has ${nights.have}.`}
                action={<button className="btn" onClick={() => onUsePreset("1m")}>Use Last 30 days</button>} />
            ) : (
              <Actogram nights={nights} settings={settings} notInFile={notInFile} compact={compact}
                onNight={(day) => onShowBlocks(`Blocks of the night of ${fmtDay(day)}`, nightBlocks(day))} />
            )}
          </Card>

          <SectionHead title="Months" note="every day in the period" />
          <Card code="R5" title="How did my days look across months?"
            lede={"notEnough" in barDays ? undefined : r5Takeaway(barDays)}
            caption={"notEnough" in barDays ? undefined
              : "One column per day, 00:00 at the top. Hatched = unlogged. Dotted = not yet or not in this file. An overview, not a chart to read values from: hover a column for its day."}>
            {"notEnough" in barDays
              ? <NotEnoughData first={`The life barcode needs ${MIN_DAYS_R5} days or more.`}
                second={`This period has ${barDays.have} (${fmtRange(analysis.range.first_day, analysis.range.last_day)}).`}
                action={<button className="btn" onClick={() => onUsePreset("3m")}>Use Last 90 days</button>} />
              : <Barcode days={barDays} settings={settings} today={ctx.today} />}
          </Card>
        </>
      )}
    </>
  );
}
