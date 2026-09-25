import { describe, it, expect } from "vitest";
import { FactoryResponseSchema } from "@satisfactory-dash/shared";
import { ProductionService } from "./productionService.js";
import type { FactoryBuilding } from "../../gameserver/index.js";

const rate = (className: string, percent: number) => ({
  name: className,
  className,
  currentPerMinute: percent,
  maxPerMinute: 100,
  percent,
});

function building(id: string, overrides: Partial<FactoryBuilding> = {}): FactoryBuilding {
  return {
    id,
    name: "Assembler",
    className: "Build_AssemblerMk1_C",
    recipe: "Stator",
    isProducing: true,
    isPaused: false,
    production: [rate("Desc_Stator_C", 100)],
    consumption: [rate("Desc_Wire_C", 100)],
    outputInventory: [],
    circuitGroupId: 0,
    powerConsumed: 15,
    maxPowerConsumed: 15,
    fuseTriggered: false,
    ...overrides,
  };
}

const serviceFor = (buildings: FactoryBuilding[]) =>
  new ProductionService({ getFactoryBuildings: async () => buildings }, () => null);

// ADR-0027 PR 2: the factory response carries each machine's derived state and the per-state counts.
describe("factory state and stateCounts (ADR-0027 PR 2)", () => {
  const fleet = [
    building("producing-1"),
    building("producing-2", { production: [rate("Desc_Stator_C", 60)] }),
    building("starved", { production: [rate("Desc_Stator_C", 0)], consumption: [rate("Desc_Wire_C", 0)] }),
    building("backed-up", { outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] }),
    building("paused", { isPaused: true }),
    building("unpowered", { circuitGroupId: -1 }),
    building("tripped", { fuseTriggered: true }),
    building("idle", { recipe: null, production: [], consumption: [] }),
  ];

  it("fills each building's state from the classifier", async () => {
    const { buildings } = await serviceFor(fleet).getFactoryOverview();
    expect(Object.fromEntries(buildings.map((b) => [b.id, b.state]))).toEqual({
      "producing-1": "producing",
      "producing-2": "producing",
      starved: "starved",
      "backed-up": "backedUp",
      paused: "paused",
      unpowered: "unpowered",
      tripped: "unpowered",
      idle: "idle",
    });
  });

  it("counts buildings per state, and the counts add up to the buildings that have a state", async () => {
    const factory = await serviceFor(fleet).getFactoryOverview();
    expect(factory.stateCounts).toEqual({ producing: 2, starved: 1, backedUp: 1, paused: 1, unpowered: 2, idle: 1 });
    expect(Object.values(factory.stateCounts!).reduce((a, b) => a + b, 0)).toBe(fleet.length);
  });

  it("keeps backedUpCount and isBackedUp consistent with the backedUp state", async () => {
    const factory = await serviceFor(fleet).getFactoryOverview();
    expect(factory.backedUpCount).toBe(1);
    expect(factory.stateCounts!.backedUp).toBe(factory.backedUpCount);
  });

  it("OMITS the state (never guesses) when the data is missing, and does not count that building", async () => {
    const noPercent = building("no-percent", { production: [] });
    const noFuse = building("no-fuse", { fuseTriggered: undefined });
    const factory = await serviceFor([building("ok"), noPercent, noFuse]).getFactoryOverview();
    const byId = Object.fromEntries(factory.buildings.map((b) => [b.id, b]));
    expect(byId["no-percent"]).not.toHaveProperty("state");
    expect(byId["no-fuse"]).not.toHaveProperty("state");
    expect(byId["ok"]!.state).toBe("producing");
    expect(factory.stateCounts).toEqual({ producing: 1 });
  });

  it("an empty factory has empty counts", async () => {
    const factory = await serviceFor([]).getFactoryOverview();
    expect(factory).toEqual({ buildings: [], backedUpCount: 0, stateCounts: {} });
  });

  it("does not use isProducing alone: a machine flagged not producing but at a healthy percent is producing", async () => {
    const { buildings } = await serviceFor([building("flappy", { isProducing: false })]).getFactoryOverview();
    expect(buildings[0]!.state).toBe("producing");
  });

  it("validates against the contract, state and counts included", async () => {
    const data = await serviceFor(fleet).getFactoryOverview();
    const envelope = { serverId: "default", observedAt: new Date().toISOString(), stale: false, data };
    expect(FactoryResponseSchema.parse(envelope)).toEqual(envelope);
  });
});
