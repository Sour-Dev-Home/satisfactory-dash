import { describe, it, expect, vi } from "vitest";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { factoryBuildingFixture } from "@satisfactory-dash/game-adapter/fixtures";
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

async function mapFuse(powerInfo: Record<string, unknown>) {
  const raw = { ...factoryBuildingFixture, PowerInfo: { CircuitID: 1, PowerConsumed: 0, MaxPowerConsumed: 0, ...powerInfo } };
  const adapter = new SatisfactoryServerAdapter(
    { call: vi.fn() },
    { get: vi.fn().mockResolvedValue([raw]) as never },
  );
  return (await adapter.getFactoryBuildings())[0];
}

describe("adapter fuseTriggered mapping on getFactoryBuildings", () => {
  it("passes true through", async () => {
    expect((await mapFuse({ CircuitGroupID: 0, FuseTriggered: true })).fuseTriggered).toBe(true);
  });
  it("passes false through", async () => {
    expect((await mapFuse({ CircuitGroupID: 0, FuseTriggered: false })).fuseTriggered).toBe(false);
  });
  it("leaves it absent (unknown, not false) when FRM sends none", async () => {
    const b = await mapFuse({ CircuitGroupID: 0 });
    expect("fuseTriggered" in b).toBe(false);
  });
});

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
