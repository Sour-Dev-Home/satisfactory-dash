import { describe, it, expect } from "vitest";
import { ProductionService, isBackedUp } from "./productionService.js";
import type { ProductionAdapterLike } from "./productionService.js";
import type { FactoryBuilding } from "../adapters/domain.js";

function building(overrides: Partial<FactoryBuilding> = {}): FactoryBuilding {
  return {
    id: "b1",
    name: "Constructor",
    className: "Build_ConstructorMk1_C",
    recipe: "Concrete",
    isProducing: true,
    isPaused: false,
    production: [],
    consumption: [],
    outputInventory: [],
    circuitId: 1,
    powerConsumed: 4,
    maxPowerConsumed: 4,
    ...overrides,
  };
}

describe("isBackedUp", () => {
  it("is false when not producing, even with a full output slot", () => {
    const b = building({ isProducing: false, outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] });
    expect(isBackedUp(b)).toBe(false);
  });

  it("is false when producing with no output inventory at all", () => {
    expect(isBackedUp(building({ isProducing: true, outputInventory: [] }))).toBe(false);
  });

  it("is false when producing and output has room", () => {
    const b = building({ outputInventory: [{ name: "x", className: "x", amount: 50, maxAmount: 100 }] });
    expect(isBackedUp(b)).toBe(false);
  });

  it("is true when producing and at least one output slot is full, even if others aren't", () => {
    const b = building({
      outputInventory: [
        { name: "x", className: "x", amount: 10, maxAmount: 100 },
        { name: "y", className: "y", amount: 100, maxAmount: 100 },
      ],
    });
    expect(isBackedUp(b)).toBe(true);
  });

  it("is true when a slot's amount exceeds maxAmount (defensive, in case of an out-of-range adapter value)", () => {
    const b = building({ outputInventory: [{ name: "x", className: "x", amount: 150, maxAmount: 100 }] });
    expect(isBackedUp(b)).toBe(true);
  });

  // docs-vault/raw-sources/frm-getFactory.md describes OutputInventory's MaxAmount as
  // "Stack size of the item" — for a real produced item that's always > 0, so a
  // {amount: 0, maxAmount: 0} slot isn't expected to occur per the documented shape.
  // FLAGGED, NOT CONFIRMED: if the FRM's live response ever includes such a slot (e.g.
  // an unconfigured/empty output slot represented as a zeroed entry rather than being
  // omitted — this isn't verified against a live populated save per
  // docs-vault/wiki/frm-api.md's "doc-sourced-but-not-live-verified" caveat), `amount
  // >= maxAmount` (0 >= 0) reads as backed-up when it should mean "no item here at
  // all." This test documents the current (possibly undesired) behavior so a future
  // live-verification pass notices if it changes.
  it("documents current behavior: a zeroed {amount:0, maxAmount:0} slot reads as backed up", () => {
    const b = building({ outputInventory: [{ name: "x", className: "x", amount: 0, maxAmount: 0 }] });
    expect(isBackedUp(b)).toBe(true);
  });
});

describe("ProductionService", () => {
  it("maps buildings and counts backed-up ones", async () => {
    const adapter: ProductionAdapterLike = {
      getFactoryBuildings: async () => [
        building({ id: "b1", outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] }),
        building({ id: "b2", outputInventory: [{ name: "x", className: "x", amount: 10, maxAmount: 100 }] }),
      ],
    };
    const service = new ProductionService(adapter);
    const overview = await service.getFactoryOverview();
    expect(overview.backedUpCount).toBe(1);
    expect(overview.buildings.map((b) => [b.id, b.isBackedUp])).toEqual([
      ["b1", true],
      ["b2", false],
    ]);
  });

  it("returns an empty overview for zero buildings", async () => {
    const adapter: ProductionAdapterLike = { getFactoryBuildings: async () => [] };
    const service = new ProductionService(adapter);
    await expect(service.getFactoryOverview()).resolves.toEqual({ buildings: [], backedUpCount: 0 });
  });

  it("counts backedUpCount per building, not per full slot (a building with several full slots still counts once)", async () => {
    const adapter: ProductionAdapterLike = {
      getFactoryBuildings: async () => [
        building({
          id: "b1",
          outputInventory: [
            { name: "x", className: "x", amount: 100, maxAmount: 100 },
            { name: "y", className: "y", amount: 100, maxAmount: 100 },
            { name: "z", className: "z", amount: 100, maxAmount: 100 },
          ],
        }),
      ],
    };
    const service = new ProductionService(adapter);
    await expect(service.getFactoryOverview()).resolves.toMatchObject({ backedUpCount: 1 });
  });

  it("passes production entries through unchanged (same shape as ProductionRateResponse)", async () => {
    const rate = { name: "Concrete", className: "Desc_Cement_C", currentPerMinute: 0, maxPerMinute: 1.65, percent: 0 };
    const adapter: ProductionAdapterLike = {
      getFactoryBuildings: async () => [building({ production: [rate] })],
    };
    const service = new ProductionService(adapter);
    const overview = await service.getFactoryOverview();
    expect(overview.buildings[0].production).toEqual([rate]);
  });

  it("passes a null recipe through unchanged (unconfigured building)", async () => {
    const adapter: ProductionAdapterLike = {
      getFactoryBuildings: async () => [building({ recipe: null })],
    };
    const service = new ProductionService(adapter);
    const overview = await service.getFactoryOverview();
    expect(overview.buildings[0].recipe).toBeNull();
  });
});
