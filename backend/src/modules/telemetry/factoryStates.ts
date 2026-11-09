import type { FactoryBuilding } from "./domain.js";
import type { ItemSampleRow, TransitionRow } from "./repositories/historyRepository.js";

/**
 * ADR-0066 Decision 5: the pure factory-state helpers the agent path and the polled path share. `isBackedUp` and
 * `areInputsFull` came from the game-adapter package (through gameserver's facade), `sumItemRates` and
 * `diffDecidedStates` from the polled `services/factoryHistoryPoller.ts`; they live here so the agent path imports
 * neither. The adapter keeps its own copy of the first two for its shape mapping until it goes;
 * `services/inputsFull.parity.test.ts` holds the two copies to the same answers.
 */

/** A poll that turns up more transitions than this drops the rest: a mass change (a reload, a tripped grid) is noise. */
export const MAX_TRANSITIONS_PER_POLL = 500;
/** When more than this share of the buildings are new, the world changed (a load, a different save): re-baseline. */
const NEW_IDS_BASELINE_SHARE = 0.5;

/**
 * A building is treated as backed up, the closest available overflow signal (docs-vault/wiki/frm-api.md), when at
 * least one output slot is sitting at capacity, i.e. downstream (the belt/pipe/container it feeds) can't keep up.
 * Deterministic threshold check, not an LLM call (ground rule 3).
 *
 * Deliberately NOT gated on isProducing (B1, 2026-09-22 captures): a machine whose output is full stops producing, so
 * all 71 backed-up machines on a real save read IsProducing false and the old rule matched none of them. Paused and
 * unconfigured machines are excluded instead, since a full slot there doesn't mean a blocked belt. maxAmount > 0
 * guards a zero-capacity slot; FRM omits empty slots, so one would never mean "full".
 */
export function isBackedUp(building: FactoryBuilding): boolean {
  if (building.isPaused || building.recipe === null) {
    return false;
  }
  return building.outputInventory.some((slot) => slot.maxAmount > 0 && slot.amount >= slot.maxAmount);
}

/**
 * Every ingredient the recipe consumes has its input slot at capacity (issue 201: such a machine is held back by its
 * output, so a low output percent means backed up, not underfed). FRM omits empty slots, so an ingredient with no slot
 * is not full. False when the inventory or the ingredient list is unknown or empty, and for paused/unconfigured
 * machines: never a guess.
 */
export function areInputsFull(building: FactoryBuilding): boolean {
  if (building.isPaused || building.recipe === null || building.inputInventory === undefined) {
    return false;
  }
  const slots = building.inputInventory;
  if (building.consumption.length === 0) {
    return false;
  }
  return building.consumption.every((rate) =>
    slots.some((slot) => slot.className === rate.className && slot.maxAmount > 0 && slot.amount >= slot.maxAmount),
  );
}

/** Total production per item across every building: the factory's output as one sample per item. */
export function sumItemRates(
  buildings: { production: { className: string; currentPerMinute: number; maxPerMinute: number }[] }[],
  atMs: number,
): ItemSampleRow[] {
  const totals = new Map<string, { current: number; max: number }>();
  for (const building of buildings) {
    for (const rate of building.production) {
      const total = totals.get(rate.className) ?? { current: 0, max: 0 };
      total.current += rate.currentPerMinute;
      total.max += rate.maxPerMinute;
      totals.set(rate.className, total);
    }
  }
  return [...totals].map(([item, total]) => ({ item, atMs, currentPerMinute: total.current, maxPerMinute: total.max }));
}

/**
 * Compares this snapshot's decided machine states with the last and returns the transitions, updating `known` in
 * place: the pollers classify the adapter's buildings, an agent's snapshot carries each building's state (ADR-0031
 * PR 5a). `current` holds only buildings whose state is decided; `present` is every building in the snapshot. A
 * building whose state cannot be decided keeps its last state (no transition, no guess). The first snapshot, and one
 * where most buildings are new, only set the baseline.
 */
export function diffDecidedStates(
  known: Map<string, string>,
  current: Map<string, { state: string; className: string }>,
  present: Set<string>,
  atMs: number,
  cap = MAX_TRANSITIONS_PER_POLL,
): TransitionRow[] {
  let newIds = 0;
  for (const id of current.keys()) {
    if (!known.has(id)) newIds++;
  }
  const rebaseline = known.size === 0 || (current.size > 0 && newIds / current.size > NEW_IDS_BASELINE_SHARE);
  const transitions: TransitionRow[] = [];
  if (!rebaseline) {
    for (const [id, { state, className }] of current) {
      const previous = known.get(id);
      if (previous !== state && transitions.length < cap) {
        transitions.push({ atMs, buildingId: id, className, fromState: previous ?? null, toState: state });
      }
    }
  }
  // Forget buildings that are gone, but keep the last state of ones that are present with an undecidable state.
  for (const id of known.keys()) {
    if (!present.has(id)) known.delete(id);
  }
  if (rebaseline) known.clear();
  for (const [id, { state }] of current) {
    known.set(id, state);
  }
  return transitions;
}
