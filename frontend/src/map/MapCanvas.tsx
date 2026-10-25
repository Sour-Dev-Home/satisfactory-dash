import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapContext } from "./layers";
import { drawGrid } from "./grid";
import { mapBounds, project, unproject, type BaseMapConfig } from "./projection";

/** The world rectangle in view, in metres. */
export interface ViewM {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DrawnLayer {
  id: string;
  /** Draws the layer with its data bound; returns the cleanup (the MapLayer contract). */
  draw: (ctx: MapContext) => () => void;
}

/** A design token's current value (a colour, or a motion token such as --duration-base). */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * The map core (ADR-0023): Leaflet with CRS.Simple, a canvas renderer, the grid base map, and
 * the visible layers drawn through the MapLayer contract. A lazy chunk, loaded with the Map
 * page only. Leaflet styles through the CSSOM and its CSS is a static file, so the strict CSP
 * (style-src 'self') holds; e2e/map.spec.ts proves it for pan, zoom, hover and layer toggles.
 */
export default function MapCanvas({
  config,
  layers,
  fitTo,
  onView,
}: {
  config: BaseMapConfig;
  layers: DrawnLayer[];
  /** Where to look first (e.g. the factory's extent); the whole world when absent. */
  fitTo?: ViewM;
  onView: (view: ViewM) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapContext | null>(null);
  const reportView = useRef(onView);
  const initialFit = useRef(fitTo);
  useEffect(() => {
    reportView.current = onView;
  }, [onView]);

  useEffect(() => {
    const el = host.current!;
    const renderer = L.canvas({ padding: 0.5 });
    const fit = initialFit.current;
    const world = L.latLngBounds(mapBounds(config));
    const target = fit
      ? L.latLngBounds([project(config, fit.minX, fit.minY), project(config, fit.maxX, fit.maxY)]).pad(0.15)
      : world;
    // Panning stops a little past the world, or past the factory if it lies outside: the
    // world bounds are approximate (world-coordinates.md), and a clamp to them would snap the
    // first view to an empty corner instead of showing the buildings.
    const map = L.map(el, {
      crs: L.CRS.Simple,
      renderer,
      minZoom: -5,
      maxZoom: 3,
      zoomSnap: 0.25,
      attributionControl: false,
      maxBounds: L.latLngBounds(world.getSouthWest(), world.getNorthEast()).extend(target).pad(0.1),
      maxBoundsViscosity: 1,
    });
    drawGrid(L, map, renderer, config, token);
    map.fitBounds(target, { maxZoom: 1 });

    const report = () => {
      const bounds = map.getBounds();
      const a = unproject(config, [bounds.getSouth(), bounds.getWest()]);
      const b = unproject(config, [bounds.getNorth(), bounds.getEast()]);
      reportView.current({
        minX: Math.min(a.xM, b.xM),
        maxX: Math.max(a.xM, b.xM),
        minY: Math.min(a.yM, b.yM),
        maxY: Math.max(a.yM, b.yM),
      });
    };
    map.on("moveend", report);
    report();

    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el);
    setCtx({ L, map, renderer, color: token, token, project: (x, y) => project(config, x, y) });
    return () => {
      resize.disconnect();
      map.remove();
      setCtx(null);
    };
  }, [config]);

  // Each visible layer draws when its data changes, and cleans up before the next draw. Only from the
  // first layer that changed (a different layer or a new `draw`) upward: the layers above it redraw so
  // the stacking order holds, those below keep what they drew. A live poll then redraws only the
  // trains layer (the top one), never the rails, nodes and buildings under it.
  const drawn = useRef<{ layer: DrawnLayer; cleanup: () => void }[]>([]);
  useEffect(() => {
    if (!ctx) return;
    const current = drawn.current;
    let keep = 0;
    while (keep < current.length && keep < layers.length && current[keep].layer.id === layers[keep].id && current[keep].layer.draw === layers[keep].draw) {
      keep++;
    }
    for (const { cleanup } of current.splice(keep).reverse()) cleanup();
    for (const layer of layers.slice(keep)) current.push({ layer, cleanup: layer.draw(ctx) });
  }, [ctx, layers]);
  // The map is going (or its context was replaced): everything drawn goes with it.
  useEffect(
    () => () => {
      for (const { cleanup } of drawn.current.splice(0).reverse()) cleanup();
    },
    [ctx],
  );

  return (
    <div
      ref={host}
      role="application"
      aria-label="Factory map. Arrow keys pan, plus and minus zoom."
      className="map-canvas h-map min-h-map-min w-full rounded-card border border-line"
    />
  );
}
