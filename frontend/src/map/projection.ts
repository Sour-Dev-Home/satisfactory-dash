/**
 * World metres -> map coordinates (ADR-0023 decision 3). The map core owns this one mapping;
 * layers call `project` and never touch Leaflet's coordinates themselves.
 */

export interface WorldBoundsM {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A swappable base map: a self-drawn or image map is a new config, not new code. */
export interface BaseMapConfig {
  id: string;
  worldBoundsM: WorldBoundsM;
  /** "down": +y is south, as in the game (+x east). */
  yAxis: "down" | "up";
  /** Grid spacing for the neutral grid map, in metres. */
  gridStepM: number;
}

/**
 * v1's base map: a neutral grid over the mapped world, no game art (ADR-0023 decision 4).
 * Bounds: the 7,500 m square from docs-vault/raw-sources/world-coordinates.md (SCIM's bounds in
 * game units / 100; the community 1.5 m/px map agrees to about 2 m). Approximate: the owner's
 * in-game check is still to come.
 */
export const GRID_BASE_MAP: BaseMapConfig = {
  id: "grid",
  worldBoundsM: { minX: -3246.99, maxX: 4253.02, minY: -3750, maxY: 3750 },
  yAxis: "down",
  gridStepM: 500,
};

/** Leaflet CRS.Simple's [lat, lng]; lat grows north. */
export type MapPoint = [lat: number, lng: number];

/** The one projection: [lat, lng] = [-yM, xM] when +y is south (ADR-0023 amendment). */
export function project(config: BaseMapConfig, xM: number, yM: number): MapPoint {
  return [config.yAxis === "down" ? -yM : yM, xM];
}

/** The inverse, for "which buildings are in view": map bounds back to world metres. */
export function unproject(config: BaseMapConfig, [lat, lng]: MapPoint): { xM: number; yM: number } {
  return { xM: lng, yM: config.yAxis === "down" ? -lat : lat };
}

/** The world's corners as map points: south-west and north-east, Leaflet's bounds order. */
export function mapBounds(config: BaseMapConfig): [MapPoint, MapPoint] {
  const { minX, maxX, minY, maxY } = config.worldBoundsM;
  const a = project(config, minX, minY);
  const b = project(config, maxX, maxY);
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  ];
}
