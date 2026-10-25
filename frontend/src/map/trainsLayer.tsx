import type * as Leaflet from "leaflet";
import type { MapLive, MapTrain, MapTrainStation } from "@satisfactory-dash/shared";
import type { MapLayer } from "./layers";
import type { MapPoint } from "./projection";
import { countOf, formatPoint } from "./worldGeometry";

/** Trains and stations get their own tokens, clear of the rails, nodes and the state colours (index.css). */
export const TRAIN_TOKEN = "--color-train";
export const STATION_TOKEN = "--color-station";
/** The motion token a train's slide to its new position is timed by; reduced motion sets it to 0s. */
export const GLIDE_TOKEN = "--duration-glide";
/** On-screen radii in pixels (Leaflet's radius is in pixels), the same at every zoom. */
export const TRAIN_RADIUS_PX = 7;
export const STATION_RADIUS_PX = 5;
export const STATION_WEIGHT_PX = 2;

/** A token's duration ("1s", "240ms") in milliseconds; 0 when it is missing or odd, so nothing animates. */
export function durationMs(value: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/** Ease in and out (quadratic): `t` and the result are both 0 to 1. */
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Where each train was last drawn, per map, by id. A poll redraws the layer (cleanup, then draw); this is
 * how the new draw starts from the old place and slides, instead of the train jumping. Each frame of a
 * slide records the place it reached, so a redraw halfway starts from there. Ids come from the game, so
 * the table is a Map.
 */
const lastDrawn = new WeakMap<Leaflet.Map, Map<string, MapPoint>>();

/** A tooltip as DOM text nodes: names come from the game server, so they never go through HTML. */
function tooltip(title: string, ...lines: string[]): HTMLElement {
  const box = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  box.append(strong);
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line;
    box.append(row);
  }
  return box;
}

const trainTooltip = (t: MapTrain) => tooltip(t.name, t.status, formatPoint([t.x, t.y]));
const stationTooltip = (s: MapTrainStation) => tooltip(s.name, "Train station", formatPoint([s.x, s.y]));

/**
 * ADR-0038 M6, the live trains layer: each train a dot, each station a ring, from `map/live` (polled
 * every 10 s). Drawn on the shared canvas above the buildings. On a new reading a train slides to its
 * new place over `--duration-glide`, eased both ways. Only this layer redraws on a poll (the canvas
 * diffs layers), and it repaints in the same frame, so it doesn't flicker.
 */
export const trainsLayer: MapLayer<MapLive> = {
  id: "trains",
  label: "Trains",
  defaultVisible: true,

  draw({ L, map, project, renderer, color, token }, live) {
    const group = L.layerGroup();
    const stationColor = color(STATION_TOKEN);
    const trainColor = color(TRAIN_TOKEN);
    for (const station of live.stations) {
      L.circleMarker(project(station.x, station.y), {
        renderer,
        radius: STATION_RADIUS_PX,
        color: stationColor,
        weight: STATION_WEIGHT_PX,
        fillColor: stationColor,
        fillOpacity: 0.25,
      })
        .bindTooltip(() => stationTooltip(station), { sticky: true })
        .addTo(group);
    }

    const before = lastDrawn.get(map);
    const drawn = new Map<string, MapPoint>();
    const glideMs = durationMs(token(GLIDE_TOKEN));
    const slides: { marker: Leaflet.CircleMarker; from: MapPoint; to: MapPoint; id: string }[] = [];
    for (const train of live.trains) {
      const to = project(train.x, train.y);
      const from = glideMs > 0 ? (before?.get(train.id) ?? to) : to;
      const marker = L.circleMarker(from, { renderer, radius: TRAIN_RADIUS_PX, stroke: false, fillColor: trainColor, fillOpacity: 1 })
        .bindTooltip(() => trainTooltip(train), { sticky: true })
        .addTo(group);
      drawn.set(train.id, from);
      if (from[0] !== to[0] || from[1] !== to[1]) slides.push({ marker, from, to, id: train.id });
    }
    lastDrawn.set(map, drawn);
    group.addTo(map);

    let frame = 0;
    if (slides.length > 0) {
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, Math.max(0, (time - start) / glideMs));
        const e = easeInOut(t);
        for (const { marker, from, to, id } of slides) {
          const at: MapPoint = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
          marker.setLatLng(at);
          drawn.set(id, at);
        }
        frame = t < 1 ? requestAnimationFrame(step) : 0;
      };
      frame = requestAnimationFrame(step);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      group.remove();
    };
  },

  legend: () => (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 flex-none">
          <circle cx="8" cy="8" r={TRAIN_RADIUS_PX} className="fill-train" />
        </svg>
        Train
      </li>
      <li className="flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 flex-none">
          <circle cx="8" cy="8" r={STATION_RADIUS_PX} className="fill-station/25 stroke-station" strokeWidth={STATION_WEIGHT_PX} />
        </svg>
        Station
      </li>
    </ul>
  ),

  describe(live) {
    const { trains, stations } = live;
    if (trains.length === 0 && stations.length === 0) return "No trains or stations built yet.";
    return `${countOf(trains.length, "train", "trains")} and ${countOf(stations.length, "station", "stations")} on the map.`;
  },
};
