import {
  METRICS_TREND_OVER_MS,
  type MetricsChartsSection,
  type MetricsHeadline,
  type MetricsOverview,
  type MetricsTrend,
  type MetricsWindow,
} from "@satisfactory-dash/shared";
import { countText, percentileText, rateText } from "./metricsText";

/**
 * The chart-led metrics page's numbers and words (ADR-0056 amendment 2026-10-26): the headline tiles, their changes on
 * the window before, and the trend charts' series. Pure, so every rule is tested without a canvas. Percentiles stay the
 * bucket upper bounds they are; `METRICS_TREND_OVER_MS` is "above the last bucket", never a real 10 s.
 */

export type ChartsData = Extract<MetricsChartsSection, { available: true }>;
type Series = readonly (number | null)[];

/** The charts section, narrowed: data, or nothing to draw (absent from an older backend, or a reason). */
export function chartsData(overview: MetricsOverview): ChartsData | null {
  return overview.charts?.available ? overview.charts : null;
}

const HOUR_S = 3600;

/** A trend percentile in words: "≤ 200 ms", "> 5 s" for the over value, "No data" for an hour without any. */
export function trendMsText(ms: number | null): string {
  if (ms === null) return "No data";
  return percentileText(ms === METRICS_TREND_OVER_MS ? null : ms);
}

/** A count in words, "No data" for null. */
export function trendCountText(n: number | null): string {
  return n === null ? "No data" : countText(n);
}

/** Whether a change is worse, better, or neither (no comparison, about the same, or a number with no good direction). */
export type ChangeTone = "worse" | "better" | "neutral";
export interface Change {
  text: string;
  direction: "up" | "down" | "same" | null;
  tone: ChangeTone;
  /** A percent, which reads with what it is relative to ("Up 12% on the 24 hours before"). */
  relative?: boolean;
}

const NO_COMPARISON: Change = { text: "No comparison", direction: null, tone: "neutral" };

function tone(direction: Change["direction"], higherIsWorse: boolean | null): ChangeTone {
  if (higherIsWorse === null || direction === null || direction === "same") return "neutral";
  return (direction === "up") === higherIsWorse ? "worse" : "better";
}

/**
 * A count or rate against the one before, as a percent: "Up 12%", "Down 3%", "About the same". "No comparison" when
 * either is unknown or the one before is 0 (a percent of nothing means nothing). `higherIsWorse` null: no good way.
 */
export function percentChange(current: number | null, previous: number | null, higherIsWorse: boolean | null): Change {
  if (current === null || previous === null || previous === 0) return NO_COMPARISON;
  const percent = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(percent));
  if (rounded === 0) return { text: "About the same", direction: "same", tone: "neutral", relative: true };
  const direction = percent > 0 ? "up" : "down";
  return { text: `${direction === "up" ? "Up" : "Down"} ${countText(rounded)}%`, direction, tone: tone(direction, higherIsWorse), relative: true };
}

/**
 * A percentile against the one before, as the bucket step it is: "≤ 200 ms, was ≤ 100 ms". Higher is always worse.
 * "No comparison" when either window had no data.
 */
export function bucketChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return NO_COMPARISON;
  if (current === previous) return { text: "Same as before", direction: "same", tone: "neutral" };
  const direction = current > previous ? "up" : "down";
  return { text: `${trendMsText(current)}, was ${trendMsText(previous)}`, direction, tone: tone(direction, true) };
}

const PREVIOUS_WORDS: ReadonlyMap<MetricsWindow, string> = new Map([
  ["1h", "the hour before"],
  ["24h", "the 24 hours before"],
  ["7d", "the 7 days before"],
]);

/** What the headline compares with: "the 24 hours before". */
export function previousWords(window: MetricsWindow): string {
  return PREVIOUS_WORDS.get(window) ?? "the window before";
}

/** The trend's caption: the 1h window still draws a day (`metricsTrendPoints`). */
export function trendCaption(trend: Pick<MetricsTrend, "points">): string {
  return trend.points > 25 ? "Hourly trend, last 7 days" : "Hourly trend, last 24 h";
}

/** Per-hour sum of several series; an hour where every series is null stays null (a gap, not zero). */
export function sumSeries(series: readonly Series[]): (number | null)[] {
  const length = Math.max(0, ...series.map((s) => s.length));
  return Array.from({ length }, (_, i) => {
    let known = false;
    let total = 0;
    for (const s of series) {
      const v = s[i];
      if (v !== null && v !== undefined) {
        known = true;
        total += v;
      }
    }
    return known ? total : null;
  });
}

/** Per hour: 5xx answers over all answers, null for an hour with no requests or no data. */
export function errorRateSeries(requests: MetricsTrend["requests"]): (number | null)[] {
  const totals = sumSeries([requests.c2xx, requests.c3xx, requests.c4xx, requests.c5xx]);
  return totals.map((total, i) => (total === null || total === 0 ? null : (requests.c5xx[i] ?? 0) / total));
}

const refusedSeries = (t: MetricsTrend): Series[] => [t.agentRefused, t.signupRefused, t.historyRowsDropped, t.alertEventsDropped, t.pushDropped];

const errorRate = (h: MetricsHeadline) => (h.requests === null || h.requests === 0 ? null : (h.serverErrors ?? 0) / h.requests);
const perHour = (n: number | null, h: MetricsHeadline) => (n === null ? null : n / h.hours);

/** One headline tile: what, the number, its change on the window before, and the trend behind it. */
export interface HeadlineTile {
  id: string;
  label: string;
  value: string;
  change: Change;
  spark: (number | null)[];
  /** Timings draw on a log scale, like their chart. */
  sparkLog: boolean;
}

/**
 * The stat row (golden signals / RED): traffic, errors, latency, saturation-ish lags, then alerts and refusals. Counts
 * compare per hour (`hours`), since the current window ends in a partial hour.
 */
export function headlineTiles(charts: ChartsData): HeadlineTile[] {
  const { current, previous } = charts.headline;
  const { trend } = charts;
  const requestRate = perHour(current.requests, current);
  return [
    {
      id: "requests",
      label: "Requests per hour",
      value: requestRate === null ? "No data" : countText(Math.round(requestRate)),
      change: percentChange(requestRate, perHour(previous.requests, previous), null),
      spark: sumSeries([trend.requests.c2xx, trend.requests.c3xx, trend.requests.c4xx, trend.requests.c5xx]),
      sparkLog: false,
    },
    {
      id: "errors",
      label: "Error rate (5xx)",
      value: errorRate(current) === null ? "No data" : rateText(errorRate(current)),
      change: percentChange(errorRate(current), errorRate(previous), true),
      spark: errorRateSeries(trend.requests),
      sparkLog: false,
    },
    {
      id: "request-p95",
      label: "Request p95",
      value: trendMsText(current.requestP95Ms),
      change: bucketChange(current.requestP95Ms, previous.requestP95Ms),
      spark: [...trend.requestMs.p95],
      sparkLog: true,
    },
    {
      id: "poll-lag",
      label: "Poll lag p95",
      value: trendMsText(current.pollLagP95Ms),
      change: bucketChange(current.pollLagP95Ms, previous.pollLagP95Ms),
      spark: [...trend.pollLagP95Ms],
      sparkLog: true,
    },
    {
      id: "agent-lag",
      label: "Agent upload lag p95",
      value: trendMsText(current.agentLagP95Ms),
      change: bucketChange(current.agentLagP95Ms, previous.agentLagP95Ms),
      spark: [...trend.agentLagP95Ms],
      sparkLog: true,
    },
    {
      id: "alerts",
      label: "Alerts fired",
      value: countText(current.alertsFired),
      change: percentChange(perHour(current.alertsFired, current), perHour(previous.alertsFired, previous), true),
      spark: [...trend.alertsFired],
      sparkLog: false,
    },
    {
      id: "refused",
      label: "Refused and dropped",
      value: countText(current.refusedAndDropped),
      change: percentChange(perHour(current.refusedAndDropped, current), perHour(previous.refusedAndDropped, previous), true),
      spark: sumSeries(refusedSeries(trend)),
      sparkLog: false,
    },
  ];
}

/** The sparkline's drawing box (an SVG viewBox, stretched to the tile; the stroke doesn't scale). */
export const SPARK_WIDTH = 100;
export const SPARK_HEIGHT = 24;

/**
 * A sparkline as an SVG path: one subpath per run of known hours, so a null hour is a gap. An isolated hour is a
 * zero-length segment (a dot with round caps). Scaled to the series' own range, log for timings. Empty when no hour
 * has data.
 */
export function sparklinePath(values: Series, log: boolean): string {
  const y = (v: number) => (log ? Math.log10(Math.max(v, 1)) : v);
  const known = values.filter((v): v is number => v !== null).map(y);
  if (known.length === 0) return "";
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const pad = 2;
  const toY = (v: number) => (hi === lo ? SPARK_HEIGHT / 2 : pad + (1 - (y(v) - lo) / (hi - lo)) * (SPARK_HEIGHT - 2 * pad));
  const toX = (i: number) => (values.length < 2 ? SPARK_WIDTH / 2 : (i / (values.length - 1)) * SPARK_WIDTH);
  const round = (n: number) => Math.round(n * 100) / 100;
  let path = "";
  let open = false;
  values.forEach((v, i) => {
    if (v === null) {
      open = false;
      return;
    }
    const point = `${round(toX(i))} ${round(toY(v))}`;
    const next = values[i + 1];
    if (!open) {
      path += `M${point}`;
      // A lone hour: a zero-length segment, which round caps draw as a dot.
      if (next === null || next === undefined) path += "l0 0";
      open = true;
    } else path += `L${point}`;
  });
  return path;
}

/** The trend's hours as uPlot x values (seconds), local time on the axis. */
export function trendTimes(trend: Pick<MetricsTrend, "from" | "points">): number[] {
  const from = Date.parse(trend.from) / 1000;
  return Array.from({ length: trend.points }, (_, i) => from + i * HOUR_S);
}

/**
 * Cumulative sums for a stacked bar chart, bottom series first: entry k is series 0..k summed. An hour where every
 * series is null stays null in all of them (a gap); otherwise a null counts as 0.
 */
export function stackSeries(bottomFirst: readonly Series[]): (number | null)[][] {
  const known = sumSeries(bottomFirst).map((v) => v !== null);
  let running: (number | null)[] = known.map((k) => (k ? 0 : null));
  return bottomFirst.map((s) => {
    running = running.map((r, i) => (r === null ? null : r + (s[i] ?? 0)));
    return running;
  });
}

/** The highest bucket bound in a series (the over value ranks last), or null when it has no data. */
export function worstMs(values: Series): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : Math.max(...known);
}

const total = (values: Series) => values.reduce<number>((sum, v) => sum + (v ?? 0), 0);

/** One drawn series: its legend label, colour token, the values the legend shows, and what is drawn (stacked, clamped). */
export interface ChartSeries {
  label: string;
  /** A CSS custom property from the theme, e.g. `--color-series-1`. */
  color: string;
  values: (number | null)[];
  drawn: (number | null)[];
}

export interface TrendChartSpec {
  id: string;
  title: string;
  /** The chart's numbers in one sentence: the canvas is aria-hidden, so this and the Details are the text path. */
  summary: string;
  unit: "ms" | "count";
  bars: boolean;
  /** In drawing order; for a stack the top (the total) first, so each lower stack covers it. */
  series: ChartSeries[];
}

/** Timings draw on a log scale, where 0 has no place: the lowest bucket bound stands in (the legend keeps the value). */
const msDrawn = (values: Series) => values.map((v) => (v === null ? null : Math.max(v, 1)));

const line = (label: string, color: string, values: Series, unit: "ms" | "count"): ChartSeries => ({
  label,
  color,
  values: [...values],
  drawn: unit === "ms" ? msDrawn(values) : [...values],
});

/** A stack, given bottom first (the series that matters most sits on the baseline), returned in drawing order. */
function stacked(bottomFirst: ReadonlyArray<{ label: string; color: string; values: Series }>): ChartSeries[] {
  const sums = stackSeries(bottomFirst.map((s) => s.values));
  return bottomFirst.map((s, k) => ({ label: s.label, color: s.color, values: [...s.values], drawn: sums[k] })).reverse();
}

const hoursWith = (values: Series) => values.filter((v) => v !== null && v > 0).length;
const gapHours = (values: Series) => values.filter((v) => v === null).length;
const plural = (n: number, one: string, many: string) => `${countText(n)} ${n === 1 ? one : many}`;

/** The System panel's charts, in reading order (traffic and errors, latency, dependencies, lag, refusals). */
export function systemChartSpecs(trend: MetricsTrend): TrendChartSpec[] {
  const { requests } = trend;
  const all = sumSeries([requests.c2xx, requests.c3xx, requests.c4xx, requests.c5xx]);
  const gaps = gapHours(all);
  const errors = total(requests.c5xx);
  const refused = [
    { label: "Agent uploads refused", color: "--color-series-1", values: trend.agentRefused },
    { label: "Sign-ups refused", color: "--color-series-2", values: trend.signupRefused },
    { label: "History rows dropped", color: "--color-series-3", values: trend.historyRowsDropped },
    { label: "Alert log entries dropped", color: "--color-series-4", values: trend.alertEventsDropped },
    { label: "Push notifications dropped", color: "--color-series-5", values: trend.pushDropped },
  ];
  const refusedTotal = refused.reduce((sum, s) => sum + total(s.values), 0);
  return [
    {
      id: "requests",
      title: "Requests per hour, by status class",
      summary:
        `${countText(total(all))} requests; ${plural(errors, "5xx error", "5xx errors")}` +
        (errors > 0 ? ` in ${plural(hoursWith(requests.c5xx), "hour", "hours")}` : "") +
        (gaps > 0 ? `. No data for ${plural(gaps, "hour", "hours")}.` : "."),
      unit: "count",
      bars: true,
      // 5xx on the baseline, in the reserved problem colour, so it reads first and compares across hours.
      series: stacked([
        { label: "5xx", color: "--color-bad", values: requests.c5xx },
        { label: "4xx", color: "--color-series-4", values: requests.c4xx },
        { label: "3xx", color: "--color-series-3", values: requests.c3xx },
        { label: "2xx", color: "--color-series-1", values: requests.c2xx },
      ]),
    },
    {
      id: "request-latency",
      title: "Request latency",
      summary: `Worst hourly p95 ${trendMsText(worstMs(trend.requestMs.p95))}, p99 ${trendMsText(worstMs(trend.requestMs.p99))}.`,
      unit: "ms",
      bars: false,
      series: [
        line("p50", "--color-ramp-1", trend.requestMs.p50, "ms"),
        line("p95", "--color-ramp-2", trend.requestMs.p95, "ms"),
        line("p99", "--color-ramp-3", trend.requestMs.p99, "ms"),
      ],
    },
    {
      id: "upstream",
      title: "Game server calls, p95",
      summary: `Worst hourly p95: game server API ${trendMsText(worstMs(trend.upstreamP95Ms.vanilla))}, FRM ${trendMsText(worstMs(trend.upstreamP95Ms.frm))}.`,
      unit: "ms",
      bars: false,
      series: [
        line("Game server API", "--color-series-1", trend.upstreamP95Ms.vanilla, "ms"),
        line("FRM", "--color-series-2", trend.upstreamP95Ms.frm, "ms"),
      ],
    },
    {
      id: "database",
      title: "Database queries, p95",
      summary: `Worst hourly p95 ${trendMsText(worstMs(trend.dbP95Ms))}.`,
      unit: "ms",
      bars: false,
      series: [line("Database p95", "--color-series-1", trend.dbP95Ms, "ms")],
    },
    {
      id: "lag",
      title: "Poll and agent upload lag, p95",
      summary: `Worst hourly p95: poll lag ${trendMsText(worstMs(trend.pollLagP95Ms))}, agent upload lag ${trendMsText(worstMs(trend.agentLagP95Ms))}.`,
      unit: "ms",
      bars: false,
      series: [
        line("Poll lag", "--color-series-1", trend.pollLagP95Ms, "ms"),
        line("Agent upload lag", "--color-series-2", trend.agentLagP95Ms, "ms"),
      ],
    },
    {
      id: "refused",
      title: "Refused and dropped, per hour",
      summary:
        refusedTotal === 0
          ? "Nothing refused or dropped."
          : `${countText(refusedTotal)} in all: ` +
            refused
              .filter((s) => total(s.values) > 0)
              .map((s) => `${s.label.toLowerCase()} ${countText(total(s.values))}`)
              .join(", ") +
            ".",
      unit: "count",
      bars: true,
      series: stacked(refused),
    },
  ];
}

/** The Alert quality panel's chart. */
export function alertsChartSpec(trend: MetricsTrend): TrendChartSpec {
  const fired = total(trend.alertsFired);
  return {
    id: "alerts",
    title: "Alerts fired per hour",
    summary: `${plural(fired, "alert", "alerts")} fired${fired > 0 ? ` in ${plural(hoursWith(trend.alertsFired), "hour", "hours")}` : ""}.`,
    unit: "count",
    bars: true,
    series: [line("Alerts fired", "--color-series-1", trend.alertsFired, "count")],
  };
}
