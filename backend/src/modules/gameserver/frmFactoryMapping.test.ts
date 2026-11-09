import { describe, it, expect, vi } from "vitest";
import {
  capturedBackedUpAssembler,
  capturedFuelRefinery,
  capturedUnassignedAssembler,
  factoryBuildingFixture,
} from "@satisfactory-dash/game-adapter/fixtures";
import { SatisfactoryServerAdapter } from "./index.js";

// ADR-0066 PR 3: the adapter's FRM getFactory -> domain mapping cases that used to sit in telemetry's
// classifyEdges, factoryClockSpeed and factoryLocation tests, moved unchanged. They test the adapter (the polled
// path) itself, so they keep their FRM fixtures and go with the adapter; the telemetry tests now read domain-shaped
// fixtures (backend/test-support/capturedFactory.ts).

function adapterFor(...raw: unknown[]) {
  return new SatisfactoryServerAdapter({ call: async () => undefined as never }, { get: async () => raw as never });
}

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

// ADR-0027 amendment 2: FRM's ManuSpeed (configured speed in percent, frm-getFactory.md E6; the committed
// 2026-09-22 running capture has six machines at 100 and one at 160) becomes the optional `clockSpeedPercent`.
describe("clock speed mapping (FRM ManuSpeed)", () => {
  it("maps ManuSpeed to clockSpeedPercent, unchanged (100 = default clock, above 100 = overclocked)", async () => {
    const [normal, half, over] = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: 100 },
      { ...capturedBackedUpAssembler, ManuSpeed: 50 },
      { ...capturedBackedUpAssembler, ManuSpeed: 160 },
    ).getFactoryBuildings();
    expect(normal?.clockSpeedPercent).toBe(100);
    expect(half?.clockSpeedPercent).toBe(50);
    expect(over?.clockSpeedPercent).toBe(160);
  });

  it("keeps a fractional speed as sent", async () => {
    const [building] = await adapterFor({ ...capturedBackedUpAssembler, ManuSpeed: 133.333 }).getFactoryBuildings();
    expect(building?.clockSpeedPercent).toBe(133.333);
  });

  it("omits it when FRM sends none (an older FRM, or a building type without a speed)", async () => {
    const withoutSpeed: Record<string, unknown> = { ...capturedFuelRefinery };
    delete withoutSpeed.ManuSpeed;
    const [building] = await adapterFor(withoutSpeed).getFactoryBuildings();
    expect(building).not.toHaveProperty("clockSpeedPercent");
  });

  it("omits a clock of 0 or less (not a meaningful setting; the architect's call), but keeps any positive one, mods included", async () => {
    const [zero, negative, tiny, huge] = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: 0 },
      { ...capturedBackedUpAssembler, ManuSpeed: -5 },
      { ...capturedBackedUpAssembler, ManuSpeed: 0.01 },
      { ...capturedBackedUpAssembler, ManuSpeed: 1000 },
    ).getFactoryBuildings();
    expect(zero).not.toHaveProperty("clockSpeedPercent");
    expect(negative).not.toHaveProperty("clockSpeedPercent");
    expect(tiny?.clockSpeedPercent).toBe(0.01);
    expect(huge?.clockSpeedPercent).toBe(1000); // no upper bound
  });

  it.each([
    ["null", null],
    ["a string", "160"],
    ["an object", { value: 160 }],
    ["NaN", Number.NaN],
    ["Infinity (JSON 1e999)", JSON.parse("1e999") as number],
    ["-Infinity", -Infinity],
  ])("omits it, and still maps the building, when ManuSpeed is %s", async (_name, value) => {
    const [building] = await adapterFor({ ...capturedBackedUpAssembler, ManuSpeed: value }).getFactoryBuildings();
    expect(building).not.toHaveProperty("clockSpeedPercent");
    expect(building?.id).toBe(capturedBackedUpAssembler.ID);
  });

  it("does not disturb the other buildings of the same response", async () => {
    const buildings = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: "bad" },
      { ...capturedFuelRefinery, ManuSpeed: 160 },
    ).getFactoryBuildings();
    expect(buildings).toHaveLength(2);
    expect(buildings[0]).not.toHaveProperty("clockSpeedPercent");
    expect(buildings[1]?.clockSpeedPercent).toBe(160);
  });
});

// ADR-0023: FRM's building location (centimetres, docs-vault/raw-sources/world-coordinates.md) becomes
// metres and the yaw is normalized to [0, 360). The `location` values below are copied unchanged from the 2026-09-22
// capture (docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json).
const at = (x: number, y: number, z: number, rotation?: number) => ({ x, y, z, rotation, pitch: 0 });

describe("building location (ADR-0023)", () => {
  it("converts the captured centimetres to metres", async () => {
    const [backedUp, refinery, unassigned] = await adapterFor(
      { ...capturedBackedUpAssembler, location: at(-43600, -143900, 11800.0087890625, 180) },
      { ...capturedFuelRefinery, location: at(-32800, -190900, 4800.00439453125, 180) },
      { ...capturedUnassignedAssembler, location: at(-195700, -105600, 8600, 90) },
    ).getFactoryBuildings();
    expect(backedUp?.location).toEqual({ xM: -436, yM: -1439, zM: 118.000087890625, rotationDeg: 180 });
    expect(refinery?.location).toEqual({ xM: -328, yM: -1909, zM: 48.0000439453125, rotationDeg: 180 });
    expect(unassigned?.location).toEqual({ xM: -1957, yM: -1056, zM: 86, rotationDeg: 90 });
  });

  it("normalizes rotation into [0, 360)", async () => {
    const rotations = [0, 90, 270, 360, 450, -90, -360, -0, 359.5, -1e-15, undefined];
    const buildings = await adapterFor(
      ...rotations.map((rotation) => ({ ...capturedBackedUpAssembler, location: at(0, 0, 0, rotation) })),
    ).getFactoryBuildings();
    expect(buildings.map((b) => b.location?.rotationDeg)).toEqual([0, 90, 270, 0, 90, 270, 0, 0, 359.5, 0, 0]);
    for (const b of buildings) {
      expect(Object.is(b.location?.rotationDeg, -0)).toBe(false);
    }
  });

  it("omits location when FRM sends none, and rejects a malformed one as an upstream error", async () => {
    const [none] = await adapterFor(capturedBackedUpAssembler).getFactoryBuildings();
    expect(none).not.toHaveProperty("location");
    await expect(
      adapterFor({ ...capturedBackedUpAssembler, location: { x: "1", y: 2, z: 3 } }).getFactoryBuildings(),
    ).rejects.toThrow();
  });
});
