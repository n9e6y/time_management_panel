// @vitest-environment node
// Render every chart for real (ECharts server-side SVG) so a broken option fails a test, not the browser.
import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import {
  averageDay, barcode, categoryRows, coverage, dayProbability, mixOverTime, sleepNights, subcategoryRows,
  weekdayHeatmap, withDeltas,
} from "../lib/aggregate";
import type { Palette } from "../lib/theme";
import { fixtureCtx, syntheticCtx } from "../test/fixture";
import {
  averageDayBars, categoryBars, coverageCalendar, dayProbabilityArea, lifeBarcode, mixBars, sleepActogram,
  subcategoryBars, weekdayHeat,
} from "./options";

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

describe("Stage 3.5 Part B charts render", () => {
  const long = () => syntheticCtx("2026-09-01", "2026-10-15");

  it("O1 with a Δ column, and with no previous period", () => {
    const ctx = fixtureCtx();
    const rows = categoryRows(ctx);
    const previous = rows.map((r) => ({ ...r, hours: r.hours / 2 }));

    const svg = render(categoryBars(withDeltas(rows, previous), ctx.settings, "SLEEP", true)(palette));
    expect(svg).toContain("SLEEP");
    expect(svg).toContain("▲");

    expect(render(categoryBars(rows, ctx.settings, "SLEEP", true)(palette))).toContain("—");
  });

  it("O3 by day, by week and for one category", () => {
    const week = mixOverTime(long());
    if ("notEnough" in week) throw new Error("expected buckets");
    expect(week.kind).toBe("week");
    expect(render(mixBars(week, long().settings, null)(palette))).toContain("<svg");

    const day = mixOverTime(syntheticCtx("2026-10-01", "2026-10-20"));
    if ("notEnough" in day) throw new Error("expected buckets");
    expect(render(mixBars(day, long().settings, null)(palette))).toContain("off");  // the day-off mark row

    const one = mixOverTime(long(), "LEARN");
    if ("notEnough" in one) throw new Error("expected buckets");
    expect(render(mixBars(one, long().settings, "LEARN")(palette))).toContain("average");
  });

  it("R4 draws the nights and both medians", () => {
    const ctx = long();
    const nights = sleepNights(ctx);
    if ("notEnough" in nights) throw new Error("expected nights");

    const svg = render(sleepActogram(nights, ctx.settings)(palette));
    expect(svg).toContain("median bedtime 23:30");
    expect(svg).toContain("median wake 07:30");
  });

  it("R5 draws one column per day", () => {
    const ctx = long();
    const days = barcode(ctx);
    if ("notEnough" in days) throw new Error("expected days");

    const svg = render(lifeBarcode(days, ctx.settings)(palette));
    expect(svg).toContain("<svg");
    expect(svg).toContain("Sep");
  });
});
