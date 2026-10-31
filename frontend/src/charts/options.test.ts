// @vitest-environment node
// Render every chart for real (ECharts server-side SVG) so a broken option fails a test, not the browser.
import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { averageDay, categoryRows, coverage, dayProbability, subcategoryRows, weekdayHeatmap } from "../lib/aggregate";
import type { Palette } from "../lib/theme";
import { fixtureCtx } from "../test/fixture";
import { averageDayBars, categoryBars, coverageCalendar, dayProbabilityArea, subcategoryBars, weekdayHeat } from "./options";

const palette: Palette = { token: () => "#808080", seq: Array(7).fill("#808080") };

function render(option: echarts.EChartsOption): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
  chart.setOption({ animation: false, ...option });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

describe("chart options render", () => {
  const ctx = fixtureCtx();
  const wide = { ...fixtureCtx() };
  wide.analysis.range.first_day = "2025-08-25";

  it("O1 and O2", () => {
    expect(render(categoryBars(categoryRows(ctx), ctx.settings, "SLEEP")(palette))).toContain("SLEEP");
    expect(render(subcategoryBars(subcategoryRows(ctx, "SLEEP"), "SLEEP", ctx.settings)(palette))).toContain("night");
  });

  it("O3 and O4", () => {
    expect(render(averageDayBars(averageDay(ctx, "calendar"), ctx.settings)(palette))).toContain("All days");
    const probability = dayProbability(ctx, "All days");
    if ("notEnough" in probability) throw new Error("expected data");
    expect(render(dayProbabilityArea(probability, ctx.settings)(palette))).toContain("<svg");
  });

  it("O5 and D1", () => {
    const heat = weekdayHeatmap(wide);
    if ("notEnough" in heat) throw new Error("expected data");
    expect(render(weekdayHeat(heat)(palette))).toContain("Sat");
    expect(render(coverageCalendar(coverage(ctx), "Saturday")(palette))).toContain("<svg");
  });
});
