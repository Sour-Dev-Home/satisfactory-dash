import type { FactoryBuilding } from "@satisfactory-dash/shared";

/** A building's state on the map (ADR-0023 layer a). Backed up is a ring on top, not a state. */
export type BuildingState = "producing" | "idle" | "paused" | "noRecipe";

export const STATE_LABEL: Record<BuildingState, string> = {
  producing: "Producing",
  idle: "Not producing",
  paused: "Paused",
  noRecipe: "No recipe",
};

/** Design tokens (src/index.css) per state: canvas markers read the token's value at draw time. */
export const STATE_TOKEN: Record<BuildingState, string> = {
  producing: "--color-ok",
  idle: "--color-muted",
  paused: "--color-info",
  noRecipe: "--color-idle-solid",
};
export const BACKED_UP_TOKEN = "--color-warn";

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
