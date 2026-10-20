import { ownValue, type FactoryBuilding } from "@satisfactory-dash/shared";

/** A building's state on the map (ADR-0023 layer a). Backed up is a ring on top, not a state. */
export type BuildingState = "producing" | "idle" | "paused" | "noRecipe";

export const STATE_LABEL: Record<BuildingState, string> = {
  producing: "Producing",
  idle: "Not producing",
  paused: "Paused",
  noRecipe: "No recipe",
};

/**
 * Design tokens (src/index.css) per state, ADR-0041's colours: canvas icons read the token's value at
 * draw time. Blue (info) is for paused only. No recipe shares muted with not producing but is
 * drawn hollow (an outline, no fill: the owner's call), so the two differ by shape; muted is
 * 7.42:1 on the canvas and 5.61:1 on a surface-2 grid line (WCAG 1.4.11 asks 3:1).
 */
export const STATE_TOKEN: Record<BuildingState, string> = {
  producing: "--color-ok",
  idle: "--color-muted",
  paused: "--color-info",
  noRecipe: "--color-muted",
};
/** The states drawn as an outline only. */
export const isHollow = (state: BuildingState) => state === "noRecipe";
export const BACKED_UP_TOKEN = "--color-warn";
/** The mark on a machine (its window, or the warning triangle): the canvas showing through. */
export const MARK_TOKEN = "--color-canvas";
/** How long one backed-up pulse takes; 0s under reduced motion. */
export const PULSE_TOKEN = "--duration-pulse";

/** A state's label and token, reading own keys only (#368). */
export const stateLabel = (state: BuildingState) => ownValue(STATE_LABEL, state) ?? state;
export const stateToken = (state: BuildingState) => ownValue(STATE_TOKEN, state) ?? STATE_TOKEN.idle;

/** Average output percent; the per-output figures are already averaged by the game. */
export function outputPercent(building: FactoryBuilding): number | null {
  if (building.production.length === 0) return null;
  return building.production.reduce((sum, p) => sum + p.percent, 0) / building.production.length;
}

/** Paused wins (the player chose it), then no recipe, then whether it's producing at all. */
export function buildingState(building: FactoryBuilding): BuildingState {
  if (building.isPaused) return "paused";
  if (building.recipe === null) return "noRecipe";
  return (outputPercent(building) ?? 0) > 0 ? "producing" : "idle";
}
