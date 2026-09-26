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
    expect(FactoryBuildingSchema.safeParse({ ...base, ingredients: [], state: "starved" }).success).toBe(true);
    expect(FactorySchema.safeParse({ buildings: [base], backedUpCount: 0 }).success).toBe(true);
    expect(FactorySchema.safeParse({ buildings: [base], backedUpCount: 0, stateCounts: { producing: 1 } }).success).toBe(true);
  });

  it("accepts a state added later (a plain string, not an enum)", () => {
    expect(FactoryBuildingSchema.parse({ ...base, state: "overclocked" }).state).toBe("overclocked");
  });

  it("clockSpeedPercent is optional (an older backend omits it) and is a plain number, above 100 when overclocked", () => {
    expect(FactoryBuildingSchema.safeParse(base).success).toBe(true);
    for (const percent of [100, 50, 160, 133.333]) {
      expect(FactoryBuildingSchema.parse({ ...base, clockSpeedPercent: percent }).clockSpeedPercent).toBe(percent);
    }
    expect(FactoryBuildingSchema.safeParse({ ...base, clockSpeedPercent: "160" }).success).toBe(false);
    expect(FactoryBuildingSchema.safeParse({ ...base, clockSpeedPercent: null }).success).toBe(false);
  });

  it("the captured-machine fixtures carry the speeds the 2026-09-22 capture shows (100 and one 160)", () => {
    const speeds = fixtures.factoryMixed.data.buildings.map((b) => ("clockSpeedPercent" in b ? b.clockSpeedPercent : undefined));
    expect(speeds).toContain(100);
    expect(speeds).toContain(160);
    expect(FactoryResponseSchema.safeParse(fixtures.factoryMixed).success).toBe(true);
  });

  it("rejects a non-string state and non-integer or negative counts", () => {
    expect(FactoryBuildingSchema.safeParse({ ...base, state: 3 }).success).toBe(false);
    expect(FactorySchema.safeParse({ buildings: [], backedUpCount: 0, stateCounts: { idle: 1.5 } }).success).toBe(false);
    expect(FactorySchema.safeParse({ buildings: [], backedUpCount: 0, stateCounts: { idle: -1 } }).success).toBe(false);
  });
});
