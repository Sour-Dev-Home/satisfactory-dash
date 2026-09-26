import { describe, it, expect } from "vitest";
import { FactoryBuildingSchema, FactorySchema } from "../src/index";

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
