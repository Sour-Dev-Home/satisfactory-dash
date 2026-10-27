import type * as Leaflet from "leaflet";
import { project, type BaseMapConfig } from "./projection";

/**
 * The terrain base map (ADR-0023 amendment, #571): the game's world map traced once into shapes by
 * `scripts/map-terrain.mjs`, drawn in our own colours. The texture never ships; these shapes are derived from it,
 * so they sit behind the same licence boundary and takedown switch as the game icons (see terrain/NOTICE.md).
 */
export interface Terrain {
  boundsM: { minX: number; maxX: number; minY: number; maxY: number };
  /** Every land ring (outer coasts and lake holes alike), each a flat [x0, y0, x1, y1, ...] in whole metres. */
  land: number[][];
  /** One tint per terrain class over the land, in the same ring form. */
  classes: { id: string; rings: number[][] }[];
}

/** The token for a terrain class's tint; a class without one is drawn in the land colour. */
export const terrainToken = (id: string) => `--color-terrain-${id}`;

/** Takedown switch (#571 "Revisit when"): false draws the neutral grid alone, then delete terrain/. */
export const TERRAIN_ENABLED = true;

function rings(config: BaseMapConfig, flat: number[][]): Leaflet.LatLngTuple[][] {
  return flat.map((ring) => {
    const out: Leaflet.LatLngTuple[] = [];
    for (let i = 0; i + 1 < ring.length; i += 2) out.push(project(config, ring[i], ring[i + 1]));
    return out;
  });
}

/**
 * Draws the land, then each class's tint, under everything else; quiet on purpose (ADR-0041), so the grid and the
 * layers stay the information. Rings go to one polygon per class with an even-odd fill, which draws coasts and lakes
 * right without knowing which ring is a hole. Returns the cleanup.
 */
export function drawTerrain(
  L: typeof Leaflet,
  map: Leaflet.Map,
  renderer: Leaflet.Canvas,
  config: BaseMapConfig,
  color: (token: string) => string,
  terrain: Terrain,
): () => void {
  const land = color("--color-terrain-land");
  const style = { renderer, stroke: false, fillOpacity: 1, fillRule: "evenodd" as const, interactive: false };
  const drawn: Leaflet.Polygon[] = [];
  if (terrain.land.length > 0) drawn.push(L.polygon(rings(config, terrain.land), { ...style, fillColor: land }));
  for (const c of terrain.classes) {
    if (c.rings.length === 0) continue;
    drawn.push(L.polygon(rings(config, c.rings), { ...style, fillColor: color(terrainToken(c.id)) || land }));
  }
  if (terrain.land.length > 0) {
    drawn.push(L.polygon(rings(config, terrain.land), { ...style, fill: false, stroke: true, weight: 1, color: color("--color-terrain-coast") }));
  }
  for (const p of drawn) p.addTo(map);
  return () => {
    for (const p of drawn) p.remove();
  };
}
