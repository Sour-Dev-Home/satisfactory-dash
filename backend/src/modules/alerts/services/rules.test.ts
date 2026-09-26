import { describe, expect, it } from "vitest";
import { DEFAULTS_BY_KIND, PRESET_RULES, RULE_KINDS, parseRuleParams } from "./rules.js";

describe("production_below_target params (ADR-0027 amendment 3)", () => {
  const valid = { item: "Desc_IronPlate_C", targetPerMinute: 120 };

  it("defaults the window to 10 minutes", () => {
    expect(parseRuleParams("production_below_target", valid)).toEqual({
      kind: "production_below_target",
      params: { item: "Desc_IronPlate_C", targetPerMinute: 120, windowMinutes: 10 },
    });
  });

  it("accepts a window of 5 to 60 minutes and nothing outside it", () => {
    for (const windowMinutes of [5, 10, 60]) expect(parseRuleParams("production_below_target", { ...valid, windowMinutes })).toBeDefined();
    for (const windowMinutes of [4.9, 0, -5, 61, Number.NaN, "10"]) {
      expect(parseRuleParams("production_below_target", { ...valid, windowMinutes }), String(windowMinutes)).toBeUndefined();
    }
  });

  it("needs an item and a target above zero, and both are required", () => {
    for (const targetPerMinute of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "100", null]) {
      expect(parseRuleParams("production_below_target", { ...valid, targetPerMinute }), String(targetPerMinute)).toBeUndefined();
    }
    for (const item of ["", 5, null, "x".repeat(201)]) {
      expect(parseRuleParams("production_below_target", { ...valid, item }), String(item)).toBeUndefined();
    }
    expect(parseRuleParams("production_below_target", { targetPerMinute: 120 })).toBeUndefined();
    expect(parseRuleParams("production_below_target", { item: "Desc_IronPlate_C" })).toBeUndefined();
    expect(parseRuleParams("production_below_target", undefined)).toBeUndefined();
    expect(parseRuleParams("production_below_target", {})).toBeUndefined();
  });

  it("refuses unknown params (strict), so a typo never silently becomes a default", () => {
    expect(parseRuleParams("production_below_target", { ...valid, windowMinute: 10 })).toBeUndefined();
  });

  it("is a rule kind with its documented timing and NO preset", () => {
    expect(RULE_KINDS).toContain("production_below_target");
    expect(PRESET_RULES.map((preset) => preset.kind)).not.toContain("production_below_target");
    expect(DEFAULTS_BY_KIND.production_below_target).toMatchObject({ forSeconds: 600, clearSeconds: 300, repeatSeconds: 3600 });
  });

  it("every kind can be parsed, and an unknown kind cannot", () => {
    expect(parseRuleParams("unknown_kind", {})).toBeUndefined();
    for (const kind of RULE_KINDS) expect(DEFAULTS_BY_KIND[kind]?.kind).toBe(kind);
  });
});
