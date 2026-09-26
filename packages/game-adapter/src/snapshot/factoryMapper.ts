import type { AgentFactory } from "@satisfactory-dash/shared";
import type { FactoryBuilding } from "../domain.js";

/** A building as the contract has it, without the derived `state` and without `unit` on its rates: both are RULES or
 *  catalog lookups the backend applies (ADR-0031), so a change to them never needs an agent update. */
export type MappedFactoryBuilding = AgentFactory["buildings"][number];

/**
 * A building is treated as backed up, the closest available overflow signal (docs-vault/wiki/frm-api.md), when at
 * least one output slot is sitting at capacity, i.e. downstream (the belt/pipe/container it feeds) can't keep up.
 * Deterministic threshold check, not an LLM call (ground rule 3).
 *
 * Deliberately NOT gated on isProducing (B1, 2026-09-22 captures): a machine whose output is full stops producing, so
 * all 71 backed-up machines on a real save read IsProducing false and the old rule matched none of them. Paused and
 * unconfigured machines are excluded instead, since a full slot there doesn't mean a blocked belt. maxAmount > 0
 * guards a zero-capacity slot; FRM omits empty slots, so one would never mean "full".
 *
 * ADR-0031: this is a raw FACT that needs `outputInventory`, which the contract does not carry, so it is computed where
 * the inventory is: here, shared by the backend's local path and the edge agent.
 */
export function isBackedUp(building: FactoryBuilding): boolean {
  if (building.isPaused || building.recipe === null) {
    return false;
  }
  return building.outputInventory.some((slot) => slot.maxAmount > 0 && slot.amount >= slot.maxAmount);
}

/**
 * The pure shape mapping of one building to the contract (packages/shared/src/factory.ts), including `isBackedUp`,
 * without `state` and without `unit` on the rates. Explicit field mapping, so a future domain field can never leak in.
 */
export function mapFactoryBuilding(building: FactoryBuilding): MappedFactoryBuilding {
  return {
    id: building.id,
    name: building.name,
    className: building.className,
    recipe: building.recipe,
    isProducing: building.isProducing,
    isPaused: building.isPaused,
    isBackedUp: isBackedUp(building),
    circuitGroupId: building.circuitGroupId,
    ...(building.location ? { location: building.location } : {}),
    ...(building.clockSpeedPercent !== undefined ? { clockSpeedPercent: building.clockSpeedPercent } : {}),
    production: building.production.map((rate) => ({ ...rate })),
    // ADR-0027: what it consumes, in the same shape.
    ingredients: building.consumption.map((rate) => ({ ...rate })),
  };
}
