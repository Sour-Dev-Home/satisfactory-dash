import { describe, it, expect } from "vitest";
import { capturedBackedUpAssembler, capturedFuelRefinery } from "../../../../test-support/capturedFactory.js";
import type { FactoryBuilding } from "../domain.js";
// ADR-0066: the polled ProductionService is gone; the harness runs the same mapping and derivation over these buildings.
import { FactoryOverviewHarness as ProductionService } from "../../../../test-support/factoryOverview.js";

// ADR-0023: a building's location (metres, rotation in [0, 360)) and its circuit group id reach the contract. The
// adapter's centimetre-to-metre and rotation cases moved to gameserver/frmFactoryMapping.test.ts (ADR-0066 PR 3). The
// locations below are what the adapter maps the 2026-09-22 capture's values to
// (docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json).

function adapterFor(...buildings: FactoryBuilding[]) {
  return { getFactoryBuildings: async () => buildings };
}

describe("factory overview carries location and circuitGroupId", () => {
  it("passes both to the response, with -1 for an unconnected building", async () => {
    const connected: FactoryBuilding = {
      ...capturedBackedUpAssembler,
      location: { xM: -436, yM: -1439, zM: 118.000087890625, rotationDeg: 180 },
    };
    const unconnected: FactoryBuilding = {
      ...capturedFuelRefinery,
      circuitGroupId: -1,
      location: { xM: -142, yM: -1128, zM: 112.0001171875, rotationDeg: 0 },
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
