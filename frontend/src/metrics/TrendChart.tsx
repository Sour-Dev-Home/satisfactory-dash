import { useEffect, useLayoutEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { METRICS_LAST_BUCKET_MS, METRICS_TREND_OVER_MS } from "@satisfactory-dash/shared";
import { isolatedIndices } from "../power/chartGaps";
import { countText } from "./metricsText";
import { trendCountText, trendMsText, type TrendChartSpec } from "./metricsTrend";

/**
 * One hourly trend chart of the metrics page (ADR-0056 amendment 2026-10-26), the lazy chunk every chart on the page
 * shares (uPlot is imported nowhere else in `src/metrics/`). Like `power/PowerChart.tsx`: colours from theme tokens
 * through getComputedStyle, a new object per axis, a ResizeObserver for the width, styles only through the CSSOM (the
 * strict CSP holds), and an aria-hidden canvas: the summary line and the folded Details carry the numbers.
 *
 * Timings draw on a fixed log scale from 1 ms to the over value. The band above the last bucket (5 s) is shaded and
 * labelled "> 5 s": an hour above it sits on the band's top edge, never read as a real 10 s. A null hour is a gap.
 */

const HEIGHT = 180;
const MS_SPLITS = [1, 10, 100, 1000, METRICS_TREND_OVER_MS];
const COUNT_INCRS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];

function msTick(v: number): string {
  if (v >= METRICS_TREND_OVER_MS) return `> ${METRICS_LAST_BUCKET_MS / 1000} s`;
  return v >= 1000 ? `${v / 1000} s` : `${v} ms`;
}

/** A dot only for an hour with gaps on both sides, so a lone reading still shows. */
const isolatedPoints = (u: uPlot, seriesIdx: number) => isolatedIndices(u.data[seriesIdx]);

export function TrendChart({ spec, times }: { spec: TrendChartSpec; times: readonly number[] }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const current = useRef(spec);
  const initial = useRef<uPlot.AlignedData>([[...times], ...spec.series.map((x) => x.drawn)]);
  // Before the effects below: the legend's formatter and a rebuilt chart read the latest spec.
  useLayoutEffect(() => {
    current.current = spec;
  }, [spec]);
  // The chart's shape (unit, bars, series) is fixed per chart id; a new window only brings new data.
  const shape = `${spec.id}:${spec.unit}:${spec.bars}:${spec.series.map((s) => s.label).join(",")}`;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const ms = current.current.unit === "ms";
    // A new object per axis: uPlot writes computed settings into grid/ticks.
    const axis = (): uPlot.Axis => ({
      stroke: token("--color-muted"),
      grid: { stroke: token("--color-line"), width: 1 },
      ticks: { stroke: token("--color-line"), width: 1 },
    });
    // Legend values come from the raw series (the drawn one may be stacked or clamped for the log scale).
    const legendValue = (_u: uPlot, _v: number | null, seriesIdx: number, idx: number | null) => {
      if (idx === null) return "–";
      const value = current.current.series[seriesIdx - 1]?.values[idx] ?? null;
      return ms ? trendMsText(value) : trendCountText(value);
    };
    const bars = current.current.bars ? uPlot.paths?.bars?.({ size: [0.7, 24], gap: 1 }) : undefined;
    const series: uPlot.Series[] = current.current.series.map((s) => {
      const color = token(s.color);
      return bars
        ? { label: s.label, stroke: color, fill: color, width: 0, paths: bars, points: { show: false }, value: legendValue }
        : { label: s.label, stroke: color, width: 2, points: { show: false, filter: isolatedPoints, size: 8 }, value: legendValue };
    });
    const u = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        scales: {
          x: { time: true },
          y: ms
            ? { distr: 3, log: 10, range: () => [1, METRICS_TREND_OVER_MS] }
            : { range: (_u, _min, max) => [0, Math.max(1, max ?? 0)] },
        },
        series: [{}, ...series],
        axes: [
          axis(),
          ms
            ? { ...axis(), size: 64, splits: () => MS_SPLITS, values: (_u, ticks) => ticks.map(msTick) }
            : { ...axis(), size: 64, incrs: COUNT_INCRS, values: (_u, ticks) => ticks.map((v) => countText(v)) },
        ],
        cursor: { drag: { x: false, y: false } },
        hooks: ms
          ? {
              drawClear: [
                (self) => {
                  // The band above the last bucket: "> 5 s", one value, not a scale.
                  const { ctx, bbox } = self;
                  const top = self.valToPos(METRICS_TREND_OVER_MS, "y", true);
                  const bottom = self.valToPos(METRICS_LAST_BUCKET_MS, "y", true);
                  ctx.save();
                  ctx.fillStyle = token("--color-surface-2");
                  ctx.fillRect(bbox.left, top, bbox.width, bottom - top);
                  ctx.restore();
                },
              ],
            }
          : {},
      },
      initial.current,
      el,
    );
    plot.current = u;
    const resize = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: HEIGHT }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [shape]);

  useEffect(() => {
    plot.current?.setData([[...times], ...spec.series.map((x) => x.drawn)]);
  }, [spec, times]);

  // contain: inline-size, so the canvas's pixel width never widens the grid around it.
  return <div ref={host} aria-hidden="true" className="trend-chart w-full [contain:inline-size]" />;
}
