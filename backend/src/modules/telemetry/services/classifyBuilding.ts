import type { FactoryBuilding } from "../../gameserver/index.js";

/**
 * The state constants, in one place (ADR-0027 decision 2). PROVISIONAL: the evidence is two trimmed
 * getFactory snapshots (10 buildings, docs-vault/raw-sources/captured-responses), so revisit with a
 * capture session (backend/scripts/captureFactory.ts) before the alert engine relies on them.
 */

/** FRM's averaged output percent below which a powered, configured, not-backed-up machine counts as
 *  STARVED rather than producing. Evidence: the running machines in the 2026-09-22 snapshot read
 *  100, 100, 24.7 and 9.4 percent; every 0 percent reading there is backed up or unpowered; no
 *  captured machine was truly starved. 5 sits under the lowest running machine (9.4) so a slow but
 *  working machine is not flagged. PROVISIONAL. */
export const STARVED_BELOW_PERCENT = 5;

export type MachineState = "producing" | "idle" | "backedUp" | "starved" | "paused" | "unpowered";

export interface Classification {
  state: MachineState;
  /** For "starved": the ingredient FRM reports consuming the least (lowest ConsPercent), by item
   *  class name. Absent when no ingredient data exists. */
  missingInput?: string;
}

/** What the classifier reads. `isBackedUp` is the existing overflow signal (productionService),
 *  passed in so there is one definition of it. */
export type ClassifiableBuilding = Pick<
  FactoryBuilding,
  "recipe" | "isPaused" | "production" | "consumption" | "circuitGroupId" | "fuseTriggered"
>;

/**
 * ADR-0027 decision 2, per snapshot and pure: nothing here is time-based. FRM's own `percent` is
 * already an average while `isProducing` is instantaneous (contract factory.ts), so a single
 * snapshot decides producing vs starved. Holding a state for N minutes, or hysteresis, belongs to
 * the alert engine only. NEVER decided from `isProducing` alone (it is noisy).
 *
 * Order matters: paused, unpowered (not connected, or the circuit's fuse tripped), idle (no
 * recipe), backedUp, starved, producing. Returns undefined, never a guess, when the data needed to
 * decide is missing (no fuse information, or no usable output percent).
 */
export function classifyBuilding(building: ClassifiableBuilding, backedUp: boolean): Classification | undefined {
  if (building.isPaused) {
    return { state: "paused" };
  }
  // -1 = not connected to any circuit (FRM); a tripped fuse means the whole circuit is dead.
  if (building.circuitGroupId < 0 || building.fuseTriggered === true) {
    return { state: "unpowered" };
  }
  if (building.recipe === null) {
    return { state: "idle" };
  }
  // From here on the machine must be known to be powered: connected, and the fuse state known.
  if (building.fuseTriggered === undefined) {
    return undefined;
  }
  if (backedUp) {
    return { state: "backedUp" };
  }
  const outputPercent = bestOutputPercent(building);
  if (outputPercent === undefined) {
    return undefined;
  }
  if (outputPercent < STARVED_BELOW_PERCENT) {
    const missingInput = lowestIngredient(building);
    return { state: "starved", ...(missingInput !== undefined ? { missingInput } : {}) };
  }
  return { state: "producing" };
}

/** The highest averaged percent across the outputs: a machine with any output moving is not starved.
 *  undefined when there is no finite percent to judge by. */
function bestOutputPercent(building: ClassifiableBuilding): number | undefined {
  const percents = building.production.map((rate) => rate.percent).filter(Number.isFinite);
  return percents.length === 0 ? undefined : Math.max(...percents);
}

function lowestIngredient(building: ClassifiableBuilding): string | undefined {
  const usable = building.consumption.filter((rate) => Number.isFinite(rate.percent));
  if (usable.length === 0) {
    return undefined;
  }
  return usable.reduce((lowest, rate) => (rate.percent < lowest.percent ? rate : lowest)).className;
}
