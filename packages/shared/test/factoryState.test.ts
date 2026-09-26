import { describe, it, expect } from "vitest";
import { FactoryBuildingSchema, FactoryResponseSchema, FactorySchema } from "../src/index";
import * as fixtures from "../fixtures/index";

const base = {
  id: "b1",
  name: "Constructor",
  className: "Build_ConstructorMk1_C",
  recipe: "Concrete",
  isProducing: true,
  isPaused: false,
  isBackedUp: false,
  production: [],
};

// ADR-0027: additive, optional fields (the deploy-skew rule, ADR-0007).
describe("factory machine state (ADR-0027)", () => {
  it("parses a building with and without ingredients, state and stateCounts (an older backend omits them)", () => {
    expect(FactoryBuildingSchema.safeParse(base).success).toBe(true);
    expect(FactoryBuildingSchema.safeParse({ ...base, ingredients: [], state: "underfed" }).success).toBe(true);
    expect(FactorySchema.safeParse({ buildings: [base], backedUpCount: 0 }).success).toBe(true);
    expect(FactorySchema.safeParse({ buildings: [base], backedUpCount: 0, stateCounts: { producing: 1 } }).success).toBe(true);
  });

  it("accepts a state added later (a plain string, not an enum)", () => {
    expect(FactoryBuildingSchema.parse({ ...base, state: "overclocked" }).state).toBe("overclocked");
  });

  it("rejects a non-string state and non-integer or negative counts", () => {
    expect(FactoryBuildingSchema.safeParse({ ...base, state: 3 }).success).toBe(false);
    expect(FactorySchema.safeParse({ buildings: [], backedUpCount: 0, stateCounts: { idle: 1.5 } }).success).toBe(false);
    expect(FactorySchema.safeParse({ buildings: [], backedUpCount: 0, stateCounts: { idle: -1 } }).success).toBe(false);
  });
});

// The fixture the frontend's Ingredients and State colours are built from (the drift test in fixtures.test.ts
// already matches it to its schema by its `factory` prefix; this pins WHAT it covers, so it can't quietly shrink).
describe("factoryStatesAndIngredients fixture", () => {
  const { data } = FactoryResponseSchema.parse(fixtures.factoryStatesAndIngredients);
  const byState = (state: string | undefined) => data.buildings.filter((building) => building.state === state);

  it("covers every backend-derived state at least once", () => {
    for (const state of ["producing", "idle", "backedUp", "underfed", "paused", "unpowered"]) {
      expect(byState(state).length, state).toBeGreaterThan(0);
    }
  });

  it("has one machine with an unknown state string, and one with no state", () => {
    const known = new Set(["producing", "idle", "backedUp", "underfed", "paused", "unpowered"]);
    expect(data.buildings.filter((b) => b.state !== undefined && !known.has(b.state))).toHaveLength(1);
    expect(byState(undefined).length).toBeGreaterThanOrEqual(1);
  });

  it("has ingredients with a solid and a fluid input, an empty array, and an absent field", () => {
    const units = data.buildings.flatMap((b) => b.ingredients ?? []).map((rate) => rate.unit);
    expect(units).toContain("items/min");
    expect(units).toContain("m3/min");
    expect(data.buildings.some((b) => b.ingredients !== undefined && b.ingredients.length === 0)).toBe(true);
    expect(data.buildings.some((b) => b.ingredients === undefined)).toBe(true);
    // Something that needs ingredients has them: a configured machine with a state names at least one input.
    expect(data.buildings.some((b) => (b.ingredients?.length ?? 0) > 0)).toBe(true);
  });

  it("keeps its counts honest: stateCounts adds up to the machines that have a state, backedUpCount matches", () => {
    const counted = Object.values(data.stateCounts ?? {}).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(data.buildings.filter((b) => b.state !== undefined).length);
    for (const [state, n] of Object.entries(data.stateCounts ?? {})) {
      expect(byState(state).length, state).toBe(n);
    }
    expect(data.backedUpCount).toBe(data.buildings.filter((b) => b.isBackedUp).length);
  });

  it("uses `underfed`, never the old `starved`", () => {
    expect(JSON.stringify(fixtures.factoryStatesAndIngredients)).not.toMatch(/starved/i);
  });

  it("carries only invented values: no real host, token or personal data", () => {
    expect(JSON.stringify(fixtures.factoryStatesAndIngredients)).not.toMatch(/\d+\.\d+\.\d+\.\d+|token|password|@/i);
  });
});
