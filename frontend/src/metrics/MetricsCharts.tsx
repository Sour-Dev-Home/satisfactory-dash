import { lazy, Suspense, useId, useMemo } from "react";
import type { MetricsOverview, MetricsTrend, MetricsWindow } from "@satisfactory-dash/shared";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { cn } from "../lib/cn";
import { Skeleton, SkeletonStatus } from "../ui/Skeleton";
import {
  chartsData,
  headlineTiles,
  previousWords,
  sparklinePath,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  trendTimes,
  type Change,
  type HeadlineTile,
  type TrendChartSpec,
} from "./metricsTrend";
import { chartsUnavailableText } from "./metricsText";

/**
 * The chart-led half of the metrics page (ADR-0056 amendment 2026-10-26): the headline stat row, then the hourly trend
 * charts. Every chart on the page comes from one lazy chunk (`TrendChart.tsx`, uPlot), loaded when the first one
 * renders; the tiles, summaries and Details don't wait for it.
 */

// React.lazy caches a failed import for good: on failure, swap in a fresh lazy component so Try again imports again.
const loadChart = () =>
  import("./TrendChart").then(
    (m) => ({ default: m.TrendChart }),
    (error: unknown) => {
      TrendChart = lazy(loadChart);
      throw error;
    },
  );
let TrendChart = lazy(loadChart);

/** The sign a change wears with its words, so a worse change never rests on colour alone. */
function changeIcon(change: Change): string {
  if (change.direction === "up") return "▲";
  if (change.direction === "down") return "▼";
  return "";
}

function ChangeLine({ change, window }: { change: Change; window: MetricsWindow }) {
  const icon = changeIcon(change);
  return (
    <p data-tone={change.tone} className={cn("mb-0 text-sm", change.tone === "worse" ? "text-warn" : "text-muted")}>
      {icon && (
        <span aria-hidden="true" className="mr-1">
          {icon}
        </span>
      )}
      {change.text}
      {change.relative && <> on {previousWords(window)}</>}
      {change.tone === "worse" && <span className="font-semibold">, worse</span>}
      {change.tone === "better" && <>, better</>}
    </p>
  );
}

/** The tile's trend, decorative: the tile's words carry the meaning. Gaps stay gaps. */
function Sparkline({ tile }: { tile: HeadlineTile }) {
  const d = sparklinePath(tile.spark, tile.sparkLog);
  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="h-6 w-full overflow-visible"
    >
      {d && <path d={d} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" className="fill-none stroke-series-1 stroke-2" />}
    </svg>
  );
}

function Tile({ tile, window }: { tile: HeadlineTile; window: MetricsWindow }) {
  return (
    <li data-tile={tile.id} className="grid content-start gap-1 rounded-card border border-line bg-surface p-3">
      <p className="mb-0 text-sm text-muted">{tile.label}</p>
      <p className="mb-0 text-xl font-semibold text-fg-strong">{tile.value}</p>
      <ChangeLine change={tile.change} window={window} />
      <Sparkline tile={tile} />
    </li>
  );
}

/** The stat row on top: the window's headline numbers against the window before. */
export function HeadlineRow({ overview }: { overview: MetricsOverview }) {
  const id = useId();
  const charts = chartsData(overview);
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h3 id={id} className="mb-0">
        At a glance
      </h3>
      {charts ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {headlineTiles(charts).map((tile) => (
            <Tile key={tile.id} tile={tile} window={overview.window} />
          ))}
        </ul>
      ) : (
        <p data-charts-unavailable="" className="mb-0 rounded-card border border-line bg-surface p-3 text-muted">
          {chartsUnavailableText(overview.charts?.available === false ? overview.charts.reason : null)}
        </p>
      )}
    </section>
  );
}

/** Holds a chart's place while the chunk loads, the same height as the chart, so nothing below moves. */
function ChartPlaceholder() {
  return (
    <>
      <SkeletonStatus>Loading chart…</SkeletonStatus>
      {/* data-chart-loading: the e2e screenshots wait until every chart is drawn, not its placeholder. */}
      <div data-chart-loading="">
        <Skeleton className="h-trend-slot-phone sm:h-trend-slot" />
      </div>
    </>
  );
}

/** One trend: its title, the one-sentence summary (the text path), and the lazy canvas. */
export function TrendFigure({ spec, times }: { spec: TrendChartSpec; times: readonly number[] }) {
  const id = useId();
  return (
    <figure aria-labelledby={id} data-chart={spec.id} className="m-0 grid gap-1">
      <h4 id={id} className="mb-0">
        {spec.title}
      </h4>
      <figcaption className="text-sm text-muted">{spec.summary}</figcaption>
      <div className="min-h-trend-slot-phone sm:min-h-trend-slot">
        <ErrorBoundary label={spec.title}>
          <Suspense fallback={<ChartPlaceholder />}>
            <TrendChart spec={spec} times={times} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </figure>
  );
}

/** A group of trends with the shared x axis's caption. */
export function TrendGroup({ trend, specs, caption }: { trend: MetricsTrend; specs: readonly TrendChartSpec[]; caption: string }) {
  const times = useMemo(() => trendTimes(trend), [trend]);
  return (
    <div className="grid gap-4">
      <p className="mb-0 text-sm text-muted">{caption}. Local time; timings are bucket upper bounds on a log scale.</p>
      {specs.map((spec) => (
        <TrendFigure key={spec.id} spec={spec} times={times} />
      ))}
    </div>
  );
}
