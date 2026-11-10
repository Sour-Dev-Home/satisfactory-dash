import { describe, it, expect } from "vitest";
import { classifyBuilding } from "./classifyBuilding.js";
import type { ClassifiableBuilding } from "./classifyBuilding.js";

const rate = (className: string, percent: number) => ({
  name: className,
  className,
  currentPerMinute: 0,
  maxPerMinute: 0,
  percent,
});
const base = (o: Partial<ClassifiableBuilding> = {}): ClassifiableBuilding => ({
  recipe: "R",
  isPaused: false,
  production: [rate("A", 100)],
  consumption: [],
  circuitGroupId: 0,
  fuseTriggered: false,
  ...o,
});

// The adapter's fuseTriggered mapping cases moved to gameserver/frmFactoryMapping.test.ts (ADR-0066 PR 3) and went
// with the adapter in build PR 7.
describe("classifyBuilding edge cases", () => {
  it("does not treat Infinity as a usable percent", () => {
    expect(classifyBuilding(base({ production: [rate("A", Infinity)] }), false)).toBeUndefined();
  });
  it("a negative percent is below the threshold (underfed), not an error", () => {
    expect(classifyBuilding(base({ production: [rate("A", -1)] }), false)?.state).toBe("underfed");
  });
  it("circuitGroupId 0 is connected", () => {
    expect(classifyBuilding(base({ circuitGroupId: 0 }), false)?.state).toBe("producing");
  });
  it("unconfigured and unknown fuse on a connected circuit is still idle", () => {
    const { fuseTriggered: _f, ...rest } = base({ recipe: null, production: [] });
    expect(classifyBuilding(rest, false)?.state).toBe("idle");
  });
  it("recipe null with production entries is idle even when a slot is full", () => {
    expect(classifyBuilding(base({ recipe: null }), true)?.state).toBe("idle");
  });
});
