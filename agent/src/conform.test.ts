import { describe, expect, it } from "vitest";
import { SnapshotRequestSchema } from "@satisfactory-dash/shared";
import type { AgentFactory, AgentPower } from "@satisfactory-dash/shared";
import { agentSnapshotRequestFull } from "@satisfactory-dash/shared/fixtures";
import { conformFactory, conformPlayers, conformPower, conformStatus } from "./conform.js";

/** ADR-0031: the agent conforms what it read to the backend's input bounds, so it never sends a body that would be refused. */

const baseBuilding = agentSnapshotRequestFull.factory.buildings[0]!;
const baseCircuit = agentSnapshotRequestFull.power.circuits[0]!;
const baseRate = baseBuilding.production[0]!;
const accepted = (parts: object) => SnapshotRequestSchema.safeParse({ ...agentSnapshotRequestFull, ...parts }).success;
const long = (n: number) => "x".repeat(n);

// A small seeded generator, so a failure reproduces.
function seeded(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
  return { next, pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]! };
}
const NASTY_NUMBERS = [0, -0.0000001, -5, 1e308, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 100.0000001, 100, 42.5, -1e-9];

describe("strings and lists", () => {
  it("cuts strings to 200 characters and lists to their caps, counting what was cut", () => {
    const building = { ...baseBuilding, id: long(500), name: long(201), className: long(300), recipe: long(250), production: Array.from({ length: 20 }, () => ({ ...baseRate, className: long(400) })) };
    const { value, adjusted } = conformFactory({ buildings: [building] });
    const out = value.buildings[0]!;
    expect([out.id.length, out.name.length, out.className.length, out.recipe?.length]).toEqual([200, 200, 200, 200]);
    expect(out.production).toHaveLength(16);
    expect(out.production[0]!.className.length).toBe(200);
    expect(adjusted).toBe(4); // four rates beyond the cap
    expect(accepted({ factory: value })).toBe(true);
  });

  it("caps buildings (20,000), circuits (1,000) and players (256), keeping the first entries", () => {
    const buildings = Array.from({ length: 20_005 }, (_, i) => ({ ...baseBuilding, id: `b${i}` }));
    const factory = conformFactory({ buildings });
    expect(factory.value.buildings).toHaveLength(20_000);
    expect(factory.value.buildings.at(-1)!.id).toBe("b19999");
    expect(factory.adjusted).toBe(5);
    const power = conformPower({ circuits: Array.from({ length: 1_003 }, (_, i) => ({ ...baseCircuit, circuitGroupId: i })) });
    expect(power.value.circuits).toHaveLength(1_000);
    expect(power.adjusted).toBe(3);
    const players = conformPlayers({ available: true, players: Array.from({ length: 300 }, (_, i) => ({ name: `p${i}`, online: true })) });
    expect(players.value.players).toHaveLength(256);
    expect(players.adjusted).toBe(44);
  });

  it("cuts a long session name and a long player name, and leaves short ones alone", () => {
    expect(conformStatus({ ...agentSnapshotRequestFull.status, sessionName: long(999) }).sessionName).toHaveLength(200);
    expect(conformStatus(agentSnapshotRequestFull.status)).toEqual(agentSnapshotRequestFull.status);
    expect(conformPlayers({ available: true, players: [{ name: long(999), online: false }] }).value.players[0]!.name).toHaveLength(200);
  });

  it("leaves a normal reading exactly as it is (nothing adjusted)", () => {
    const factory = conformFactory(agentSnapshotRequestFull.factory as AgentFactory);
    expect(factory.value).toEqual(agentSnapshotRequestFull.factory);
    expect(factory.adjusted).toBe(0);
    const power = conformPower(agentSnapshotRequestFull.power as AgentPower);
    expect(power.value).toEqual(agentSnapshotRequestFull.power);
    expect(power.adjusted).toBe(0);
  });
});

describe("numbers", () => {
  it("raises noise below zero to 0 and holds battery percent to 0..100, without touching a draining (negative) differential", () => {
    const { value } = conformPower({ circuits: [{ ...baseCircuit, productionMW: -0.0000001, consumptionMW: -3, capacityMW: -1, maxConsumptionMW: -2, batteryCapacityMWh: -1, batteryPercent: 100.0000001, batteryDifferentialMW: -4.5 }] });
    expect(value.circuits[0]).toMatchObject({ productionMW: 0, consumptionMW: 0, capacityMW: 0, maxConsumptionMW: 0, batteryCapacityMWh: 0, batteryPercent: 100, batteryDifferentialMW: -4.5 });
    expect(conformPower({ circuits: [{ ...baseCircuit, batteryPercent: -0.5 }] }).value.circuits[0]!.batteryPercent).toBe(0);
  });

  it("DROPS a circuit or a rate whose number is not finite (unknown is not zero: a 0 percent would read as underfed)", () => {
    const power = conformPower({ circuits: [baseCircuit, { ...baseCircuit, circuitGroupId: 2, productionMW: Number.NaN }, { ...baseCircuit, circuitGroupId: 3, batteryDifferentialMW: Number.POSITIVE_INFINITY }] });
    expect(power.value.circuits.map((circuit) => circuit.circuitGroupId)).toEqual([baseCircuit.circuitGroupId]);
    expect(power.adjusted).toBe(2);
    const factory = conformFactory({ buildings: [{ ...baseBuilding, production: [baseRate, { ...baseRate, percent: Number.NaN }, { ...baseRate, maxPerMinute: Number.NEGATIVE_INFINITY }] }] });
    expect(factory.value.buildings[0]!.production).toHaveLength(1);
    expect(factory.adjusted).toBe(2);
  });

  it("raises negative rates and clock speed to 0, and keeps a percent above 100 (float noise the contract allows)", () => {
    const { value } = conformFactory({ buildings: [{ ...baseBuilding, clockSpeedPercent: -3, production: [{ ...baseRate, currentPerMinute: -1, maxPerMinute: -2, percent: 100.4 }] }] });
    expect(value.buildings[0]!.clockSpeedPercent).toBe(0);
    expect(value.buildings[0]!.production[0]).toMatchObject({ currentPerMinute: 0, maxPerMinute: 0, percent: 100.4 });
  });

  it("drops a location or clock speed that is not finite, and a non-integer circuit id, instead of sending it", () => {
    const { value } = conformFactory({ buildings: [{ ...baseBuilding, circuitGroupId: 1.5, clockSpeedPercent: Number.NaN, location: { xM: Number.NaN, yM: 0, zM: 0, rotationDeg: 0 } }] });
    const out = value.buildings[0]!;
    expect(out).not.toHaveProperty("circuitGroupId");
    expect(out).not.toHaveProperty("clockSpeedPercent");
    expect(out).not.toHaveProperty("location");
    expect(accepted({ factory: value })).toBe(true);
  });
});

describe("whatever the game sends, the conformed reading is ACCEPTED by the backend's schema (fuzz, seeded)", () => {
  it("1,000 hostile buildings and circuits always conform", () => {
    const random = seeded(12_345);
    const number = () => random.pick(NASTY_NUMBERS);
    const text = () => random.pick(["", "ok", long(200), long(201), long(5000), "Ünïcode 🔐"]);
    for (let round = 0; round < 50; round++) {
      const buildings = Array.from({ length: 10 }, (_, i) => ({
        id: text() || `b${i}`,
        name: text(),
        className: text(),
        recipe: random.next() < 0.3 ? null : text(),
        isProducing: random.next() < 0.5,
        isPaused: random.next() < 0.5,
        isBackedUp: random.next() < 0.5,
        circuitGroupId: random.pick([0, 1, -1, 2.5, 7]),
        clockSpeedPercent: random.next() < 0.5 ? number() : undefined,
        production: Array.from({ length: Math.floor(random.next() * 20) }, () => ({ name: text(), className: text(), currentPerMinute: number(), maxPerMinute: number(), percent: number() })),
        ingredients: random.next() < 0.5 ? Array.from({ length: Math.floor(random.next() * 20) }, () => ({ name: text(), className: text(), currentPerMinute: number(), maxPerMinute: number(), percent: number() })) : undefined,
      }));
      const circuits = Array.from({ length: 10 }, (_, i) => ({ circuitGroupId: i, productionMW: number(), consumptionMW: number(), capacityMW: number(), maxConsumptionMW: number(), fuseTriggered: random.next() < 0.5, batteryCapacityMWh: number(), batteryPercent: number(), batteryDifferentialMW: number() }));
      const factory = conformFactory({ buildings: buildings as AgentFactory["buildings"] });
      const power = conformPower({ circuits });
      const players = conformPlayers({ available: true, players: Array.from({ length: 5 }, () => ({ name: text(), online: true })) });
      const status = conformStatus({ ...agentSnapshotRequestFull.status, sessionName: text() });
      expect(accepted({ factory: factory.value, power: power.value, players: players.value, status }), `round ${round}`).toBe(true);
    }
  });
});
