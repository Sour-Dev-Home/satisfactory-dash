import type { PowerHistory, PowerHistoryPoint, PowerResponse } from "@satisfactory-dash/shared";

/**
 * Pure helpers for the live power chart (ADR-0022). The backend sends the last window of
 * samples once; after that each regular power poll is appended here, client-side.
 */

/** A sample later than this many intervals after the previous one means a poll was missed. */
const GAP_FACTOR = 1.5;

/** Where the server's samples end and client-appended polls (a slower cadence) begin. */
export interface LivePart {
  /** Points after this time (Unix ms) were appended from regular power polls. */
  afterT: number;
  intervalSeconds: number;
}

/**
 * uPlot's aligned columns for one circuit: x in Unix seconds, then production, consumption
 * and capacity in MW. A missed sample becomes a null, so the line breaks there instead of
 * joining across the gap (the contract says nothing is interpolated). "Missed" is judged
 * against the server's sampling interval, or the poll interval for appended points.
 */
export function toChartData(
  points: readonly PowerHistoryPoint[],
  intervalSeconds: number,
  live?: LivePart,
): [number[], (number | null)[], (number | null)[], (number | null)[]] {
  const xs: number[] = [];
  const production: (number | null)[] = [];
  const consumption: (number | null)[] = [];
  const capacity: (number | null)[] = [];
  let previous: number | undefined;
  for (const p of points) {
    const t = p.t / 1000;
    const step = live && p.t > live.afterT ? live.intervalSeconds : intervalSeconds;
    if (previous !== undefined && t - previous > step * GAP_FACTOR) {
      xs.push(previous + step);
      production.push(null);
      consumption.push(null);
      capacity.push(null);
    }
    xs.push(t);
    production.push(p.productionMW);
    consumption.push(p.consumptionMW);
    capacity.push(p.capacityMW);
    previous = t;
  }
  return [xs, production, consumption, capacity];
}

/**
 * Adds a regular power poll to the history as the newest point of each circuit, and trims
 * every series to the window. Returns the same object when there's nothing to add: a stale
 * reading (last known data) or one that isn't newer than what's already there.
 */
export function appendReading(history: PowerHistory, reading: PowerResponse): PowerHistory {
  if (reading.stale) return history;
  const t = Date.parse(reading.observedAt);
  const newest = Math.max(-Infinity, ...history.series.map((s) => s.points.at(-1)?.t ?? -Infinity));
  if (!(t > newest)) return history;

  const oldestKept = t - history.windowSeconds * 1000;
  const byId = new Map(history.series.map((s) => [s.circuitGroupId, s.points]));
  for (const c of reading.data.circuits) {
    const point: PowerHistoryPoint = {
      t,
      productionMW: c.productionMW,
      consumptionMW: c.consumptionMW,
      capacityMW: c.capacityMW,
      batteryPercent: c.batteryPercent,
      fuseTriggered: c.fuseTriggered,
    };
    byId.set(c.circuitGroupId, [...(byId.get(c.circuitGroupId) ?? []), point]);
  }
  const series = [...byId]
    .map(([circuitGroupId, points]) => ({ circuitGroupId, points: points.filter((p) => p.t > oldestKept) }))
    .filter((s) => s.points.length > 0);
  return {
    ...history,
    series,
    pausedRanges: history.pausedRanges.filter((r) => r.toT > oldestKept),
  };
}

export interface Range {
  current: number;
  min: number;
  max: number;
}

/** The visible summary next to the chart (its accessible alternative). */
export function seriesStats(points: readonly PowerHistoryPoint[]): { production: Range; consumption: Range } | null {
  if (points.length === 0) return null;
  const range = (values: number[]): Range => ({
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
  });
  return {
    production: range(points.map((p) => p.productionMW)),
    consumption: range(points.map((p) => p.consumptionMW)),
  };
}
