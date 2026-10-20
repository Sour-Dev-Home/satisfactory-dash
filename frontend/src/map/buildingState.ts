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
 * draw time. Blue (info) is for paused only.
 */
export const STATE_TOKEN: Record<BuildingState, string> = {
  producing: "--color-ok",
  idle: "--color-muted",
  paused: "--color-info",
  noRecipe: "--color-line",
};
export const BACKED_UP_TOKEN = "--color-warn";
/**
 * The no-recipe fill (the line colour) is 1.55:1 on the canvas, too dim to read alone (WCAG
 * 1.4.11 asks 3:1), so that icon gets a 1 px outline in muted: 7.42:1 on the canvas, 5.61:1 on a
 * surface-2 grid line.
 */
export const NO_RECIPE_OUTLINE_TOKEN = "--color-muted";
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
