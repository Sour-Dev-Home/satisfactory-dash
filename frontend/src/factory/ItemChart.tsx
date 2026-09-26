import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatAmount } from "../format";

const HEIGHT = 220;

/** Legend value, rounded like the table (ADR-0006), never rescaled. */
const formatPerMinuteLabel = (v: number, unitLabel: string) => `${formatAmount(v)} ${unitLabel}`;

/**
 * One item's stored production (ADR-0027): the bucket average rate, and the capacity dashed.
 * Canvas, hidden from screen readers: the summary and the readings table beside it carry the data.
 * uPlot sets styles only through the CSSOM and its CSS is a static file, so the strict CSP
 * (style-src 'self') holds, as for the power chart. `unitLabel` is the item's own unit.
 */
export function ItemChart({ data, unitLabel }: { data: uPlot.AlignedData; unitLabel: string }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const initialData = useRef(data);
  // Fixed for the chart's life: the panel remounts the chart (a new key) for another item.
  const unit = useRef(unitLabel);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const token = (name: string) => css.getPropertyValue(name).trim();
    // A new object per axis: uPlot writes computed settings into grid/ticks (see PowerChart).
    const axis = (): uPlot.Axis => ({
      stroke: token("--color-muted"),
      grid: { stroke: token("--color-line"), width: 1 },
      ticks: { stroke: token("--color-line"), width: 1 },
    });
    // "–" in a gap.
    const value = (_u: uPlot, v: number | null) => (v == null ? "–" : formatPerMinuteLabel(v, unit.current));
    const u = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        scales: { x: { time: true } },
        series: [
          {},
          { label: "Produced", stroke: token("--color-ok"), fill: token("--color-ok-soft"), width: 2, points: { show: false }, value },
          { label: "Capacity", stroke: token("--color-muted"), width: 1, dash: [6, 4], points: { show: false }, value },
        ],
        axes: [axis(), { ...axis(), size: 88, values: (_u, ticks) => ticks.map((v) => `${v} ${unit.current}`) }],
        cursor: { drag: { x: false, y: false } },
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

  // power-chart: the shared legend styles in index.css (not power-specific beyond the name).
  // contain: inline-size, so the canvas's pixel width never widens the grid around it.
  return <div ref={host} aria-hidden="true" className="power-chart w-full [contain:inline-size]" />;
}
