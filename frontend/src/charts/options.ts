// ECharts options for each chart, following tokens.md §5. They only shape data that aggregate.ts computed.
import type { EChartsOption } from "echarts";
import {
  DELTA_ARROW_HOURS, KIND_LABEL, NIGHT_START_HOUR, OTHER, SLOT_MINUTES, UNLOGGED, type AverageDayRow, type BarcodeDay, type CategoryRow,
  type CoverageDay, type DayProbability, type MixOverTime, type Nights, type SubcategoryRow, type WeekdayHeatmap,
} from "../lib/aggregate";
import { fmtClock, fmtDay, fmtHM, fmtHours, fmtPct, fmtSigned } from "../lib/format";
import { colorVar, type Palette } from "../lib/theme";
import type { Settings } from "../lib/types";

const PI = Math.PI;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Legend and stack name for time after "data as of" or still to come. */
export const NOT_YET = "Not yet";

function base(p: Palette) {
  const { token } = p;
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif", color: token("text-2") },
    tooltip: {
      backgroundColor: token("surface"), borderColor: token("border-strong"), borderWidth: 1, padding: [8, 10],
      textStyle: { color: token("text"), fontSize: 12 },
    },
    axisLabel: { color: token("text-3"), fontSize: 12 },
    axisLine: { lineStyle: { color: token("axis") } },
    splitLine: { lineStyle: { color: token("grid") } },
  };
}

function fill(key: string, settings: Settings, p: Palette) {
  const color = p.token(colorVar(key, settings));
  if (key !== UNLOGGED) return { color, borderColor: p.token("surface"), borderWidth: 0 };
  return {
    color, borderColor: p.token("unlogged-edge"), borderWidth: 1,
    decal: { symbol: "rect", symbolSize: 1, rotation: PI / 4, color: p.token("unlogged-hatch"), dashArrayX: [1, 0], dashArrayY: [1, 5] },
  };
}

function legend(keys: string[], p: Palette) {
  return { data: keys, top: 0, left: 0, icon: "rect", itemWidth: 10, itemHeight: 10, textStyle: { color: p.token("text-2"), fontSize: 12 } };
}

// --- O1 ---------------------------------------------------------------------------------------

/** `comparable` is true when a previous period exists: rows then carry a Δ, or "—" when one is missing. */
export function categoryBars(rows: CategoryRow[], settings: Settings, selected: string | null,
                            comparable = false) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const names = rows.map((r) => (r.kind === "category" ? r.label : `${r.label} · ${KIND_LABEL[r.kind]}`));
    return {
      textStyle: b.textStyle, tooltip: { ...b.tooltip, trigger: "item" },
      grid: { left: 8, right: comparable ? 220 : 150, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category", inverse: true, data: names, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: {
          fontSize: 12, color: p.token("text-2"),
          formatter: (v: string) => (selected && v.split(" · ")[0] === selected ? `{sel|${v}}` : v),
          rich: { sel: { fontWeight: 600, color: p.token("text") } },
        },
      },
      series: [{
        type: "bar", barMaxWidth: 18, barCategoryGap: "40%",
        data: rows.map((r) => ({
          value: r.hours, name: r.label,
          itemStyle: { ...fill(r.kind === "category" ? r.key : "Other", settings, p), borderRadius: [0, 2, 2, 0], opacity: r.hours === 0 ? 0.35 : 1 },
        })),
        label: {
          show: true, position: "right", color: p.token("text-2"), fontSize: 12,
          rich: {
            n: { width: 140, align: "right", color: p.token("text-2") },
            d: { width: 64, align: "right", color: p.token("text-2") },
            up: { width: 64, align: "right", color: p.token("text") },
            down: { width: 64, align: "right", color: p.token("text") },
            none: { width: 64, align: "right", color: p.token("text-3") },
          },
          formatter: (x) => {
            const r = rows[x.dataIndex];
            const numbers = `{n|${fmtHours(r.hours)}  ·  ${fmtPct(r.share)}  ·  ${fmtHM(r.perDay)}/day}`;
            if (r.delta === undefined) return comparable ? `${numbers}{none|—}` : numbers;
            const arrow = Math.abs(r.delta) >= DELTA_ARROW_HOURS ? (r.delta > 0 ? " ▲" : " ▼") : "";
            const style = Math.abs(r.delta) >= DELTA_ARROW_HOURS ? (r.delta > 0 ? "up" : "down") : "none";
            return `${numbers}{${style}|${fmtSigned(r.delta)}${arrow}}`;
          },
        },
        tooltip: {
          formatter: (x) => {
            const r = rows[(x as { dataIndex: number }).dataIndex];
            const previous = r.delta === undefined ? "" : `<br/>previous period: ${fmtHM(r.hours - r.delta)}`;
            return `<b>${r.label}</b><br/>${fmtHM(r.hours)} · ${fmtPct(r.share)} of the period${previous}`;
          },
        },
      }],
    };
  };
}

// --- O2 ---------------------------------------------------------------------------------------

export function subcategoryBars(rows: SubcategoryRow[], category: string, settings: Settings) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const short = (s: string) => (s.length > 28 ? `${s.slice(0, 27)}…` : s);
    return {
      textStyle: b.textStyle, tooltip: { ...b.tooltip, trigger: "item" },
      grid: { left: 8, right: 80, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: "value", show: false },
      yAxis: { type: "category", inverse: true, data: rows.map((r) => short(r.label)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.token("text-2"), fontSize: 12 } },
      series: [{
        type: "bar", barMaxWidth: 18,
        data: rows.map((r) => ({ value: r.hours, itemStyle: { ...fill(r.label.endsWith(" others") ? "Other" : category, settings, p), borderRadius: [0, 2, 2, 0] } })),
        label: { show: true, position: "right", color: p.token("text-2"), fontSize: 12, formatter: (x) => fmtHours(rows[x.dataIndex].hours, rows[x.dataIndex].estimated) },
        tooltip: { formatter: (x) => { const r = rows[(x as { dataIndex: number }).dataIndex]; return `<b>${r.label}</b><br/>${r.estimated ? "≈ " : ""}${fmtHM(r.hours)} in ${r.count} block part(s)`; } },
      }],
    };
  };
}

// --- O3 ---------------------------------------------------------------------------------------

export function averageDayBars(rows: AverageDayRow[], settings: Settings) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const keys = rows[0].hours.map((h) => h.key);
    return {
      textStyle: b.textStyle, tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "none" }, valueFormatter: (v) => fmtHM(Number(v)) },
      legend: legend(keys, p),
      grid: { left: 8, right: 16, top: 32, bottom: 4, containLabel: true },
      xAxis: { type: "value", max: 24, interval: 4, axisLabel: { ...b.axisLabel, formatter: "{value} h" }, splitLine: b.splitLine },
      yAxis: { type: "category", inverse: true, data: rows.map((r) => `${r.type}  (n = ${r.days})`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.token("text-2"), fontSize: 12 } },
      series: keys.map((key) => ({
        type: "bar", name: key, stack: "day", barMaxWidth: 22, emphasis: { focus: "series" },
        itemStyle: { ...fill(key, settings, p), borderColor: key === UNLOGGED ? p.token("unlogged-edge") : p.token("surface"), borderWidth: key === UNLOGGED ? 1 : 2 },
        data: rows.map((r) => (r.days ? r.hours.find((h) => h.key === key)!.hours : null)),
      })),
    };
  };
}

// --- O4 ---------------------------------------------------------------------------------------

export function dayProbabilityArea(data: DayProbability, settings: Settings) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const times = Array.from({ length: data.series[0].shares.length }, (_, i) => {
      const m = i * SLOT_MINUTES;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    });
    return {
      textStyle: b.textStyle,
      tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: p.token("text-3") } }, valueFormatter: (v) => `${Number(v).toFixed(0)}%` },
      legend: legend(data.series.map((s) => s.key), p),
      grid: { left: 8, right: 16, top: 32, bottom: 4, containLabel: true },
      xAxis: { type: "category", boundaryGap: false, data: times, axisLabel: { ...b.axisLabel, interval: 15 }, axisLine: b.axisLine },
      yAxis: { type: "value", max: 100, axisLabel: { ...b.axisLabel, formatter: "{value}%" }, splitLine: b.splitLine },
      series: data.series.map((s) => ({
        type: "line", name: s.key, stack: "share", symbol: "none", smooth: false, emphasis: { focus: "series" },
        lineStyle: { width: 1, color: p.token("surface") },
        areaStyle: { color: p.token(colorVar(s.key, settings)), opacity: 1, ...(s.key === UNLOGGED ? { decal: fill(UNLOGGED, settings, p).decal } : {}) },
        itemStyle: { color: p.token(colorVar(s.key, settings)) },
        data: s.shares.map((x) => Math.round(x * 1000) / 10),
      })),
    };
  };
}

// --- O5 ---------------------------------------------------------------------------------------

/** Discrete magnitude buckets shared by O5 and D1 (tokens.md §2.4). */
function pieces(p: Palette, edges: number[], unit: (v: number) => string) {
  return edges.slice(0, -1).map((min, i) => ({ min, max: edges[i + 1], color: p.seq[i], label: `${unit(min)}–${unit(edges[i + 1])}` }));
}

export function weekdayHeat(data: WeekdayHeatmap) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const cells = data.rows.flatMap((r, y) => r.hours.map((h, x) => [x, y, Math.round(h * 10) / 10]));
    const days = data.weekdays.map((w) => `${w.name.slice(0, 3)}${w.dayOff ? "\nday off" : ""}`);
    return {
      textStyle: b.textStyle, tooltip: { ...b.tooltip, formatter: (x) => {
        const [col, row, v] = (x as { value: number[] }).value;
        return `<b>${data.rows[row].key}</b> on ${data.weekdays[col].name}s<br/>${fmtHM(v)} on average (n = ${data.weekdays[col].count})`;
      } },
      grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
      xAxis: { type: "category", data: days, position: "top", axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: p.token("text-2"), fontSize: 12 } },
      yAxis: { type: "category", inverse: true, data: data.rows.map((r) => r.key), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: p.token("text-2"), fontSize: 12 } },
      visualMap: { type: "piecewise", orient: "horizontal", left: 0, bottom: 0, pieces: pieces(p, [0, 0.5, 1, 2, 4, 6, 9, 25], (v) => `${v}`), textStyle: { color: p.token("text-3"), fontSize: 12 }, itemWidth: 14, itemHeight: 10 },
      series: [{
        type: "heatmap", data: cells, itemStyle: { borderColor: p.token("surface"), borderWidth: 2, borderRadius: 4 },
        label: { show: true, fontSize: 11, formatter: (x) => { const v = (x.value as number[])[2]; return v ? v.toFixed(1) : ""; }, color: p.token("text") },
      }],
    };
  };
}

// --- D1 ---------------------------------------------------------------------------------------

export function coverageCalendar(days: CoverageDay[], weekStart: string) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const firstDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(weekStart);
    return {
      textStyle: b.textStyle,
      tooltip: { ...b.tooltip, formatter: (x) => {
        const d = days.find((c) => c.day === (x as unknown as { value: [string, number] }).value[0])!;
        const note = d.notInFile ? " (not in this file)" : d.today ? " (today, in progress)" : d.partial ? " (file exported this day)" : "";
        return `<b>${fmtDay(d.day)}</b>${note}${d.dayOff ? " · day off" : ""}<br/>${fmtHM(d.hours)} logged · ${fmtPct(d.share, 0)}`;
      } },
      visualMap: { type: "piecewise", orient: "horizontal", left: 0, bottom: 0, pieces: pieces(p, [0, 0.01, 0.25, 0.5, 0.75, 0.9, 1, 10], (v) => `${Math.min(100, Math.round(v * 100))}%`).map((x, i) => (i === 6 ? { ...x, label: "100%" } : x)), textStyle: { color: p.token("text-3"), fontSize: 12 }, itemWidth: 14, itemHeight: 10 },
      calendar: {
        orient: "vertical", range: [days[0].day, days[days.length - 1].day], cellSize: [44, 28], top: 30, left: 60, bottom: 40,
        dayLabel: { firstDay, color: p.token("text-3"), fontSize: 12 }, monthLabel: { color: p.token("text-2"), fontSize: 12 }, yearLabel: { show: false },
        itemStyle: { color: p.token("surface"), borderColor: p.token("surface"), borderWidth: 2 }, splitLine: { show: false },
      },
      series: [{
        type: "heatmap", coordinateSystem: "calendar",
        data: days.map((d) => ({
          value: [d.day, d.share],
          ...(d.partial || d.notInFile ? { itemStyle: { color: p.token("surface"), borderColor: p.token(d.notInFile ? "nif-edge" : "text-3"), borderType: d.notInFile ? "dotted" : "dashed", borderWidth: 1 } } : {}),
        })),
        label: { show: true, fontSize: 11, color: p.token("text"), formatter: (x) => { const d = days.find((c) => c.day === (x.value as [string, number])[0])!; return d.notInFile ? "not in file" : d.today ? "today" : d.partial ? "as of" : `${Math.round(d.share * 100)}%`; } },
      }],
    };
  };
}

// ==============================================================================================
// Stage 3.5 Part B
// ==============================================================================================

/** Dotted outline, no fill: "not in this file" or "not yet" (tokens.md §1). */
function notYetStyle(p: Palette) {
  return { color: "transparent", borderColor: p.token("nif-edge"), borderWidth: 1, borderType: [1, 3] as [number, number] };
}

// --- O3: how has my time changed over the period? ---------------------------------------------

/** Day buckets label only the week starts and the last bar; week and month buckets label each. */
function bucketLabels(mix: MixOverTime): string[] {
  return mix.buckets.map((b, i) => {
    if (mix.kind === "month") return `${MONTH_NAMES[Number(b.key.slice(5, 7)) - 1]} ${b.key.slice(0, 4)}`;
    if (mix.kind === "week") return fmtDay(b.key);
    return b.weekStart || i === mix.buckets.length - 1 ? fmtDay(b.key) : "";
  });
}

export function mixBars(mix: MixOverTime, settings: Settings, category: string | null) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const keys = mix.buckets[0].hours.map((h) => h.key);
    const marks = mix.buckets.map((x) => (x.dayOff ? "off" : x.partial ? "part" : ""));
    const bucketWord = mix.kind === "day" ? "day" : mix.kind === "week" ? "week of" : "";
    return {
      textStyle: b.textStyle,
      tooltip: {
        ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => fmtHM(Number(v)),
        formatter: undefined,
      },
      legend: { ...legend(category ? keys : [...keys, NOT_YET], p), top: 0 },
      grid: { left: 8, right: 16, top: 32, bottom: 26, containLabel: true },
      xAxis: [
        {
          type: "category", data: bucketLabels(mix), axisTick: { show: false }, axisLine: b.axisLine,
          axisLabel: { ...b.axisLabel, interval: 0, hideOverlap: true },
        },
        {
          type: "category", data: marks, position: "bottom", offset: 18, axisLine: { show: false },
          axisTick: { show: false }, axisLabel: { color: p.token("text-3"), fontSize: 10, interval: 0, hideOverlap: true },
        },
      ],
      yAxis: {
        type: "value", max: category ? undefined : 24, interval: category ? undefined : 6,
        axisLabel: { ...b.axisLabel, formatter: "{value} h" }, splitLine: b.splitLine,
      },
      series: [
        ...keys.map((key, index) => ({
          type: "bar" as const, name: key, stack: "mix", barMaxWidth: 36, emphasis: { focus: "series" as const },
          itemStyle: fill(key, settings, p),
          ...(category && index === 0 && mix.average !== null
            ? {
              markLine: {
                silent: true, symbol: "none",
                lineStyle: { color: p.token("text-2"), type: "dashed" as const, width: 1 },
                label: { formatter: `average ${fmtHours(mix.average)}/day`, color: p.token("text-2"), fontSize: 12 },
                data: [{ yAxis: mix.average }],
              },
            }
            : {}),
          data: mix.buckets.map((bucket) => bucket.hours.find((h) => h.key === key)!.hours),
        })),
        ...(category ? [] : [{
          type: "bar" as const, name: NOT_YET, stack: "mix", barMaxWidth: 36,
          itemStyle: notYetStyle(p),
          data: mix.buckets.map((bucket) => bucket.notYet || null),
        }]),
      ],
      aria: { enabled: true, label: { description: `Average hours per ${bucketWord || "month"} bucket` } },
    };
  };
}

// --- R4: when do I sleep, and how regular is it? ----------------------------------------------

/** Rows are nights; the x axis is hours after 18:00, so a night is one unbroken bar. */
export function sleepActogram(data: Nights, settings: Settings) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const rows = data.nights.map((n) => `${fmtDay(n.day)}${n.dayOff ? " · off" : ""}`);
    const bars = data.nights.flatMap((n, y) => n.bars.map((bar) => ({
      value: [y, bar.from, bar.to, bar.main ? 1 : 0, n.incomplete ? 1 : 0] as number[],
      night: n.day,
    })));
    const median = (at: number | null, text: string) =>
      (at === null ? [] : [{
        xAxis: at,
        label: { formatter: text, color: p.token("text-2"), fontSize: 12, position: "insideEndTop" as const },
      }]);
    return {
      textStyle: b.textStyle,
      tooltip: {
        ...b.tooltip,
        formatter: (x) => {
          const [, from, to] = (x as unknown as { value: number[] }).value;
          const item = (x as unknown as { data: { night: string } }).data;
          return `<b>Night of ${fmtDay(item.night)}</b><br/>${fmtClock(NIGHT_START_HOUR + from)}–`
            + `${fmtClock(NIGHT_START_HOUR + to)} · ${fmtHM(to - from)}`;
        },
      },
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: "value", min: 0, max: 24, interval: 3, position: "top",
        axisLabel: { ...b.axisLabel, formatter: (v: number) => fmtClock(NIGHT_START_HOUR + v) },
        axisLine: b.axisLine, splitLine: b.splitLine,
      },
      yAxis: {
        type: "category", inverse: true, data: rows, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: p.token("text-2"), fontSize: 11, interval: rows.length > 60 ? "auto" : 0 },
      },
      series: [
        {
          type: "custom", name: "Day off", silent: true,
          renderItem: (_params, api) => {
            const y = api.value(0) as number;
            if (!data.nights[y]?.dayOff) return undefined as unknown as never;
            const size = api.size!([0, 1]) as number[];
            const left = api.coord([0, y]) as number[];
            const right = api.coord([24, y]) as number[];
            return {
              type: "rect",
              shape: { x: left[0], y: left[1] - size[1] / 2, width: right[0] - left[0], height: size[1] },
              style: { fill: p.token("surface-2") },
            };
          },
          data: data.nights.map((_n, y) => ({ value: [y] })),
        },
        {
          type: "custom", name: "Sleep",
          renderItem: (_params, api) => {
            const y = api.value(0) as number;
            const from = api.value(1) as number;
            const to = api.value(2) as number;
            const main = api.value(3) === 1;
            const incomplete = api.value(4) === 1;
            const start = api.coord([from, y]) as number[];
            const end = api.coord([to, y]) as number[];
            const size = api.size!([0, 1]) as number[];
            const height = size[1] * (main ? 0.6 : 0.3);
            return {
              type: "rect",
              shape: { x: start[0], y: start[1] - height / 2, width: Math.max(1, end[0] - start[0]), height },
              style: incomplete ? notYetStyle(p) as unknown as Record<string, unknown>
                : { fill: p.token(colorVar(data.category ?? OTHER, settings)) },
            };
          },
          encode: { x: [1, 2], y: 0 },
          data: bars,
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: p.token("text-2"), type: "dashed", width: 1 },
            data: [
              ...median(data.medians.bedtime, `median bedtime ${fmtClock(NIGHT_START_HOUR + (data.medians.bedtime ?? 0))}`),
              ...median(data.medians.wake, `median wake ${fmtClock(NIGHT_START_HOUR + (data.medians.wake ?? 0))}`),
            ],
          },
        },
      ],
      aria: { enabled: true, label: { description: `${data.withSleep} nights of sleep on an 18:00 to 18:00 axis` } },
    };
  };
}

// --- R5: how did my days look across months? --------------------------------------------------

/** One thin 24-hour column per day: the shape of months, not a chart to read values from. */
export function lifeBarcode(days: BarcodeDay[], settings: Settings) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const labels = days.map((d) => (d.day.endsWith("-01")
      ? `${MONTH_NAMES[Number(d.day.slice(5, 7)) - 1]}` : ""));
    const parts = days.flatMap((d, x) => d.parts.map((part) => ({ value: [x, part.from, part.to], key: part.key, day: d.day })));
    return {
      textStyle: b.textStyle,
      tooltip: {
        ...b.tooltip,
        formatter: (x) => {
          const item = (x as unknown as { data: { day: string; key: string } }).data;
          const day = days.find((d) => d.day === item.day)!;
          return `<b>${fmtDay(day.day)}</b>${day.dayOff ? " · day off" : ""}<br/>${item.key}<br/>${fmtHM(day.logged)} logged`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "category", data: labels, axisTick: { show: false }, axisLine: b.axisLine,
        axisLabel: { ...b.axisLabel, interval: 0, hideOverlap: true },
      },
      yAxis: {
        type: "value", min: 0, max: 24, interval: 6, inverse: true,
        axisLabel: { ...b.axisLabel, formatter: (v: number) => fmtClock(v) }, splitLine: b.splitLine,
      },
      series: [
        {
          type: "custom", name: "Day off", silent: true,
          renderItem: (_params, api) => {
            const x = api.value(0) as number;
            const day = days[x];
            if (!day || (!day.dayOff && !day.notInFile)) return undefined as unknown as never;
            const size = api.size!([1, 0]) as number[];
            const top = api.coord([x, 0]) as number[];
            const bottom = api.coord([x, 24]) as number[];
            return {
              type: "rect",
              shape: { x: top[0] - size[0] / 2, y: top[1], width: size[0], height: bottom[1] - top[1] },
              style: day.notInFile ? notYetStyle(p) as unknown as Record<string, unknown> : { fill: p.token("surface-2") },
            };
          },
          data: days.map((_d, x) => ({ value: [x] })),
        },
        {
          type: "custom", name: "Logged",
          renderItem: (params, api) => {
            const x = api.value(0) as number;
            const from = api.value(1) as number;
            const to = api.value(2) as number;
            const key = (parts[params.dataIndex] ?? { key: OTHER }).key;
            const size = api.size!([1, 0]) as number[];
            const top = api.coord([x, from]) as number[];
            const end = api.coord([x, to]) as number[];
            const width = Math.max(1, size[0] - (days.length <= 92 ? 1 : 0));
            return {
              type: "rect",
              shape: { x: top[0] - width / 2, y: top[1], width, height: Math.max(1, end[1] - top[1]) },
              style: { fill: p.token(colorVar(key, settings)) },
            };
          },
          encode: { x: 0, y: [1, 2] },
          data: parts,
        },
      ],
      aria: { enabled: true, label: { description: `${days.length} days, one column each` } },
    };
  };
}
