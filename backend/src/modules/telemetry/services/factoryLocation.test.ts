import { describe, it, expect } from "vitest";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { ProductionService } from "./productionService.js";
import {
  capturedBackedUpAssembler,
  capturedFuelRefinery,
  capturedUnassignedAssembler,
} from "@satisfactory-dash/game-adapter/fixtures";

// ADR-0023: FRM's building location (centimetres, docs-vault/raw-sources/world-coordinates.md) becomes
// metres, the yaw is normalized to [0, 360), and the circuit group id reaches the contract.
// The `location` values below are copied unchanged from the 2026-09-22 capture
// (docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json).

const at = (x: number, y: number, z: number, rotation?: number) => ({ x, y, z, rotation, pitch: 0 });

function adapterFor(...raw: unknown[]) {
  return new SatisfactoryServerAdapter({ call: async () => undefined as never }, { get: async () => raw as never });
}

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

describe("factory overview carries location and circuitGroupId", () => {
  it("passes both to the response, with -1 for an unconnected building", async () => {
    const connected = { ...capturedBackedUpAssembler, location: at(-43600, -143900, 11800.0087890625, 180) };
    const unconnected = {
      ...capturedFuelRefinery,
      location: at(-14200, -112800, 11200.01171875, 0),
      PowerInfo: { ...capturedFuelRefinery.PowerInfo, CircuitGroupID: -1, CircuitID: -1 },
    };
    const adapter = adapterFor(connected, unconnected);
    const { buildings } = await new ProductionService(adapter).getFactoryOverview();
    expect(buildings[0]).toMatchObject({
      circuitGroupId: 0,
      location: { xM: -436, yM: -1439, zM: 118.000087890625, rotationDeg: 180 },
    });
    expect(buildings[1]).toMatchObject({
      circuitGroupId: -1,
      location: { xM: -142, yM: -1128, zM: 112.0001171875, rotationDeg: 0 },
    });
  });

  it("leaves location out of the response when the building has none", async () => {
    const { buildings } = await new ProductionService(adapterFor(capturedBackedUpAssembler)).getFactoryOverview();
    expect(buildings[0]).not.toHaveProperty("location");
    expect(buildings[0]?.circuitGroupId).toBe(0);
  });
});
