import { describe, it, expect } from "vitest";
import { PowerHistorySchema } from "@satisfactory-dash/shared";
import { InMemoryPowerHistoryStore } from "./powerHistoryStore.js";
import type { PowerSample, PowerSampleCircuit } from "./powerHistoryStore.js";

const T0 = 1_700_000_000_000;
const STEP = 5000;

const circuit = (id: number, productionMW: number, extra: Partial<PowerSampleCircuit> = {}): PowerSampleCircuit => ({
  circuitGroupId: id,
  productionMW,
  consumptionMW: productionMW - 10,
  capacityMW: 100,
  batteryPercent: 0,
  fuseTriggered: false,
  ...extra,
});
const sample = (n: number, circuits: PowerSampleCircuit[] = [circuit(0, n)], gamePaused = false): PowerSample => ({
  t: T0 + n * STEP,
  gamePaused,
  circuits,
});
const at = (n: number) => T0 + n * STEP;

/** The three invariants the contract relies on but the schema does not enforce. */
function expectContractInvariants(history: ReturnType<InMemoryPowerHistoryStore["window"]>) {
  expect(PowerHistorySchema.safeParse(history).success).toBe(true);
  const cap = history.windowSeconds / history.intervalSeconds;
  for (const { points } of history.series) {
    expect(points.length).toBeLessThanOrEqual(cap);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].t).toBeGreaterThan(points[i - 1].t);
    }
  }
  for (const { fromT, toT } of history.pausedRanges) {
    expect(fromT).toBeLessThanOrEqual(toT);
  }
}

describe("InMemoryPowerHistoryStore", () => {
  it("starts empty, with the ADR-0022 window and interval", () => {
    const history = new InMemoryPowerHistoryStore().window(T0);
    expect(history).toEqual({ windowSeconds: 300, intervalSeconds: 5, series: [], pausedRanges: [] });
  });

  it("returns points oldest first, one series per circuit, sorted by circuit id", () => {
    const store = new InMemoryPowerHistoryStore();
    for (let n = 0; n < 4; n++) {
      store.append(sample(n, [circuit(2, 20 + n), circuit(0, n), circuit(1, 10 + n)]));
    }
    const history = store.window(at(3));
    expect(history.series.map((s) => s.circuitGroupId)).toEqual([0, 1, 2]);
    expect(history.series[0].points.map((p) => p.productionMW)).toEqual([0, 1, 2, 3]);
    expect(history.series[2].points.map((p) => p.t)).toEqual([at(0), at(1), at(2), at(3)]);
    expectContractInvariants(history);
  });

  it("carries every reading through, including battery and fuse state", () => {
    const store = new InMemoryPowerHistoryStore();
    store.append(sample(0, [circuit(0, 50, { batteryPercent: 42.5, fuseTriggered: true })]));
    expect(store.window(at(0)).series[0].points[0]).toEqual({
      t: at(0),
      productionMW: 50,
      consumptionMW: 40,
      capacityMW: 100,
      batteryPercent: 42.5,
      fuseTriggered: true,
    });
  });

  describe("the ring buffer", () => {
    it("holds exactly window / interval points and overwrites the oldest (wraparound)", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 }); // capacity 4
      for (let n = 0; n < 4; n++) store.append(sample(n));
      expect(store.window(at(3)).series[0].points.map((p) => p.productionMW)).toEqual([0, 1, 2, 3]);
      store.append(sample(4));
      store.append(sample(5));
      const history = store.window(at(5));
      expect(history.series[0].points.map((p) => p.productionMW)).toEqual([2, 3, 4, 5]);
      expectContractInvariants(history);
    });

    it("stays ordered and capped through several full wraps", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 });
      for (let n = 0; n < 27; n++) store.append(sample(n));
      const history = store.window(at(26));
      expect(history.series[0].points.map((p) => p.productionMW)).toEqual([23, 24, 25, 26]);
      expectContractInvariants(history);
    });

    it("the default window is capped at 60 points however many samples arrive", () => {
      const store = new InMemoryPowerHistoryStore();
      for (let n = 0; n < 500; n++) store.append(sample(n));
      const history = store.window(at(499));
      expect(history.series[0].points).toHaveLength(60);
      expect(history.series[0].points[0].productionMW).toBe(440);
      expectContractInvariants(history);
    });

    it("a faster cadence than the interval still cannot exceed the cap", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 });
      for (let n = 0; n < 30; n++) {
        store.append({ t: T0 + n * 1000, gamePaused: false, circuits: [circuit(0, n)] }); // 1 s apart
      }
      expect(store.window(T0 + 29_000).series[0].points.length).toBeLessThanOrEqual(4);
    });
  });

  describe("ordering", () => {
    it("rejects a sample that is not newer than the newest, and stores nothing for it", () => {
      const store = new InMemoryPowerHistoryStore();
      expect(store.append(sample(5))).toBe(true);
      expect(store.append(sample(5, [circuit(0, 999)]))).toBe(false); // same time
      expect(store.append(sample(4, [circuit(0, 888)]))).toBe(false); // older
      const history = store.window(at(5));
      expect(history.series[0].points).toHaveLength(1);
      expect(history.series[0].points[0].productionMW).toBe(5);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2])(
      "rejects a sample time of %s",
      (t) => {
        const store = new InMemoryPowerHistoryStore();
        expect(store.append({ t, gamePaused: false, circuits: [circuit(0, 1)] })).toBe(false);
        expect(store.window(T0).series).toEqual([]);
      },
    );

    it("keeps one reading per circuit id within a sample (a duplicate would put two points at one time)", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0, [circuit(0, 1), circuit(0, 2)]));
      const [{ points }] = store.window(at(0)).series;
      expect(points).toHaveLength(1);
      expect(points[0].productionMW).toBe(2);
    });
  });

  describe("the window", () => {
    it("drops samples at or before now - window, keeps the ones after", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 });
      for (let n = 0; n < 4; n++) store.append(sample(n)); // t = 0, 5, 10, 15 s
      expect(store.window(at(3)).series[0].points).toHaveLength(4); // now = 15 s: cutoff -5 s
      expect(store.window(at(4)).series[0].points.map((p) => p.productionMW)).toEqual([1, 2, 3]); // cutoff 0: t=0 is out
      expect(store.window(at(7)).series).toEqual([]); // cutoff 15 s: everything is out
    });

    it("leaves a gap where polls failed: time between points is never filled in", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0));
      store.append(sample(1));
      store.append(sample(5)); // four ticks missed
      const { points } = store.window(at(5)).series[0];
      expect(points.map((p) => p.t)).toEqual([at(0), at(1), at(5)]);
      expectContractInvariants(store.window(at(5)));
    });

    it("a circuit that appears mid-window has a shorter series", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0, [circuit(0, 1)]));
      store.append(sample(1, [circuit(0, 2)]));
      store.append(sample(2, [circuit(0, 3), circuit(7, 70)]));
      const history = store.window(at(2));
      expect(history.series.map((s) => [s.circuitGroupId, s.points.length])).toEqual([[0, 3], [7, 1]]);
      expectContractInvariants(history);
    });

    it("a circuit that disappears keeps its earlier points", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0, [circuit(0, 1), circuit(3, 30)]));
      store.append(sample(1, [circuit(0, 2)]));
      expect(store.window(at(1)).series.map((s) => [s.circuitGroupId, s.points.length])).toEqual([[0, 2], [3, 1]]);
    });

    it("a sample with no circuits (no save loaded) adds no points but still counts toward the buffer", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0, []));
      expect(store.window(at(0)).series).toEqual([]);
    });
  });

  describe("paused ranges", () => {
    it("has none when the game never paused", () => {
      const store = new InMemoryPowerHistoryStore();
      for (let n = 0; n < 5; n++) store.append(sample(n));
      expect(store.window(at(4)).pausedRanges).toEqual([]);
    });

    it("merges consecutive paused samples into one range, from the first to the last", () => {
      const store = new InMemoryPowerHistoryStore();
      const paused = [false, false, true, true, true, false, false];
      paused.forEach((p, n) => store.append(sample(n, [circuit(0, n)], p)));
      const history = store.window(at(6));
      expect(history.pausedRanges).toEqual([{ fromT: at(2), toT: at(4) }]);
      expectContractInvariants(history);
    });

    it("reports several ranges, oldest first", () => {
      const store = new InMemoryPowerHistoryStore();
      [true, false, true, true, false, true].forEach((p, n) => store.append(sample(n, [circuit(0, n)], p)));
      expect(store.window(at(5)).pausedRanges).toEqual([
        { fromT: at(0), toT: at(0) },
        { fromT: at(2), toT: at(3) },
        { fromT: at(5), toT: at(5) },
      ]);
    });

    it("a range still open at the newest sample ends at that sample", () => {
      const store = new InMemoryPowerHistoryStore();
      [false, true, true].forEach((p, n) => store.append(sample(n, [circuit(0, n)], p)));
      expect(store.window(at(2)).pausedRanges).toEqual([{ fromT: at(1), toT: at(2) }]);
    });

    it("a single paused sample is a well-formed range (fromT equals toT)", () => {
      const store = new InMemoryPowerHistoryStore();
      [false, true, false].forEach((p, n) => store.append(sample(n, [circuit(0, n)], p)));
      const [range] = store.window(at(2)).pausedRanges;
      expect(range.fromT).toBe(range.toT);
    });

    it("only reports the part of a range that is inside the window", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 });
      for (let n = 0; n < 4; n++) store.append(sample(n, [circuit(0, n)], true)); // paused throughout
      expect(store.window(at(5)).pausedRanges).toEqual([{ fromT: at(2), toT: at(3) }]); // cutoff 5 s: t=0,1 out
    });

    it("a pause with no circuits still shows as a paused range", () => {
      const store = new InMemoryPowerHistoryStore();
      store.append(sample(0, [], true));
      expect(store.window(at(0)).pausedRanges).toEqual([{ fromT: at(0), toT: at(0) }]);
    });
  });

  describe("reset", () => {
    it("forgets everything, and the buffer works normally afterwards", () => {
      const store = new InMemoryPowerHistoryStore({ windowSeconds: 20, intervalSeconds: 5 });
      for (let n = 0; n < 6; n++) store.append(sample(n, [circuit(0, n)], n === 5));
      store.reset();
      expect(store.window(at(5))).toEqual({ windowSeconds: 20, intervalSeconds: 5, series: [], pausedRanges: [] });
      // An older time is accepted again: a reset also forgets "the newest sample".
      expect(store.append(sample(1, [circuit(4, 44)]))).toBe(true);
      expect(store.window(at(1)).series).toEqual([
        { circuitGroupId: 4, points: [expect.objectContaining({ t: at(1), productionMW: 44 })] },
      ]);
    });
  });

  it("copies what it stores: changing the caller's objects afterwards changes nothing", () => {
    const store = new InMemoryPowerHistoryStore();
    const mine = sample(0, [circuit(0, 10)]);
    store.append(mine);
    mine.circuits[0].productionMW = 9999;
    mine.circuits.push(circuit(5, 5));
    expect(store.window(at(0)).series).toHaveLength(1);
    expect(store.window(at(0)).series[0].points[0].productionMW).toBe(10);
  });

  it("returns a fresh object each read, so a caller can't corrupt the store through it", () => {
    const store = new InMemoryPowerHistoryStore();
    store.append(sample(0));
    store.window(at(0)).series[0].points.length = 0;
    expect(store.window(at(0)).series[0].points).toHaveLength(1);
  });

  it.each([
    [{ windowSeconds: 0 }],
    [{ windowSeconds: -5 }],
    [{ windowSeconds: 2.5 }],
    [{ intervalSeconds: 0 }],
    [{ intervalSeconds: 1.5 }],
  ])("refuses a bad configuration %j", (options) => {
    expect(() => new InMemoryPowerHistoryStore(options)).toThrow();
  });

  it("a window shorter than the interval still holds one sample", () => {
    const store = new InMemoryPowerHistoryStore({ windowSeconds: 5, intervalSeconds: 10 });
    store.append(sample(0));
    store.append(sample(1));
    expect(store.window(at(1)).series[0].points).toHaveLength(1);
  });
});
