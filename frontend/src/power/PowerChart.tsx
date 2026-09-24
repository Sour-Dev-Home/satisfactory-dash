import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PausedRange } from "@satisfactory-dash/shared";

const HEIGHT = 220;

/** Shades each paused stretch (ADR-0012), under the lines. */
function shadePaused(u: uPlot, ranges: readonly PausedRange[], fill: string) {
  const { ctx, bbox } = u;
  ctx.save();
  ctx.fillStyle = fill;
  for (const r of ranges) {
    const x0 = u.valToPos(r.fromT / 1000, "x", true);
    const x1 = u.valToPos(r.toT / 1000, "x", true);
    const left = Math.max(bbox.left, Math.min(x0, x1));
    const right = Math.min(bbox.left + bbox.width, Math.max(x0, x1));
    if (right > left) ctx.fillRect(left, bbox.top, Math.max(right - left, 2), bbox.height);
  }
  ctx.restore();
}

/**
 * One circuit's live power, stock-chart style (ADR-0022): production, consumption and
 * capacity over the window, with a hover crosshair and values in the legend. Canvas, so
 * screen readers get the summary and table next to it instead (aria-hidden here).
 * uPlot sets styles only through the CSSOM and its CSS is a static file, so the strict
 * CSP (style-src 'self') holds; the e2e CSP guard checks that.
 */
export function PowerChart({ data, pausedRanges }: { data: uPlot.AlignedData; pausedRanges: readonly PausedRange[] }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const initialData = useRef(data);
  const paused = useRef(pausedRanges);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const token = (name: string) => css.getPropertyValue(name).trim();
    // A new object per axis: uPlot writes computed settings into grid/ticks, so two axes
    // sharing them (e.g. through a shallow spread) break each other.
    const axis = (): uPlot.Axis => ({
      stroke: token("--color-muted"),
      grid: { stroke: token("--color-line"), width: 1 },
      ticks: { stroke: token("--color-line"), width: 1 },
    });
    const u = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        scales: { x: { time: true } },
        series: [
          {},
          // Lines only, stock-chart style: no dot per sample.
          { label: "Production", stroke: token("--color-ok"), fill: token("--color-ok-soft"), width: 2, points: { show: false } },
          { label: "Consumption", stroke: token("--color-accent"), width: 2, points: { show: false } },
          { label: "Capacity", stroke: token("--color-muted"), width: 1, dash: [6, 4], points: { show: false } },
        ],
        axes: [axis(), { ...axis(), size: 72, values: (_u, ticks) => ticks.map((v) => `${v} MW`) }],
        cursor: { drag: { x: false, y: false } },
        hooks: { drawClear: [(self) => shadePaused(self, paused.current, token("--color-info-soft"))] },
      },
      initialData.current,
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
  }, []);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  // Only when the ranges change after creation: uPlot's redraw() right after construction,
  // before its first draw, leaves the x scale unset for good (no lines, no time axis).
  useEffect(() => {
    if (paused.current === pausedRanges) return;
    paused.current = pausedRanges;
    plot.current?.redraw();
  }, [pausedRanges]);

  // contain: inline-size, so the canvas's fixed pixel width never widens the grid around it;
  // the width comes from the container, and the ResizeObserver passes it to uPlot.
  return <div ref={host} aria-hidden="true" className="power-chart w-full [contain:inline-size]" />;
}
