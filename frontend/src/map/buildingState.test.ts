import type { FactoryBuilding } from "@satisfactory-dash/shared";
import { describe, expect, it } from "vitest";
import { buildingState, outputPercent } from "./buildingState";

const base: FactoryBuilding = {
  id: "b1",
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Iron Plate",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [
    { name: "Iron Plate", className: "Desc_IronPlate_C", currentPerMinute: 20, unit: "items/min", maxPerMinute: 20, percent: 100 },
  ],
};

describe("buildingState", () => {
  it("is producing when its outputs run above 0 %", () => {
    expect(buildingState(base)).toBe("producing");
  });

  it("is idle at 0 %, even with a recipe", () => {
    expect(buildingState({ ...base, production: [{ ...base.production[0], currentPerMinute: 0, percent: 0 }] })).toBe("idle");
  });

  it("ignores the instantaneous isProducing flag (the contract says show percent)", () => {
    expect(buildingState({ ...base, isProducing: false })).toBe("producing");
  });

  it("puts paused first, then no recipe", () => {
    expect(buildingState({ ...base, isPaused: true, recipe: null, production: [] })).toBe("paused");
    expect(buildingState({ ...base, recipe: null, production: [] })).toBe("noRecipe");
  });

  it("doesn't let backed up change the state: it's a ring on the marker", () => {
    expect(buildingState({ ...base, isBackedUp: true })).toBe("producing");
  });
});

describe("outputPercent", () => {
  it("averages the outputs, or null without any", () => {
    const second = { ...base.production[0], name: "Other", percent: 50 };
    expect(outputPercent({ ...base, production: [base.production[0], second] })).toBe(75);
    expect(outputPercent({ ...base, production: [] })).toBeNull();
  });
});
