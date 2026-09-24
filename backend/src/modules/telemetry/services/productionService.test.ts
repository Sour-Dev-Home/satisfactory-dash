import { describe, it, expect } from "vitest";
import { ProductionService, isBackedUp } from "./productionService.js";
import type { ProductionAdapterLike } from "./productionService.js";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import type { FactoryBuilding } from "../../gameserver/index.js";
import {
  capturedBackedUpAssembler,
  capturedFuelRefinery,
  capturedUnassignedAssembler,
} from "../../gameserver/__fixtures__/capturedFixtures.js";

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
    circuitGroupId: 1,
    powerConsumed: 4,
    maxPowerConsumed: 4,
    ...overrides,
  };
}

describe("isBackedUp", () => {
  // B1, found by the 2026-09-22 live captures: a machine whose output is full STOPS
  // producing (71 of 71 full-output machines read IsProducing false), so requiring
  // isProducing meant this never fired. The old test here asserted the bug.
  it("is true when not producing because the output slot is full", () => {
    const b = building({ isProducing: false, outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] });
    expect(isBackedUp(b)).toBe(true);
  });

  it("is false for a paused machine, even with a full output slot", () => {
    const b = building({ isPaused: true, outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] });
    expect(isBackedUp(b)).toBe(false);
  });

  it("is false for an unconfigured machine (no recipe), even with a full output slot", () => {
    const b = building({ recipe: null, outputInventory: [{ name: "x", className: "x", amount: 100, maxAmount: 100 }] });
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

  // This used to be flagged as unverified behavior (0 >= 0 read as backed up). The
  // 2026-09-22 captures settled it: FRM omits empty slots entirely (557 slots, none
  // with Amount 0), so a zero-capacity slot never means "full". Guarded explicitly.
  it("is false for a zeroed {amount:0, maxAmount:0} slot", () => {
    const b = building({ outputInventory: [{ name: "x", className: "x", amount: 0, maxAmount: 0 }] });
    expect(isBackedUp(b)).toBe(false);
  });
});

// End to end from real captured getFactory entries through the real adapter mapping.
describe("isBackedUp on live-captured buildings", () => {
  async function overviewOf(...raw: unknown[]) {
    const adapter = new SatisfactoryServerAdapter(
      { call: async () => undefined as never },
      { get: async () => raw as never },
    );
    return new ProductionService(adapter).getFactoryOverview();
  }

  it("flags the captured backed-up assembler (output 100/100, IsProducing false)", async () => {
    const overview = await overviewOf(capturedBackedUpAssembler);
    expect(overview.buildings[0].isBackedUp).toBe(true);
    expect(overview.backedUpCount).toBe(1);
  });

  it("doesn't flag a producing refinery whose fluid slot has room, or an unconfigured machine", async () => {
    const overview = await overviewOf(capturedFuelRefinery, capturedUnassignedAssembler);
    expect(overview.buildings.map((b) => b.isBackedUp)).toEqual([false, false]);
    expect(overview.buildings[1]).toMatchObject({ recipe: null, production: [] });
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

  // The catalog that fills `unit` arrives in the next PR (ADR-0015); until then it is null.
  it("passes production entries through with unit null (same shape as ProductionRateResponse)", async () => {
    const rate = { name: "Concrete", className: "Desc_Cement_C", currentPerMinute: 0, maxPerMinute: 1.65, percent: 0 };
    const adapter: ProductionAdapterLike = {
      getFactoryBuildings: async () => [building({ production: [rate] })],
    };
    const service = new ProductionService(adapter);
    const overview = await service.getFactoryOverview();
    expect(overview.buildings[0].production).toEqual([{ ...rate, unit: null }]);
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
