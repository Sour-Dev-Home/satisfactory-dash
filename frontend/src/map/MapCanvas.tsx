import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Factory } from "@satisfactory-dash/shared";
import type { MapContext, MapLayer } from "./layers";
import { mapBounds, project, unproject, type BaseMapConfig } from "./projection";

/** The world rectangle in view, in metres. */
export interface ViewM {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DrawnLayer<T = Factory> {
  layer: MapLayer<T>;
  data: T;
}

const color = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

/** The neutral grid base map (ADR-0023 decision 4): lines every gridStepM, plus the border. */
function drawGrid(map: L.Map, renderer: L.Canvas, config: BaseMapConfig) {
  const { minX, maxX, minY, maxY } = config.worldBoundsM;
  const step = config.gridStepM;
  // The muted token at 65 % over the canvas is about 3.3:1: visible as a scale (WCAG 1.4.11's
  // 3:1), yet quieter than the full-strength world border and the markers.
  const line = { renderer, color: color("--color-muted"), opacity: 0.65, weight: 1, interactive: false };
  const at = (x: number, y: number) => project(config, x, y);
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) L.polyline([at(x, minY), at(x, maxY)], line).addTo(map);
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) L.polyline([at(minX, y), at(maxX, y)], line).addTo(map);
  L.rectangle(mapBounds(config), { ...line, opacity: 1, fill: false }).addTo(map);
}

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
    drawGrid(map, renderer, config);
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
    setCtx({ L, map, renderer, color, project: (x, y) => project(config, x, y) });
    return () => {
      resize.disconnect();
      map.remove();
      setCtx(null);
    };
  }, [config]);

  // Each visible layer draws when its data changes, and cleans up before the next draw.
  useEffect(() => {
    if (!ctx) return;
    const cleanups = layers.map(({ layer, data }) => layer.draw(ctx, data));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [ctx, layers]);

  return (
    <div
      ref={host}
      role="application"
      aria-label="Factory map. Arrow keys pan, plus and minus zoom."
      className="map-canvas h-map min-h-map-min w-full rounded-card border border-line"
    />
  );
}
