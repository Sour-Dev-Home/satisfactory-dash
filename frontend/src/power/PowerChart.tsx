import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { PausedRange } from "@satisfactory-dash/shared";
import { formatMW } from "../format";
import { isolatedIndices } from "./chartGaps";

const HEIGHT = 220;
const NONE: readonly never[] = [];

/** Legend value: "–" off the data (a gap), else MW like the rest of the page. */
const mw = (_u: uPlot, value: number | null) => (value == null ? "–" : formatMW(value));

/** A time stretch in ms, [fromT, toT). */
type Stretch = Pick<PausedRange, "fromT" | "toT">;

/** A dot only for a reading with gaps on both sides (see isolatedIndices). */
const isolatedPoints = (u: uPlot, seriesIdx: number) => isolatedIndices(u.data[seriesIdx]);

/** A new object per series: uPlot writes its resolved settings back into it. */
const dots = (): uPlot.Series.Points => ({ show: false, filter: isolatedPoints, size: 6 });

/** Shades each stretch (paused per ADR-0012, or fuse tripped), under the lines. */
function shade(u: uPlot, ranges: readonly Stretch[], fill: string) {
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
export function PowerChart({
  data,
  pausedRanges,
  trippedRanges = NONE,
}: {
  data: uPlot.AlignedData;
  pausedRanges: readonly Stretch[];
  /** Fuse-tripped stretches, shaded red (the stored view; the live view lists trips in text). */
  trippedRanges?: readonly Stretch[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const initialData = useRef(data);
  const paused = useRef(pausedRanges);
  const tripped = useRef(trippedRanges);

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
          // Lines only, stock-chart style: a dot only for a reading with gaps on both sides.
          // Legend values use the same formatter as the rest of the page (ADR-0006: rounded,
          // never rescaled).
          { label: "Production", stroke: token("--color-ok"), fill: token("--color-ok-soft"), width: 2, points: dots(), value: mw },
          { label: "Consumption", stroke: token("--color-accent"), width: 2, points: dots(), value: mw },
          { label: "Capacity", stroke: token("--color-muted"), width: 1, dash: [6, 4], points: dots(), value: mw },
        ],
        axes: [axis(), { ...axis(), size: 72, values: (_u, ticks) => ticks.map((v) => `${v} MW`) }],
        cursor: { drag: { x: false, y: false } },
        hooks: {
          drawClear: [
            (self) => {
              shade(self, paused.current, token("--color-info-soft"));
              shade(self, tripped.current, token("--color-bad-soft"));
            },
          ],
        },
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
    if (paused.current === pausedRanges && tripped.current === trippedRanges) return;
    paused.current = pausedRanges;
    tripped.current = trippedRanges;
    plot.current?.redraw();
  }, [pausedRanges, trippedRanges]);

  // contain: inline-size, so the canvas's fixed pixel width never widens the grid around it;
  // the width comes from the container, and the ResizeObserver passes it to uPlot.
  return <div ref={host} aria-hidden="true" className="power-chart w-full [contain:inline-size]" />;
}
