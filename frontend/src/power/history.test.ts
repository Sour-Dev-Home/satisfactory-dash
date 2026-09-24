import { describe, expect, it } from "vitest";
import {
  powerHistoryEmpty,
  powerHistoryFuseTrip,
  powerHistoryNormal,
  powerOk,
  powerOutage,
} from "@satisfactory-dash/shared/fixtures";
import type { PowerHistory, PowerHistoryPoint } from "@satisfactory-dash/shared";
import { appendReading, fuseTrips, seriesStats, toChartData } from "./history";

const point = (t: number, productionMW = 10): PowerHistoryPoint => ({
  t,
  productionMW,
  consumptionMW: 5,
  capacityMW: 20,
  batteryPercent: 0,
  fuseTriggered: false,
});

describe("toChartData", () => {
  it("gives uPlot aligned columns: seconds, production, consumption, capacity", () => {
    const [xs, prod, cons, cap] = toChartData([point(10_000), point(15_000)], 5);
    expect(xs).toEqual([10, 15]);
    expect(prod).toEqual([10, 10]);
    expect(cons).toEqual([5, 5]);
    expect(cap).toEqual([20, 20]);
  });

  it("breaks the line at a gap (a failed poll) instead of joining across it", () => {
    const [xs, prod] = toChartData([point(10_000), point(15_000), point(40_000)], 5);
    expect(xs).toEqual([10, 15, 20, 40]);
    expect(prod).toEqual([10, 10, null, 10]);
  });

  it("tolerates a little jitter without breaking the line", () => {
    const [xs] = toChartData([point(10_000), point(16_500)], 5);
    expect(xs).toEqual([10, 16.5]);
  });

  it("judges appended points by the poll interval, so a regular poll doesn't break the line", () => {
    const points = [point(10_000), point(15_000), point(25_000), point(35_000)];
    const [xs, prod] = toChartData(points, 5, { afterT: 15_000, intervalSeconds: 10 });
    expect(xs).toEqual([10, 15, 25, 35]);
    expect(prod).not.toContain(null);
  });

  it("still breaks when a poll is missed after the server's samples", () => {
    const points = [point(10_000), point(15_000), point(45_000)];
    const [xs, prod] = toChartData(points, 5, { afterT: 15_000, intervalSeconds: 10 });
    expect(xs).toEqual([10, 15, 25, 45]);
    expect(prod).toEqual([10, 10, null, 10]);
  });

  it("is empty for no points", () => {
    expect(toChartData([], 5)).toEqual([[], [], [], []]);
  });
});

describe("appendReading", () => {
  const history: PowerHistory = powerHistoryNormal.data;
  const last = history.series[0].points.at(-1)!;
  const next = (ms: number) => ({ ...powerOk, observedAt: new Date(last.t + ms).toISOString() });

  it("adds a regular power poll as the newest point of each circuit", () => {
    const merged = appendReading(history, next(5000));
    const points = merged.series[0].points;
    expect(points.at(-1)).toEqual({
      t: last.t + 5000,
      productionMW: powerOk.data.circuits[0].productionMW,
      consumptionMW: powerOk.data.circuits[0].consumptionMW,
      capacityMW: powerOk.data.circuits[0].capacityMW,
      batteryPercent: powerOk.data.circuits[0].batteryPercent,
      fuseTriggered: powerOk.data.circuits[0].fuseTriggered,
    });
  });

  it("trims to the window, so the oldest point falls off", () => {
    const merged = appendReading(history, next(5000));
    expect(merged.series[0].points).toHaveLength(history.series[0].points.length);
    expect(merged.series[0].points[0].t).toBe(history.series[0].points[1].t);
  });

  it("ignores a reading that isn't newer than the last point (a repeat or stale poll)", () => {
    expect(appendReading(history, next(0))).toBe(history);
    expect(appendReading(history, next(-5000))).toBe(history);
  });

  it("ignores a stale reading: the backend is serving last known data", () => {
    expect(appendReading(history, { ...next(5000), stale: true })).toBe(history);
  });

  it("starts a series for a circuit that appears", () => {
    const merged = appendReading(powerHistoryEmpty.data, powerOk);
    expect(merged.series).toHaveLength(1);
    expect(merged.series[0].circuitGroupId).toBe(powerOk.data.circuits[0].circuitGroupId);
    expect(merged.series[0].points).toHaveLength(1);
  });

  it("records a tripped fuse as reported", () => {
    const tripped = powerOutage.data.circuits.find((c) => c.fuseTriggered)!;
    const merged = appendReading(powerHistoryEmpty.data, powerOutage);
    const series = merged.series.find((s) => s.circuitGroupId === tripped.circuitGroupId)!;
    expect(series.points[0]).toMatchObject({ productionMW: 0, fuseTriggered: true });
  });

  it("does not change the history it was given", () => {
    const before = JSON.stringify(history);
    appendReading(history, next(5000));
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe("fuseTrips", () => {
  const tripped = (t: number) => ({ ...point(t, 0), consumptionMW: 0, capacityMW: 0, fuseTriggered: true });

  it("finds each stretch where the fuse was tripped, with when it came back", () => {
    const points = [point(1), tripped(2), tripped(3), point(4), tripped(5)];
    expect(fuseTrips(points)).toEqual([
      { fromT: 2, toT: 4 },
      { fromT: 5, toT: null },
    ]);
  });

  it("is empty when the fuse never tripped", () => {
    expect(fuseTrips([point(1), point(2)])).toEqual([]);
  });

  it("matches the fuse-trip fixture: tripped from the halfway point to now", () => {
    const side = powerHistoryFuseTrip.data.series[1].points;
    expect(fuseTrips(side)).toEqual([{ fromT: side[30].t, toT: null }]);
  });
});

describe("seriesStats", () => {
  it("gives current, min and max production and consumption", () => {
    const stats = seriesStats([point(1, 10), point(2, 30), point(3, 20)]);
    expect(stats).toEqual({
      production: { current: 20, min: 10, max: 30 },
      consumption: { current: 5, min: 5, max: 5 },
    });
  });

  it("is null with no points", () => {
    expect(seriesStats([])).toBeNull();
  });

  it("includes the zeros of a tripped fuse", () => {
    const side = powerHistoryFuseTrip.data.series[1].points;
    expect(seriesStats(side)?.production.min).toBe(0);
    expect(seriesStats(side)?.production.current).toBe(0);
  });
});
