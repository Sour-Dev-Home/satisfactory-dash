import type { HistoryItems, HistoryRange } from "@satisfactory-dash/shared";
import type uPlot from "uplot";

type Point = HistoryItems["series"][number]["points"][number];

// The same picker as the Power page's stored ranges (ADR-0027), without its "Live" choice.
export const RANGES: HistoryRange[] = ["1h", "6h", "24h", "7d", "30d", "1y"];

export const RANGE_LABEL: Record<HistoryRange, string> = {
  "1h": "1 h",
  "6h": "6 h",
  "24h": "24 h",
  "7d": "7 d",
  "30d": "30 d",
  "1y": "1 y",
};

/** The range spelled out, for titles and the text summary. */
export const RANGE_WORDS: Record<HistoryRange, string> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "1y": "Last year",
};

/**
 * uPlot data (seconds on x): the bucket average rate and the capacity. Nothing is interpolated:
 * where a bucket is missing (paused, unreachable) a null goes in, so the line breaks at the gap.
 */
export function toItemChartData(points: readonly Point[], resolutionSeconds: number): uPlot.AlignedData {
  const xs: number[] = [];
  const current: (number | null)[] = [];
  const capacity: (number | null)[] = [];
  const step = resolutionSeconds * 1000;
  points.forEach((p, i) => {
    const previous = points[i - 1];
    if (previous && p.t - previous.t > step) {
      xs.push((previous.t + step) / 1000);
      current.push(null);
      capacity.push(null);
    }
    xs.push(p.t / 1000);
    current.push(p.currentPerMinute.avg);
    capacity.push(p.maxPerMinute);
  });
  return [xs, current, capacity];
}

export interface ItemStats {
  /** Average of the bucket averages, weighted by their samples. */
  average: number;
  /** The lowest and highest single sample over the range (bucket min/max, not averages). */
  low: number;
  high: number;
  /** The newest bucket's capacity. */
  capacity: number;
}

export function itemStats(points: readonly Point[]): ItemStats | null {
  const last = points.at(-1);
  if (!last) return null;
  const samples = points.reduce((n, p) => n + p.samples, 0);
  return {
    average: points.reduce((sum, p) => sum + p.currentPerMinute.avg * p.samples, 0) / samples,
    low: Math.min(...points.map((p) => p.currentPerMinute.min)),
    high: Math.max(...points.map((p) => p.currentPerMinute.max)),
    capacity: last.maxPerMinute,
  };
}
