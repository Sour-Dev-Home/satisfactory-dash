import type { FactoryBuildingResponse, FactoryOverviewResponse } from "@satisfactory-dash/shared";
import type { FactoryBuilding } from "../adapters/domain.js";

export interface ProductionAdapterLike {
  getFactoryBuildings(): Promise<FactoryBuilding[]>;
}

/**
 * A building is treated as backed up — the closest available overflow signal, see
 * docs-vault/wiki/frm-api.md — when it's actively producing but at least one output
 * slot is already sitting at capacity, i.e. downstream (the belt/pipe/container it
 * feeds) can't keep up. Deterministic threshold check, not an LLM call (ground rule 3).
 */
export function isBackedUp(building: FactoryBuilding): boolean {
  return building.isProducing && building.outputInventory.some((slot) => slot.amount >= slot.maxAmount);
}

export class ProductionService {
  constructor(private readonly adapter: ProductionAdapterLike) {}

  async getFactoryOverview(): Promise<FactoryOverviewResponse> {
    const buildings = await this.adapter.getFactoryBuildings();
    const mapped: FactoryBuildingResponse[] = buildings.map((building) => ({
      id: building.id,
      name: building.name,
      className: building.className,
      recipe: building.recipe,
      isProducing: building.isProducing,
      isPaused: building.isPaused,
      isBackedUp: isBackedUp(building),
      production: building.production,
    }));
    return {
      buildings: mapped,
      backedUpCount: mapped.filter((building) => building.isBackedUp).length,
    };
  }
}
