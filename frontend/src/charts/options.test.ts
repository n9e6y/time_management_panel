// @vitest-environment node
// Render the one ECharts chart for real (server-side SVG) so a broken option fails a test, not the browser.
import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { coverage } from "../lib/aggregate";
import type { Palette } from "../lib/theme";
import { fixtureCtx } from "../test/fixture";
import { coverageCalendar } from "./options";

const palette: Palette = { token: () => "#808080", seq: Array(7).fill("#808080") };

function render(option: echarts.EChartsOption): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
  chart.setOption({ animation: false, ...option });
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

describe("chart options render", () => {
  it("D1, the coverage calendar", () => {
    const ctx = fixtureCtx();
    const svg = render(coverageCalendar(coverage(ctx), "Saturday")(palette));
    expect(svg).toContain("<svg");
    expect(svg).toContain("today");
  });
});
