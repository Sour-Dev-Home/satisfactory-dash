import { describe, expect, it } from "vitest";
import {
  FactoryResponseSchema,
  HistoryPowerResponseSchema,
  HistoryRangeSchema,
  ManagedServerListResponseSchema,
  PowerHistoryResponseSchema,
  PowerResponseSchema,
  ServerListResponseSchema,
  SettingsResponseSchema,
  StatusResponseSchema,
} from "@satisfactory-dash/shared";
import * as world from "./world";

// ADR-0026: the demo world must satisfy the real contract, so the demo exercises the real
// app's parsing and can't drift from what the backend sends.

const TIMES = [world.DEMO_EPOCH, world.DEMO_EPOCH + 12_345, world.DEMO_EPOCH + 3_600_000, Date.now()];

describe("the demo world", () => {
  it.each(TIMES)("matches the shared schemas at t=%i", (now) => {
    expect(() => ServerListResponseSchema.parse(world.servers)).not.toThrow();
    expect(() => ManagedServerListResponseSchema.parse(world.managedServers)).not.toThrow();
    expect(() => StatusResponseSchema.parse(world.status(now))).not.toThrow();
    expect(() => PowerResponseSchema.parse(world.power(now))).not.toThrow();
    expect(() => PowerHistoryResponseSchema.parse(world.powerHistory(now))).not.toThrow();
    expect(() => FactoryResponseSchema.parse(world.factory(now))).not.toThrow();
    expect(() => SettingsResponseSchema.parse(world.settings(now, { autoPause: true, pending: true }))).not.toThrow();
  });

  it.each(HistoryRangeSchema.options)("stores power history for %s that matches the schema, oldest first", (range) => {
    const history = HistoryPowerResponseSchema.parse(world.historyPower(world.DEMO_EPOCH, range)).data;
    expect(history.range).toBe(range);
    for (const series of history.series) {
      const ts = series.points.map((p) => p.t);
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
      expect(ts.every((t) => t % (history.resolutionSeconds * 1000) === 0 && t >= history.from - history.resolutionSeconds * 1000 && t < history.to)).toBe(true);
      // ADR-0027: at most about 600 points per series.
      expect(series.points.length).toBeLessThanOrEqual(600);
    }
  });

  it.each(HistoryRangeSchema.options)(
    "leaves a stretch with nothing recorded in the stored history for %s, like a paused game",
    (range) => {
      // Regression: the gap used to be defined by a fixed clock time (28-30h ago), which a 1h/6h/24h
      // range's window never reaches, so those ranges could never show a gap.
      const history = world.historyPower(world.DEMO_EPOCH, range).data;
      const ts = history.series[0].points.map((p) => p.t);
      const step = history.resolutionSeconds * 1000;
      expect(ts.some((t, i) => i > 0 && t - ts[i - 1] > step)).toBe(true);
    },
  );

  it("is deterministic: the same time gives the same data", () => {
    expect(world.power(world.DEMO_EPOCH)).toEqual(world.power(world.DEMO_EPOCH));
    expect(world.powerHistory(world.DEMO_EPOCH)).toEqual(world.powerHistory(world.DEMO_EPOCH));
  });

  it("moves with time, so the chart isn't a flat line", () => {
    const a = world.power(world.DEMO_EPOCH).data.circuits[0].productionMW;
    const b = world.power(world.DEMO_EPOCH + 20_000).data.circuits[0].productionMW;
    expect(a).not.toBe(b);
  });

  it("keeps history consistent with the live reading: a full window, oldest first, never ahead of now", () => {
    const now = world.DEMO_EPOCH + 7_000;
    const history = world.powerHistory(now).data;
    for (const series of history.series) {
      expect(series.points).toHaveLength(history.windowSeconds / history.intervalSeconds);
      const times = series.points.map((p) => p.t);
      expect(times).toEqual([...times].sort((x, y) => x - y));
      expect(times.at(-1)!).toBeLessThanOrEqual(now);
    }
  });

  it("stays within each circuit's capacity and reports no outage, as its 'ok' status says", () => {
    for (let t = world.DEMO_EPOCH; t < world.DEMO_EPOCH + 600_000; t += 7_000) {
      for (const c of world.power(t).data.circuits) {
        expect(c.status).toBe("ok");
        expect(c.consumptionMW).toBeLessThanOrEqual(c.capacityMW);
        expect(c.productionMW).toBeLessThanOrEqual(c.capacityMW);
      }
    }
  });

  it("counts its backed-up machines honestly, and puts every machine on a circuit that exists", () => {
    const { buildings, backedUpCount } = world.factory(world.DEMO_EPOCH).data;
    expect(backedUpCount).toBe(buildings.filter((b) => b.isBackedUp).length);
    const circuits = new Set(world.power(world.DEMO_EPOCH).data.circuits.map((c) => c.circuitGroupId));
    for (const b of buildings) expect(circuits.has(b.circuitGroupId!)).toBe(true);
  });

  it("has a slow tick episode every 10 minutes, healthy at the fixed clock, and agrees with tickHealth", () => {
    expect(world.tickAt(world.DEMO_EPOCH).tickHealth).toBe("healthy");
    const minutes = Array.from({ length: 20 }, (_, m) => world.tickAt(world.DEMO_EPOCH + m * 60_000 + 10_000));
    expect(minutes.map((t) => t.tickHealth)).toEqual(
      Array.from({ length: 20 }, (_, m) => (m % 10 === 5 ? "slow" : "healthy")),
    );
    // The vanilla API's rule: slow means at or below 10 ticks/s, healthy above.
    for (const tick of minutes) expect(tick.tickRate > 10).toBe(tick.tickHealth === "healthy");
  });

  it("varies the players from 0 to the limit over a few minutes, starting at 3 (the fixed clock)", () => {
    expect(world.status(world.DEMO_EPOCH).data.connectedPlayers).toBe(3);
    const seen = new Set<number>();
    for (let t = world.DEMO_EPOCH; t < world.DEMO_EPOCH + 5 * 60_000; t += 10_000) {
      const { connectedPlayers, playerLimit } = world.status(t).data;
      expect(connectedPlayers).toBeGreaterThanOrEqual(0);
      expect(connectedPlayers).toBeLessThanOrEqual(playerLimit);
      seen.add(connectedPlayers);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    // Before the epoch too (a visitor's clock can be anywhere): never out of range.
    expect(world.connectedPlayersAt(world.DEMO_EPOCH - 45_000)).toBeGreaterThanOrEqual(0);
  });

  it("names exactly as many online players as the status counts, at every step (ADR-0029)", () => {
    for (let t = world.DEMO_EPOCH - 60_000; t < world.DEMO_EPOCH + 6 * 60_000; t += 15_000) {
      const roster = world.players(t);
      expect(roster.available).toBe(true);
      expect(roster.players.filter((p) => p.online)).toHaveLength(world.status(t).data.connectedPlayers);
      expect(roster.players.length).toBeLessThanOrEqual(world.status(t).data.playerLimit);
    }
  });

  it("carries none of the test fixtures' markers (they're for edge cases, not a public demo)", () => {
    const text = JSON.stringify([
      world.servers,
      world.status(world.DEMO_EPOCH),
      world.power(world.DEMO_EPOCH),
      world.factory(world.DEMO_EPOCH),
    ]);
    for (const marker of ["ExampleSession", "example-password", "operator", "Satisfactory server"]) {
      expect(text).not.toContain(marker);
    }
  });
});
