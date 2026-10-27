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
  /**
   * Any design token's current value, e.g. a motion token ("--duration-base"). Reduced motion sets
   * the motion tokens to 0s, so a layer that times a canvas animation by one honours it for free.
   */
  token: (name: string) => string;
}

/** What a layer's text may need beyond its data. */
export interface DescribeOptions {
  /** The backend cut the layer to its item cap: the text speaks of what is shown, not of a total. */
  truncated?: boolean;
  /** Filters hide some: how many the layer has in all. The text then says "N of M shown" and that the rest are hidden. */
  filteredOf?: number;
}

/**
 * A map layer plug-in. The buildings layer draws the factory data; a world layer (ADR-0038: rails,
 * resource nodes) draws its own stored list, which MapPanel reads through the query layer only while
 * the layer is on. `T` is that data; the contract itself doesn't change.
 */
export interface MapLayer<T = Factory> {
  id: string;
  label: string;
  /** How the map's caption names the layer when its label in lower case won't do ("players' markers"; caption.ts). */
  caption?: string;
  defaultVisible: boolean;
  /** Draws onto the map; returns the cleanup that removes everything it drew. */
  draw: (ctx: MapContext, data: T) => () => void;
  legend: () => ReactNode;
  /** The text alternative to what the layer draws (ADR-0023 decision 7). */
  describe: (data: T, options?: DescribeOptions) => ReactNode;
}
