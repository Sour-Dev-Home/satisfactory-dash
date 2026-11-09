import type { Factory, Power } from "@satisfactory-dash/shared";
import { mapFactoryBuilding, mapPowerCircuit } from "../src/modules/gameserver/index.js";
import type { FactoryBuilding, PowerCircuit } from "../src/modules/telemetry/domain.js";
import { createUnitResolver } from "../src/modules/telemetry/itemForms.js";
import type { UnitResolver } from "../src/modules/telemetry/itemForms.js";
import { deriveFactory, derivePower } from "../src/modules/telemetry/services/snapshotDerive.js";

/**
 * ADR-0066 build PR 5: the polled `ProductionService` and `PowerService` are gone, but their tests checked the backend's
 * derivation (each machine's state, units, counts, location, clock speed) over domain-shaped buildings. These are the two
 * steps those services ran, kept for the tests only: the shape mapping, then `deriveFactory` / `derivePower`, the same
 * classification a mod's snapshot goes through at ingest. Build PR 7 removes the mapping with the gameserver module.
 */
export function factoryOverviewOf(buildings: FactoryBuilding[], resolveUnit: UnitResolver = createUnitResolver(() => {})): Factory {
  // Keyed by the mapped object, not by id: building ids need not be unique, and each machine keeps the fuse it was sent with.
  const mapped = buildings.map(mapFactoryBuilding);
  const fuseOf = new Map(mapped.map((building, index) => [building, buildings[index]!.fuseTriggered] as const));
  return deriveFactory({ buildings: mapped }, (building) => fuseOf.get(building), resolveUnit);
}

export function powerOverviewOf(circuits: PowerCircuit[]): Power {
  return derivePower({ circuits: circuits.map(mapPowerCircuit) });
}

/** `factoryOverviewOf` behind the old service's shape (an adapter that lists buildings), so the tests read as before. */
export class FactoryOverviewHarness {
  constructor(
    private readonly source: { getFactoryBuildings(): Promise<FactoryBuilding[]> },
    private readonly resolveUnit: UnitResolver = createUnitResolver(() => {}),
  ) {}

  async getFactoryOverview(): Promise<Factory> {
    return factoryOverviewOf(await this.source.getFactoryBuildings(), this.resolveUnit);
  }
}
