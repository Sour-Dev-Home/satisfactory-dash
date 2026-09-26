import { describe, expect, it } from "vitest";
import type { Factory, FactoryBuilding as Out, Power, PowerCircuit as OutCircuit } from "@satisfactory-dash/shared";
import type { FactoryBuilding, PowerCircuit } from "../../gameserver/index.js";
import { UpstreamError } from "../../../platform/errors.js";
import { classifyBuilding } from "./classifyBuilding.js";
import { PlayersService } from "./playersService.js";
import { PowerService } from "./powerService.js";
import { ProductionService } from "./productionService.js";
import type { UnitResolver } from "./productionService.js";

// ADR-0031 refactor A parity: the reference implementations below are the ORIGINAL (origin/main) code, copied inline.

function oldIsBackedUp(b: FactoryBuilding): boolean {
  if (b.isPaused || b.recipe === null) return false;
  return b.outputInventory.some((s) => s.maxAmount > 0 && s.amount >= s.maxAmount);
}

function oldFactory(buildings: FactoryBuilding[], resolveUnit: UnitResolver): Factory {
  const mapped: Out[] = buildings.map((b) => {
    const backedUp = oldIsBackedUp(b);
    const state = classifyBuilding(b, backedUp)?.state;
    return {
      id: b.id,
      name: b.name,
      className: b.className,
      recipe: b.recipe,
      isProducing: b.isProducing,
      isPaused: b.isPaused,
      isBackedUp: backedUp,
      circuitGroupId: b.circuitGroupId,
      ...(b.location ? { location: b.location } : {}),
      ...(b.clockSpeedPercent !== undefined ? { clockSpeedPercent: b.clockSpeedPercent } : {}),
      production: b.production.map((r) => ({ ...r, unit: resolveUnit(r.className) })),
      ingredients: b.consumption.map((r) => ({ ...r, unit: resolveUnit(r.className) })),
      ...(state !== undefined ? { state } : {}),
    } as Out;
  });
  const stateCounts: Record<string, number> = {};
  for (const b of mapped) if (b.state !== undefined) stateCounts[b.state] = (stateCounts[b.state] ?? 0) + 1;
  return { buildings: mapped, backedUpCount: mapped.filter((b) => b.isBackedUp).length, stateCounts };
}

function oldClassifyPower(c: PowerCircuit): OutCircuit["status"] {
  if (c.fuseTriggered === true) return "outage";
  if (
    typeof c.fuseTriggered !== "boolean" ||
    !Number.isFinite(c.powerProduction) ||
    !Number.isFinite(c.powerConsumed) ||
    !Number.isFinite(c.powerCapacity) ||
    !Number.isFinite(c.batteryDifferential) ||
    !Number.isFinite(c.batteryPercent)
  )
    return "at_risk";
  if (c.powerConsumed > c.powerCapacity) return "at_risk";
  if (c.batteryDifferential < 0 && c.batteryPercent < 20) return "at_risk";
  return "ok";
}

function oldPower(circuits: PowerCircuit[]): Power {
  const mapped = circuits.map((c) => ({
    circuitGroupId: c.circuitGroupId,
    productionMW: c.powerProduction,
    consumptionMW: c.powerConsumed,
    capacityMW: c.powerCapacity,
    maxConsumptionMW: c.maxPowerConsumed,
    fuseTriggered: c.fuseTriggered,
    batteryCapacityMWh: c.batteryCapacity,
    batteryPercent: c.batteryPercent,
    batteryDifferentialMW: c.batteryDifferential,
    status: oldClassifyPower(c),
  }));
  return { circuits: mapped, hasOutage: mapped.some((c) => c.status === "outage") };
}

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const resolveUnit: UnitResolver = (c) => (c.startsWith("Desc_W") ? "m3/min" : c.startsWith("Desc_X") ? null : "items/min");

function genBuilding(r: () => number, i: number): FactoryBuilding {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const pct = () => pick([0, 9.4, 24.7, 94.99, 95, 100, 150, NaN, Infinity, -Infinity]);
  const rate = (k: number) => ({ name: `n${k}`, className: pick(["Desc_A", "Desc_W1", "Desc_X9"]), currentPerMinute: r() * 60, maxPerMinute: 60, percent: pct() });
  const slot = () => pick([{ name: "s", className: "Desc_A", amount: 10, maxAmount: 10 }, { name: "s", className: "Desc_A", amount: 3, maxAmount: 10 }, { name: "s", className: "Desc_A", amount: 5, maxAmount: 0 }]);
  const b: FactoryBuilding = {
    id: pick([`b${i}`, `b${i}`, `b${i % 3}`]), // some duplicate ids on purpose
    name: "m",
    className: "Build_Constructor_C",
    recipe: pick([null, "Recipe_A"]),
    isProducing: r() < 0.5,
    isPaused: r() < 0.2,
    production: Array.from({ length: Math.floor(r() * 3) }, (_, k) => rate(k)),
    consumption: Array.from({ length: Math.floor(r() * 3) }, (_, k) => rate(k)),
    outputInventory: Array.from({ length: Math.floor(r() * 3) }, slot),
    circuitGroupId: pick([-1, 0, 1, 2, NaN]),
    powerConsumed: 1,
    maxPowerConsumed: 2,
  };
  const fuse = pick([undefined, true, false]);
  if (fuse !== undefined) b.fuseTriggered = fuse;
  if (r() < 0.5) b.location = { xM: 1, yM: 2, zM: 3, rotationDeg: 4 };
  if (r() < 0.5) b.clockSpeedPercent = pick([0, 50, 100, 250]);
  return b;
}

function genCircuit(r: () => number, i: number): PowerCircuit {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const num = () => pick([0, 1, 50, 100, -5, NaN, Infinity, -Infinity, 19.99, 20]);
  return {
    circuitGroupId: i,
    powerProduction: num(),
    powerConsumed: num(),
    powerCapacity: num(),
    maxPowerConsumed: num(),
    fuseTriggered: pick([true, false, false, undefined as unknown as boolean, "x" as unknown as boolean]),
    batteryPercent: num(),
    batteryDifferential: num(),
    batteryCapacity: num(),
  };
}

describe("refactor A parity with the original telemetry services", () => {
  it("ProductionService matches the original over generated buildings (unique ids)", async () => {
    const r = rng(42);
    for (let round = 0; round < 300; round++) {
      const buildings = Array.from({ length: Math.floor(r() * 8) }, (_, i) => ({ ...genBuilding(r, i), id: `u${i}` }));
      const got = await new ProductionService({ getFactoryBuildings: async () => buildings }, resolveUnit).getFactoryOverview();
      expect(got).toEqual(oldFactory(buildings, resolveUnit));
      // toEqual ignores undefined-valued keys; key presence must match too.
      expect(JSON.stringify(got)).toBe(JSON.stringify(oldFactory(buildings, resolveUnit)));
    }
  });

  it("ProductionService matches the original when building ids are duplicated (each machine keeps its own fuse)", async () => {
    const mk = (fuse: boolean | undefined): FactoryBuilding => ({
      id: "dup", name: "m", className: "C", recipe: "R", isProducing: true, isPaused: false,
      production: [{ name: "p", className: "Desc_A", currentPerMinute: 1, maxPerMinute: 1, percent: 100 }],
      consumption: [], outputInventory: [], circuitGroupId: 1, powerConsumed: 1, maxPowerConsumed: 1,
      ...(fuse !== undefined ? { fuseTriggered: fuse } : {}),
    });
    const buildings = [mk(true), mk(false), mk(undefined)];
    const got = await new ProductionService({ getFactoryBuildings: async () => buildings }, resolveUnit).getFactoryOverview();
    expect(got).toEqual(oldFactory(buildings, resolveUnit));
  });

  it("ProductionService matches the original over generated buildings including duplicate ids", async () => {
    const r = rng(7);
    for (let round = 0; round < 300; round++) {
      const buildings = Array.from({ length: Math.floor(r() * 8) }, (_, i) => genBuilding(r, i));
      const got = await new ProductionService({ getFactoryBuildings: async () => buildings }, resolveUnit).getFactoryOverview();
      expect(got).toEqual(oldFactory(buildings, resolveUnit));
    }
  });

  it("PowerService matches the original over generated circuits, including NaN/Infinity and a non-boolean fuse", async () => {
    const r = rng(99);
    for (let round = 0; round < 500; round++) {
      const circuits = Array.from({ length: Math.floor(r() * 6) }, (_, i) => genCircuit(r, i));
      const got = await new PowerService({ getPowerCircuits: async () => circuits }).getPowerOverview();
      const want = oldPower(circuits);
      expect(got).toEqual(want);
      expect(got.circuits.map((c) => Object.keys(c).join())).toEqual(want.circuits.map((c) => Object.keys(c).join()));
    }
  });

  it("PlayersService keeps the error handling: absent -> unavailable, invalid_response and other errors rethrown", async () => {
    const svc = (err: unknown) => new PlayersService({ getPlayers: async () => { throw err; } });
    expect(await svc(new UpstreamError("x", { failureKind: "unreachable" })).getPlayers()).toEqual({ available: false, players: [] });
    expect(await svc(new UpstreamError("x", { status: 401 })).getPlayers()).toEqual({ available: false, players: [] });
    const invalid = new UpstreamError("x", { failureKind: "invalid_response" });
    await expect(svc(invalid).getPlayers()).rejects.toBe(invalid);
    const plain = new Error("boom");
    await expect(svc(plain).getPlayers()).rejects.toBe(plain);
    expect(await new PlayersService({ getPlayers: async () => [{ name: "a", online: true, extra: 1 } as never] }).getPlayers()).toEqual({
      available: true,
      players: [{ name: "a", online: true }],
    });
  });
});
