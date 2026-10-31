import { useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  AriaComponent, CalendarComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapPiecewiseComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { readPalette, type Palette } from "../lib/theme";

// Only the parts the charts use (keeps the bundle small).
echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent,
  VisualMapPiecewiseComponent, CalendarComponent, AriaComponent, CanvasRenderer]);

interface Props {
  /** Builds the ECharts option from the current theme colors. */
  option: (palette: Palette) => EChartsOption;
  height: number;
  label: string;
  onClick?: (params: echarts.ECElementEvent) => void;
}

/** Thin ECharts wrapper: redraws on data, size and light/dark changes. */
export default function Chart({ option, height, label, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setThemeTick((t) => t + 1);
    media.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { media.removeEventListener("change", bump); observer.disconnect(); };
  }, []);

  useEffect(() => {
    chart.current = echarts.init(ref.current!, undefined, { renderer: "canvas" });
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(ref.current!);
    return () => { resize.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ animation: false, ...option(readPalette()) }, true);
  }, [option, themeTick]);

  useEffect(() => {
    if (!onClick || !chart.current) return;
    chart.current.on("click", onClick);
    return () => { chart.current?.off("click", onClick); };
  }, [onClick]);

  return <div ref={ref} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}
