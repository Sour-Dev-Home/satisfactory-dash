import type { ReactNode } from "react";
import type { Factory } from "@satisfactory-dash/shared";
import type * as Leaflet from "leaflet";
import type { MapPoint } from "./projection";

/**
 * What the map core hands a layer (ADR-0023 decision 5). Leaflet itself comes through here, so
 * layer modules never import it at runtime and it stays in the map's lazy chunk.
 */
export interface MapContext {
  L: typeof Leaflet;
  map: Leaflet.Map;
  /** World metres to map coordinates; the only projection (projection.ts). */
  project: (xM: number, yM: number) => MapPoint;
  /** One shared canvas renderer: markers are drawn, not DOM nodes. */
  renderer: Leaflet.Canvas;
  /** A design token's current value (e.g. "--color-ok"), for canvas colours. */
  color: (token: string) => string;
}

/**
 * A map layer plug-in. v1's layers all draw the factory data; a layer with its own data
 * adds a query to this contract when it arrives (ADR-0023: power circuits, then belts, trains).
 */
export interface MapLayer<T = Factory> {
  id: string;
  label: string;
  defaultVisible: boolean;
  /** Draws onto the map; returns the cleanup that removes everything it drew. */
  draw: (ctx: MapContext, data: T) => () => void;
  legend: () => ReactNode;
  /** The text alternative to what the layer draws (ADR-0023 decision 7). */
  describe: (data: T) => ReactNode;
}
