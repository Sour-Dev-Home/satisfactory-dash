import type { Factory } from "@satisfactory-dash/shared";
import type { FactoryBuilding } from "../../gameserver/index.js";
import { isBackedUp, mapFactoryBuilding } from "../../gameserver/index.js";
import { createUnitResolver } from "../itemForms.js";
import type { ProductionUnit } from "../itemForms.js";
import { deriveFactory } from "./snapshotDerive.js";

export type UnitResolver = (className: string) => ProductionUnit | null;

export interface ProductionAdapterLike {
  getFactoryBuildings(): Promise<FactoryBuilding[]>;
}

/**
 * A building is treated as backed up (an output slot at capacity, the closest available overflow signal, see
 * docs-vault/wiki/frm-api.md). ADR-0031: this raw fact needs the output inventory, so it is computed where the inventory
 * is (the game-adapter package's shape mapping, shared with the edge agent); re-exported here for the services and tests
 * that read it from the production service.
 */
export { isBackedUp };

export class ProductionService {
  /** `resolveUnit` maps an item className to the contract's `unit` (ADR-0015). The
   *  composition root passes one shared resolver so an unknown item is logged once per
   *  process; the default resolves silently. */
  constructor(
    private readonly adapter: ProductionAdapterLike,
    private readonly resolveUnit: UnitResolver = createUnitResolver(() => {}),
  ) {}

  /**
   * The shared shape mapping (`mapFactoryBuilding`, including `isBackedUp`), then the backend's classification step
   * (`deriveFactory`: each machine's `state`, the units, `backedUpCount`, `stateCounts`), the same two steps an edge agent's
   * readings go through at ingest (ADR-0031). For a polled server each machine's fuse is the one FRM sent on it (ADR-0027);
   * absent means unknown, never assumed intact.
   */
  async getFactoryOverview(): Promise<Factory> {
    const buildings = await this.adapter.getFactoryBuildings();
    // Keyed by the mapped object, not by id: building ids need not be unique, and each machine keeps the fuse it was sent with.
    const mapped = buildings.map(mapFactoryBuilding);
    const fuseOf = new Map(mapped.map((building, index) => [building, buildings[index]!.fuseTriggered] as const));
    return deriveFactory({ buildings: mapped }, (building) => fuseOf.get(building), this.resolveUnit);
  }
}
