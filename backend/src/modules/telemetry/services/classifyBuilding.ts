import type { FactoryBuilding } from "../../gameserver/index.js";

/**
 * The state constants, in one place (ADR-0027 decision 2). PROVISIONAL: the evidence is two trimmed
 * getFactory snapshots (10 buildings, docs-vault/raw-sources/captured-responses), so revisit with a
 * capture session (backend/scripts/captureFactory.ts) before the alert engine relies on them.
 */

/** FRM's averaged output percent below which a powered, configured, not-backed-up machine counts as
 *  UNDERFED rather than producing (ADR-0027 amendment 2, the owner's rule: below 95 percent of what the
 *  machine is set for, it gets fewer resources than it needs). The percent is relative to the SET clock:
 *  FRM's MaxProd already includes the clock speed (frm-api.md, Production), so a fully fed underclocked or
 *  overclocked machine reads about 100. Evidence so far: the running machines in the 2026-09-22 snapshot
 *  read 100, 100, 24.7 and 9.4 percent (the last two are input-limited, i.e. underfed by this rule). No
 *  capture yet of a fully fed underclocked machine or a Somersloop machine (whether MaxProd includes the
 *  Somersloop's amplification is [NEEDS VERIFICATION]). PROVISIONAL until the capture session replay (2b-2). */
export const UNDERFED_BELOW_PERCENT = 95;

export type MachineState = "producing" | "idle" | "backedUp" | "underfed" | "paused" | "unpowered";

export interface Classification {
  state: MachineState;
  /** For "underfed": the ingredient FRM reports consuming the least (lowest ConsPercent), by item
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
 * snapshot decides producing vs underfed. Holding a state for N minutes, or hysteresis, belongs to
 * the alert engine only. NEVER decided from `isProducing` alone (it is noisy).
 *
 * Order matters: paused, unpowered (not connected, or the circuit's fuse tripped), idle (no
 * recipe), backedUp, underfed, producing. Returns undefined, never a guess, when the data needed to
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
  if (outputPercent < UNDERFED_BELOW_PERCENT) {
    const missingInput = lowestIngredient(building);
    return { state: "underfed", ...(missingInput !== undefined ? { missingInput } : {}) };
  }
  return { state: "producing" };
}

/** The highest averaged percent across the outputs: a machine with any output moving is not underfed.
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
