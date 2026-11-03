// ECharts options for the one chart still drawn on canvas: Data quality's coverage calendar (D1).
// Overview and Rhythm draw their charts as HTML and SVG since the new-ui redesign (charts/*.tsx).
import type { EChartsOption } from "echarts";
import type { CoverageDay } from "../lib/aggregate";
import { fmtDay, fmtHM, fmtPct } from "../lib/format";
import type { Palette } from "../lib/theme";

function base(p: Palette) {
  const { token } = p;
  return {
    textStyle: { fontFamily: "Geist, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif", color: token("text-2") },
    tooltip: {
      backgroundColor: token("surface"), borderColor: token("border-strong"), borderWidth: 1, padding: [8, 10],
      textStyle: { color: token("text"), fontSize: 12 },
    },
  };
}

/** Discrete magnitude buckets (tokens.md §2.4). */
function pieces(p: Palette, edges: number[], unit: (v: number) => string) {
  return edges.slice(0, -1).map((min, i) => ({ min, max: edges[i + 1], color: p.seq[i], label: `${unit(min)}–${unit(edges[i + 1])}` }));
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
