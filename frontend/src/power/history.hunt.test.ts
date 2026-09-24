// Fresh-eyes (test-hunter) pass on the ADR-0022 helpers: boundaries and invariants the
// contract (packages/shared/src/powerHistory.ts) implies.
import { describe, expect, it } from "vitest";
import { powerHistoryFuseTrip, powerHistoryNormal, powerOk } from "@satisfactory-dash/shared/fixtures";
import type { PowerHistory, PowerHistoryPoint, PowerResponse } from "@satisfactory-dash/shared";
import { appendReading, seriesStats, toChartData } from "./history";

const point = (t: number, productionMW = 10): PowerHistoryPoint => ({
  t,
  productionMW,
  consumptionMW: 5,
  capacityMW: 20,
  batteryPercent: 0,
  fuseTriggered: false,
});

const base = powerHistoryNormal.data;
const lastT = base.series[0].points.at(-1)!.t;

/** A regular power poll observed at `t` (Unix ms). */
const readingAt = (t: number, circuits = powerOk.data.circuits): PowerResponse => ({
  ...powerOk,
  observedAt: new Date(t).toISOString(),
  data: { ...powerOk.data, circuits },
});

describe("appendReading, edges", () => {
  it("never mutates the history it was given", () => {
    const history: PowerHistory = structuredClone({ ...base, pausedRanges: [{ fromT: lastT - 60_000, toT: lastT - 30_000 }] });
    const before = structuredClone(history);
    appendReading(history, readingAt(lastT + 10_000));
    expect(history).toEqual(before);
  });

  it("drops a point exactly windowSeconds old and keeps one a millisecond younger", () => {
    const t = lastT + 5000;
    const history: PowerHistory = {
      ...base,
      series: [{ circuitGroupId: 0, points: [point(t - base.windowSeconds * 1000), point(t - base.windowSeconds * 1000 + 1)] }],
    };
    const out = appendReading(history, readingAt(t));
    expect(out.series[0].points.map((p) => p.t)).toEqual([t - base.windowSeconds * 1000 + 1, t]);
  });

  it("keeps a full window at windowSeconds / intervalSeconds points after one more sample", () => {
    const out = appendReading(base, readingAt(lastT + base.intervalSeconds * 1000));
    expect(out.series[0].points).toHaveLength(base.windowSeconds / base.intervalSeconds);
  });

  it("drops a paused range ending exactly at the window edge, keeps one ending just inside", () => {
    const t = lastT + 5000;
    const edge = t - base.windowSeconds * 1000;
    const history: PowerHistory = {
      ...base,
      pausedRanges: [
        { fromT: edge - 10_000, toT: edge },
        { fromT: edge - 10_000, toT: edge + 1 },
      ],
    };
    expect(appendReading(history, readingAt(t)).pausedRanges).toEqual([{ fromT: edge - 10_000, toT: edge + 1 }]);
  });

  it("returns the same object for a reading at exactly the newest time", () => {
    expect(appendReading(base, readingAt(lastT))).toBe(base);
  });

  it("judges 'newer' against the newest point of any circuit, not only the first", () => {
    const history: PowerHistory = {
      ...base,
      series: [
        { circuitGroupId: 0, points: [point(1000)] },
        { circuitGroupId: 1, points: [point(9000)] },
      ],
    };
    expect(appendReading(history, readingAt(5000))).toBe(history);
  });

  it("keeps a circuit that dropped out of the polls only until its points leave the window", () => {
    const history: PowerHistory = {
      ...base,
      series: [
        { circuitGroupId: 0, points: [point(lastT)] },
        { circuitGroupId: 7, points: [point(lastT)] },
      ],
    };
    const soon = appendReading(history, readingAt(lastT + 10_000));
    expect(soon.series.find((s) => s.circuitGroupId === 7)!.points).toHaveLength(1);
    const later = appendReading(soon, readingAt(lastT + base.windowSeconds * 1000));
    expect(later.series.map((s) => s.circuitGroupId)).toEqual([0]);
  });

  // Minor: every append builds a new pausedRanges array even when nothing aged out, so
  // PowerChart's identity check calls redraw() on every poll (on top of setData's own draw).
  it("keeps pausedRanges' identity when no range aged out", () => {
    const history: PowerHistory = { ...base, pausedRanges: [{ fromT: lastT - 20_000, toT: lastT }] };
    expect(appendReading(history, readingAt(lastT + 10_000)).pausedRanges).toBe(history.pausedRanges);
  });
});

describe("toChartData, gap threshold", () => {
  it("joins points exactly 1.5 intervals apart and breaks just past that", () => {
    const joined = toChartData([point(0), point(7500)], 5);
    expect(joined[1]).toEqual([10, 10]);
    const broken = toChartData([point(0), point(7501)], 5);
    expect(broken[1]).toEqual([10, null, 10]);
    expect(broken[0]).toEqual([0, 5, 7.501]);
  });

  it("breaks the line at one missed server sample", () => {
    expect(toChartData([point(0), point(10_000)], 5)[1]).toEqual([10, null, 10]);
  });

  it("judges a point at exactly afterT by the server interval and the next by the poll interval", () => {
    const live = { afterT: 10_000, intervalSeconds: 10 };
    // 0 -> 10 s is a missed 5 s sample (server side); 10 s -> 20 s is one 10 s poll (live).
    const [xs, prod] = toChartData([point(0), point(10_000), point(20_000)], 5, live);
    expect(prod).toEqual([10, null, 10, 10]);
    expect(xs).toEqual([0, 5, 10, 20]);
  });

  it("keeps x strictly ascending with gaps inserted", () => {
    const [xs] = toChartData([point(0), point(5000), point(60_000), point(65_000), point(200_000)], 5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("returns empty columns for no points", () => {
    expect(toChartData([], 5)).toEqual([[], [], [], []]);
  });
});

describe("seriesStats, fuse trip", () => {
  it("reports the tripped circuit's zeros as now and min", () => {
    const tripped = powerHistoryFuseTrip.data.series.find((s) => s.circuitGroupId === 1)!;
    const stats = seriesStats(tripped.points)!;
    expect(stats.production.current).toBe(0);
    expect(stats.production.min).toBe(0);
    expect(stats.production.max).toBeGreaterThan(0);
  });

  it("handles a single point", () => {
    expect(seriesStats([point(0, 42)])!.production).toEqual({ current: 42, min: 42, max: 42 });
  });
});
