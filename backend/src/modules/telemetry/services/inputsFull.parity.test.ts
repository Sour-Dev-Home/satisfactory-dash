import { describe, expect, it } from "vitest";
import { AgentFactorySchema } from "@satisfactory-dash/shared";
import type { FactoryBuilding } from "../../gameserver/index.js";
import { areInputsFull, mapFactoryBuilding } from "../../gameserver/index.js";
import { classifyBuilding } from "./classifyBuilding.js";
import { isBackedUp } from "./productionService.js";
import { deriveFactory } from "./snapshotDerive.js";

// Issue 201 hunt. Parity: the local poller (domain building -> areInputsFull -> classifyBuilding) and the agent path
// (mapFactoryBuilding -> AgentFactorySchema -> deriveFactory) must classify one building identically.

const rate = (className: string, percent: number) => ({ name: className, className, currentPerMinute: percent, maxPerMinute: 100, percent });
const slot = (className: string, amount: number, maxAmount = 200) => ({ name: className, className, amount, maxAmount });
const base = (o: Partial<FactoryBuilding>): FactoryBuilding => ({
  id: "b", name: "Constructor", className: "Build_ConstructorMk1_C", recipe: "Plate", isProducing: false, isPaused: false,
  production: [rate("Desc_Plate_C", 20)], consumption: [rate("Desc_Ingot_C", 100)], outputInventory: [],
  circuitGroupId: 1, powerConsumed: 4, maxPowerConsumed: 4, ...o,
});
const agentState = (b: FactoryBuilding, fuse: boolean | null = false) => {
  const parsed = AgentFactorySchema.parse({ buildings: [mapFactoryBuilding(b)] });
  return deriveFactory(parsed, () => fuse ?? undefined, () => "items/min").buildings[0]!.state;
};
const localState = (b: FactoryBuilding, fuse: boolean | null = false) =>
  classifyBuilding({ ...b, ...(fuse !== null ? { fuseTriggered: fuse } : {}), inputsFull: areInputsFull(b) }, isBackedUp(b))?.state;

const cases: [string, FactoryBuilding][] = [
  ["inputs full, low percent", base({ inputInventory: [slot("Desc_Ingot_C", 200)] })],
  ["inputs partial, low percent", base({ inputInventory: [slot("Desc_Ingot_C", 10)] })],
  ["inputs full, healthy percent", base({ production: [rate("Desc_Plate_C", 100)], inputInventory: [slot("Desc_Ingot_C", 200)] })],
  ["inventory unknown", base({})],
  ["no ingredients, extra full slot", base({ consumption: [], inputInventory: [slot("Desc_Ingot_C", 200)] })],
  ["extra non-recipe full slot only", base({ inputInventory: [slot("Desc_Other_C", 200)] })],
  ["two slots same ingredient, one full", base({ inputInventory: [slot("Desc_Ingot_C", 200), slot("Desc_Ingot_C", 0)] })],
  ["output full too", base({ inputInventory: [slot("Desc_Ingot_C", 200)], outputInventory: [slot("Desc_Plate_C", 100, 100)] })],
];

describe("inputsFull parity: local poller vs agent path", () => {
  it.each(cases)("%s", (_n, b) => {
    expect(agentState(b)).toBe(localState(b));
  });
  it("full inputs + low percent is backedUp on both paths", () => {
    expect(agentState(cases[0]![1])).toBe("backedUp");
    expect(localState(cases[0]![1])).toBe("backedUp");
  });
});

describe("areInputsFull edges", () => {
  it("is false for a zero-ingredient machine even with full slots", () => {
    expect(areInputsFull(base({ consumption: [], inputInventory: [slot("Desc_Ingot_C", 200)] }))).toBe(false);
  });
  it("ignores full slots for items outside the recipe", () => {
    expect(areInputsFull(base({ inputInventory: [slot("Desc_Other_C", 200)] }))).toBe(false);
  });
  it("is false when a fluid ingredient has no slot (pipes are not inventory), so refineries never qualify", () => {
    const b = base({ consumption: [rate("Desc_Ingot_C", 100), rate("Desc_Water_C", 100)], inputInventory: [slot("Desc_Ingot_C", 200)] });
    expect(areInputsFull(b)).toBe(false);
  });
  it("treats amount above capacity as full and negative capacity as not full", () => {
    expect(areInputsFull(base({ inputInventory: [slot("Desc_Ingot_C", 250)] }))).toBe(true);
    expect(areInputsFull(base({ inputInventory: [slot("Desc_Ingot_C", 0, -1)] }))).toBe(false);
  });
  it("does not go backedUp at exactly the underfed threshold (95)", () => {
    const b = base({ production: [rate("Desc_Plate_C", 95)], inputInventory: [slot("Desc_Ingot_C", 200)] });
    expect(localState(b)).toBe("producing");
  });
  it("uses the BEST output percent: one healthy output keeps it producing", () => {
    const b = base({ production: [rate("A_C", 20), rate("B_C", 100)], inputInventory: [slot("Desc_Ingot_C", 200)] });
    expect(localState(b)).toBe("producing");
  });
  it("stays unpowered/idle/paused ahead of inputsFull", () => {
    const inv = [slot("Desc_Ingot_C", 200)];
    expect(localState(base({ inputInventory: inv, circuitGroupId: -1 }))).toBe("unpowered");
    expect(localState(base({ inputInventory: inv, isPaused: true }))).toBe("paused");
    expect(localState(base({ inputInventory: inv, recipe: null }))).toBe("idle");
    expect(localState(base({ inputInventory: inv }), null)).toBeUndefined();
  });
});
