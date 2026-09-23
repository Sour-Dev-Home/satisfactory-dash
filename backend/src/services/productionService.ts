import type { FactoryBuildingResponse, FactoryOverviewResponse } from "@satisfactory-dash/shared";
import type { FactoryBuilding } from "../adapters/domain.js";

export interface ProductionAdapterLike {
  getFactoryBuildings(): Promise<FactoryBuilding[]>;
}

/**
 * A building is treated as backed up — the closest available overflow signal, see
 * docs-vault/wiki/frm-api.md — when at least one output slot is sitting at capacity,
 * i.e. downstream (the belt/pipe/container it feeds) can't keep up. Deterministic
 * threshold check, not an LLM call (ground rule 3).
 *
 * Deliberately NOT gated on isProducing (B1, 2026-09-22 captures): a machine whose
 * output is full stops producing, so all 71 backed-up machines on a real save read
 * IsProducing false and the old rule matched none of them. Paused and unconfigured
 * machines are excluded instead, since a full slot there doesn't mean a blocked belt.
 * maxAmount > 0 guards a zero-capacity slot; FRM omits empty slots, so one would
 * never mean "full".
 */
export function isBackedUp(building: FactoryBuilding): boolean {
  if (building.isPaused || building.recipe === null) {
    return false;
  }
  return building.outputInventory.some((slot) => slot.maxAmount > 0 && slot.amount >= slot.maxAmount);
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
