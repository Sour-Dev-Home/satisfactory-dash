import { describe, it, expect } from "vitest";
import { FactoryResponseSchema } from "@satisfactory-dash/shared";
import { ProductionService } from "./productionService.js";
import type { FactoryBuilding } from "../../gameserver/index.js";

const building: FactoryBuilding = {
  id: "b1",
  name: "Assembler",
  className: "Build_AssemblerMk1_C",
  recipe: "Reinforced Iron Plate",
  isProducing: true,
  isPaused: false,
  production: [{ name: "Plate", className: "Desc_PlateP", currentPerMinute: 5, maxPerMinute: 5, percent: 100 }],
  consumption: [
    { name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 30, maxPerMinute: 30, percent: 100 },
    { name: "Water", className: "Desc_Water_C", currentPerMinute: 2, maxPerMinute: 4, percent: 50 },
  ],
  outputInventory: [],
  circuitGroupId: 1,
  powerConsumed: 15,
  maxPowerConsumed: 15,
};

// ADR-0027: the factory response also carries what each machine consumes, in the same shape as
// production and with the same unit resolution.
describe("factory ingredients (ADR-0027)", () => {
  const service = (units: Record<string, "items/min" | "m3/min" | null>) =>
    new ProductionService({ getFactoryBuildings: async () => [building] }, (className) => units[className] ?? null);

  it("maps consumption to ingredients with the resolved unit, keeping the percent that starvation is judged by", async () => {
    const factory = await service({ Desc_IronPlate_C: "items/min", Desc_Water_C: "m3/min" }).getFactoryOverview();
    expect(factory.buildings[0]!.ingredients).toEqual([
      { name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 30, maxPerMinute: 30, percent: 100, unit: "items/min" },
      { name: "Water", className: "Desc_Water_C", currentPerMinute: 2, maxPerMinute: 4, percent: 50, unit: "m3/min" },
    ]);
  });

  it("gives an unknown item a null unit rather than guessing, and an empty list when nothing is consumed", async () => {
    const unknown = await service({}).getFactoryOverview();
    expect(unknown.buildings[0]!.ingredients!.map((rate) => rate.unit)).toEqual([null, null]);
    const none = await new ProductionService(
      { getFactoryBuildings: async () => [{ ...building, recipe: null, consumption: [], production: [] }] },
      () => null,
    ).getFactoryOverview();
    expect(none.buildings[0]!.ingredients).toEqual([]);
  });

  it("validates against the contract, which still accepts a response without ingredients or state", async () => {
    const factory = await service({}).getFactoryOverview();
    const envelope = { serverId: "default", observedAt: new Date().toISOString(), stale: false, data: factory };
    expect(FactoryResponseSchema.safeParse(envelope).success).toBe(true);
    const { ingredients: _ingredients, ...withoutIngredients } = factory.buildings[0]!;
    expect(
      FactoryResponseSchema.safeParse({ ...envelope, data: { ...factory, buildings: [withoutIngredients] } }).success,
    ).toBe(true);
  });
});
