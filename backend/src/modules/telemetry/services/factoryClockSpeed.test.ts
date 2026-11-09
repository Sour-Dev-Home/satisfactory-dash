import { describe, it, expect } from "vitest";
import { capturedBackedUpAssembler, capturedFuelRefinery } from "../../../../test-support/capturedFactory.js";
import type { FactoryBuilding } from "../domain.js";
import { ProductionService } from "./productionService.js";

// ADR-0027 amendment 2: the optional `clockSpeedPercent` (FRM's ManuSpeed on the polled path) reaches the factory
// overview. The adapter's ManuSpeed mapping cases moved to gameserver/frmFactoryMapping.test.ts (ADR-0066 PR 3); the
// inputs here are domain-shaped: the 160 below is what the adapter maps ManuSpeed 160 to.

function adapterFor(...buildings: FactoryBuilding[]) {
  return { getFactoryBuildings: async () => buildings };
}

describe("the factory overview carries clockSpeedPercent", () => {
  it("passes it to the response when known and leaves it out when not", async () => {
    const service = new ProductionService(
      adapterFor({ ...capturedBackedUpAssembler, clockSpeedPercent: 160 }, capturedFuelRefinery),
      () => null,
    );
    const { buildings } = await service.getFactoryOverview();
    expect(buildings[0]?.clockSpeedPercent).toBe(160);
    expect(buildings[1]).not.toHaveProperty("clockSpeedPercent");
  });
});
