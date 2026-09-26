import type { HistoryPower, HistoryRange } from "@satisfactory-dash/shared";
import type uPlot from "uplot";

type Series = HistoryPower["series"][number];
type Point = Series["points"][number];

/** The picker's choices: the live 5-minute window (ADR-0022), then the stored ranges (ADR-0027). */
export type PowerRange = "live" | HistoryRange;

export const RANGE_LABEL: Record<PowerRange, string> = {
  live: "Live",
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "7d": "7 d",
  "30d": "30 d",
  "1y": "1 y",
};

/** The range spelled out, for headings and accessible names. */
export const RANGE_WORDS: Record<HistoryRange, string> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "1y": "Last year",
};

/**
 * The newest game session's series, and how many older ones there are. Circuit ids aren't the same
 * circuit across sessions (ADR-0006), so the page shows the newest session only; the backend sends
 * the series with the newest data first.
 */
export function currentSession(series: readonly Series[]): { shown: Series[]; olderSessions: number } {
  if (series.length === 0) return { shown: [], olderSessions: 0 };
  const newest = series[0].session;
  const shown = series.filter((s) => s.session === newest).sort((a, b) => a.circuit - b.circuit);
  const older = new Set(series.filter((s) => s.session !== newest).map((s) => s.session));
  return { shown, olderSessions: older.size };
}

/**
 * uPlot data (seconds on x): the bucket averages for production and consumption, and capacity.
 * Nothing is interpolated: where a bucket is missing (paused, unreachable) a null goes in, so the
 * line breaks there instead of drawing a straight line across the gap.
 */
export function toStoredChartData(points: readonly Point[], resolutionSeconds: number): uPlot.AlignedData {
  const xs: number[] = [];
  const production: (number | null)[] = [];
  const consumption: (number | null)[] = [];
  const capacity: (number | null)[] = [];
  const step = resolutionSeconds * 1000;
  points.forEach((p, i) => {
    const previous = points[i - 1];
    if (previous && p.t - previous.t > step) {
      xs.push((previous.t + step) / 1000);
      production.push(null);
      consumption.push(null);
      capacity.push(null);
    }
    xs.push(p.t / 1000);
    production.push(p.productionMW.avg);
    consumption.push(p.consumptionMW.avg);
    capacity.push(p.capacityMW);
  });
  return [xs, production, consumption, capacity];
}

export interface StoredRange {
  /** The newest bucket's average. */
  latest: number;
  /** The lowest and highest single sample over the range (bucket min/max, not averages). */
  min: number;
  max: number;
}

export function storedStats(points: readonly Point[]): { production: StoredRange; consumption: StoredRange } | null {
  const last = points.at(-1);
  if (!last) return null;
  const range = (pick: (p: Point) => { min: number; avg: number; max: number }): StoredRange => ({
    latest: pick(last).avg,
    min: Math.min(...points.map((p) => pick(p).min)),
    max: Math.max(...points.map((p) => pick(p).max)),
  });
  return { production: range((p) => p.productionMW), consumption: range((p) => p.consumptionMW) };
}

/** Stretches of consecutive buckets with the fuse tripped in some sample: [from, to) in ms. */
export function fuseStretches(points: readonly Point[], resolutionSeconds: number): { fromT: number; toT: number }[] {
  const step = resolutionSeconds * 1000;
  const stretches: { fromT: number; toT: number }[] = [];
  for (const p of points) {
    if (p.fuseTrippedSamples === 0) continue;
    const last = stretches.at(-1);
    if (last && last.toT === p.t) last.toT = p.t + step;
    else stretches.push({ fromT: p.t, toT: p.t + step });
  }
  return stretches;
}
