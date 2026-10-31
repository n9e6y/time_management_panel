// ECharts options for each chart, following tokens.md §5. They only shape data that aggregate.ts computed.
import type { EChartsOption } from "echarts";
import {
  KIND_LABEL, SLOT_MINUTES, UNLOGGED, type AverageDayRow, type CategoryRow, type CoverageDay, type DayProbability,
  type SubcategoryRow, type WeekdayHeatmap,
} from "../lib/aggregate";
import { fmtDay, fmtHM, fmtHours, fmtPct } from "../lib/format";
import { colorVar, type Palette } from "../lib/theme";
import type { Settings } from "../lib/types";

const PI = Math.PI;

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

export function categoryBars(rows: CategoryRow[], settings: Settings, selected: string | null) {
  return (p: Palette): EChartsOption => {
    const b = base(p);
    const names = rows.map((r) => (r.kind === "category" ? r.label : `${r.label} · ${KIND_LABEL[r.kind]}`));
    return {
      textStyle: b.textStyle, tooltip: { ...b.tooltip, trigger: "item" },
      grid: { left: 8, right: 150, top: 4, bottom: 4, containLabel: true },
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
          formatter: (x) => { const r = rows[x.dataIndex]; return `${fmtHours(r.hours)}  ·  ${fmtPct(r.share)}  ·  ${fmtHM(r.perDay)}/day`; },
        },
        tooltip: { formatter: (x) => { const r = rows[(x as { dataIndex: number }).dataIndex]; return `<b>${r.label}</b><br/>${fmtHM(r.hours)} · ${fmtPct(r.share)} of the period`; } },
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
        return `<b>${fmtDay(d.day)}</b>${d.today ? " (today, in progress)" : ""}${d.dayOff ? " · day off" : ""}<br/>${fmtHM(d.hours)} logged · ${fmtPct(d.share, 0)}`;
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
          ...(d.today ? { itemStyle: { color: p.token("surface"), borderColor: p.token("text-3"), borderType: "dashed", borderWidth: 1 } } : {}),
        })),
        label: { show: true, fontSize: 11, color: p.token("text"), formatter: (x) => { const d = days.find((c) => c.day === (x.value as [string, number])[0])!; return d.today ? "today" : `${Math.round(d.share * 100)}%`; } },
      }],
    };
  };
}
