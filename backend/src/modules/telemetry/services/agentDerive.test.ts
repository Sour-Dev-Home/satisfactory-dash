import { describe, expect, it } from "vitest";
import { AgentFactorySchema, AgentPowerSchema, FactorySchema, PowerSchema } from "@satisfactory-dash/shared";
import type { FactoryBuilding, PowerCircuit } from "../../gameserver/index.js";
import { deriveFactory, derivePower, fuseByCircuit } from "./agentDerive.js";
import { PowerService } from "./powerService.js";
import { ProductionService } from "./productionService.js";
import type { UnitResolver } from "./productionService.js";

/**
 * ADR-0031: an agent sends raw readings and the backend derives status, state, counts and units at ingest. The strongest
 * check that "an agent cannot disagree with the deployed rules" is PARITY: what the local path produces for a reading,
 * with every derived field stripped by the agent-input schema, must derive back to exactly the same thing.
 */

const resolveUnit: UnitResolver = (className) => (className === "Desc_Water_C" ? "m3/min" : className.startsWith("Desc_") ? "items/min" : null);

const rate = (className: string, percent: number, current = percent) => ({ name: className, className, currentPerMinute: current, maxPerMinute: 100, percent });

const building = (id: string, overrides: Partial<FactoryBuilding> = {}): FactoryBuilding => ({
  id,
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Iron Plate",
  isProducing: true,
  isPaused: false,
  production: [rate("Desc_IronPlate_C", 100)],
  consumption: [rate("Desc_IronIngot_C", 100), rate("Desc_Water_C", 90)],
  outputInventory: [],
  circuitGroupId: 1,
  powerConsumed: 4,
  maxPowerConsumed: 4,
  fuseTriggered: false,
  ...overrides,
});

const circuit = (id: number, overrides: Partial<PowerCircuit> = {}): PowerCircuit => ({
  circuitGroupId: id,
  powerProduction: 100,
  powerConsumed: 60,
  powerCapacity: 100,
  maxPowerConsumed: 80,
  fuseTriggered: false,
  batteryPercent: 100,
  batteryDifferential: 0,
  batteryCapacity: 10,
  ...overrides,
});

const localFactory = (buildings: FactoryBuilding[]) => new ProductionService({ getFactoryBuildings: async () => buildings }, resolveUnit).getFactoryOverview();
const localPower = (circuits: PowerCircuit[]) => new PowerService({ getPowerCircuits: async () => circuits }).getPowerOverview();

describe("derivePower", () => {
  const circuits = [
    circuit(1),
    circuit(2, { fuseTriggered: true, powerProduction: 0, powerCapacity: 0, powerConsumed: 0 }),
    circuit(3, { powerConsumed: 120 }),
    circuit(4, { batteryDifferential: -3, batteryPercent: 10 }),
    circuit(5, { batteryDifferential: -3, batteryPercent: 80 }),
    // No NaN circuit: the agent-input schema refuses a non-finite number before any rule runs.
  ];

  it("gives exactly what the local path gives for the same circuits (parity, every status)", async () => {
    const local = await localPower(circuits);
    const agentInput = AgentPowerSchema.parse(local);
    expect(derivePower(agentInput)).toEqual(local);
    expect(local.circuits.map((row) => row.status)).toEqual(["ok", "outage", "at_risk", "at_risk", "ok"]);
  });

  it("ignores a status and a hasOutage an agent still sends: the parsed input has neither, and the derived one answers the rules", () => {
    const lying = { circuits: [{ ...AgentPowerSchema.parse({ circuits: [{ ...(circuitRow(2)) }] }).circuits[0], status: "ok" }], hasOutage: false };
    const derived = derivePower(AgentPowerSchema.parse(lying));
    expect(derived.circuits[0]?.status).toBe("outage");
    expect(derived.hasOutage).toBe(true);
    expect(PowerSchema.safeParse(derived).success).toBe(true);
  });

  it("an empty list is no outage", () => {
    expect(derivePower({ circuits: [] })).toEqual({ circuits: [], hasOutage: false });
  });
});

/** A contract circuit row with a tripped fuse (what an agent sends), built through the local mapping. */
function circuitRow(id: number) {
  return { circuitGroupId: id, productionMW: 0, consumptionMW: 0, capacityMW: 0, maxConsumptionMW: 10, fuseTriggered: true, batteryCapacityMWh: 0, batteryPercent: 0, batteryDifferentialMW: 0 };
}

describe("deriveFactory", () => {
  const buildings: FactoryBuilding[] = [
    building("producing"),
    building("underfed", { production: [rate("Desc_IronPlate_C", 24.7)], consumption: [rate("Desc_IronIngot_C", 80), rate("Desc_Coal_C", 10)] }),
    building("backedUp", { isProducing: false, outputInventory: [{ name: "Iron Plate", className: "Desc_IronPlate_C", amount: 100, maxAmount: 100 }] }),
    building("paused", { isPaused: true }),
    building("idle", { recipe: null, production: [], consumption: [] }),
    building("unconnected", { circuitGroupId: -1 }),
    building("tripped", { circuitGroupId: 2, fuseTriggered: true }),
    building("unknownFuse", { circuitGroupId: 9, fuseTriggered: undefined }),
    building("unknownItem", { production: [rate("Mod_Thing_C", 100)] }),
  ];
  // The circuits the power reading has: 1 healthy, 2 with a tripped fuse; circuit 9 is not reported.
  const fuses = fuseByCircuit({ circuits: [circuit(1), circuit(2, { fuseTriggered: true })].map(toResponseCircuit), hasOutage: true });

  function toResponseCircuit(row: PowerCircuit) {
    return { circuitGroupId: row.circuitGroupId, productionMW: row.powerProduction, consumptionMW: row.powerConsumed, capacityMW: row.powerCapacity, maxConsumptionMW: row.maxPowerConsumed, fuseTriggered: row.fuseTriggered, batteryCapacityMWh: row.batteryCapacity, batteryPercent: row.batteryPercent, batteryDifferentialMW: row.batteryDifferential, status: "ok" as const };
  }

  it("gives exactly what the local path gives for the same buildings (parity: state, units, backedUpCount, stateCounts)", async () => {
    const local = await localFactory(buildings);
    const agentInput = AgentFactorySchema.parse(local);
    const derived = deriveFactory(agentInput, fuses, resolveUnit);
    expect(derived).toEqual(local);
    expect(FactorySchema.safeParse(derived).success).toBe(true);
    // The reading really exercises every rule.
    expect(Object.fromEntries(local.buildings.map((row) => [row.id, row.state]))).toEqual({
      producing: "producing",
      underfed: "underfed",
      backedUp: "backedUp",
      paused: "paused",
      idle: "idle",
      unconnected: "unpowered",
      tripped: "unpowered",
      unknownFuse: undefined,
      unknownItem: "producing",
    });
    expect(local.backedUpCount).toBe(1);
    expect(local.buildings.find((row) => row.id === "unknownItem")?.production[0]?.unit).toBeNull();
  });

  it("a stale or missing power reading leaves the fuse unknown: no state for a machine that needs it, never a guess", () => {
    const input = AgentFactorySchema.parse({ buildings: [{ ...buildings[0], isBackedUp: false }] });
    const withoutFuses = deriveFactory(input, undefined, resolveUnit);
    expect(withoutFuses.buildings[0]?.state).toBeUndefined();
    expect(withoutFuses.stateCounts).toEqual({});
    // A machine that needs no fuse to be decided still gets its state.
    const paused = AgentFactorySchema.parse({ buildings: [{ ...building("p", { isPaused: true }), isBackedUp: false }] });
    expect(deriveFactory(paused, undefined, resolveUnit).buildings[0]?.state).toBe("paused");
  });

  it("the agent's `state`, `unit`, `stateCounts` and `backedUpCount` are ignored: an agent on older rules cannot disagree", async () => {
    const local = await localFactory([building("underfed", { production: [rate("Desc_IronPlate_C", 24.7)] })]);
    const lying = {
      buildings: local.buildings.map((row) => ({ ...row, state: "producing", production: row.production.map((entry) => ({ ...entry, unit: "m3/min" })) })),
      backedUpCount: 7,
      stateCounts: { producing: 1 },
    };
    const derived = deriveFactory(AgentFactorySchema.parse(lying), fuses, resolveUnit);
    expect(derived).toEqual(local);
    expect(derived.buildings[0]?.state).toBe("underfed");
    expect(derived.backedUpCount).toBe(0);
    expect(derived.stateCounts).toEqual({ underfed: 1 });
  });

  it("a paused building with no circuit id is still 'paused', as on the local path (pause needs no fuse)", () => {
    const input = AgentFactorySchema.parse({ buildings: [{ ...building("p"), isBackedUp: false, isPaused: true, circuitGroupId: undefined }] });
    expect(deriveFactory(input, fuses, resolveUnit).buildings[0]?.state).toBe("paused");
  });

  it("a building with no circuit id gets no state (nothing to join a fuse to), and is still served", () => {
    const input = AgentFactorySchema.parse({ buildings: [{ ...building("x"), isBackedUp: false, circuitGroupId: undefined }] });
    expect(deriveFactory(input, fuses, resolveUnit).buildings[0]).not.toHaveProperty("state");
  });
});
