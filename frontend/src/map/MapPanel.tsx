import { lazy, Suspense, useMemo, useState } from "react";
import type { Factory, FactoryResponse } from "@satisfactory-dash/shared";
import { formatPercent } from "../format";
import { buildingsLayer, placed } from "./buildingsLayer";
import { STATE_LABEL, buildingState, outputPercent } from "./buildingState";
import type { MapLayer } from "./layers";
import type { ViewM } from "./MapCanvas";
import { GRID_BASE_MAP } from "./projection";

// Leaflet (about 40 kB gzip) is only needed here: a separate chunk, loaded with this page.
// React.lazy caches a failed import for good, so on failure swap in a fresh lazy component
// and the section's Try again imports again (the same pattern as PowerHistoryPanel).
const loadCanvas = () =>
  import("./MapCanvas").catch((error: unknown) => {
    MapCanvas = lazy(loadCanvas);
    throw error;
  });
let MapCanvas = lazy(loadCanvas);

/** v1's layers (ADR-0023 decision 5); the power-circuit layer joins next. */
const LAYERS: MapLayer<Factory>[] = [buildingsLayer];

const inView = (view: ViewM | null) => (b: { location: { xM: number; yM: number } }) =>
  !view || (b.location.xM >= view.minX && b.location.xM <= view.maxX && b.location.yM >= view.minY && b.location.yM <= view.maxY);

/**
 * The live factory map (ADR-0023): the map canvas, and the same data as text next to it, for
 * screen readers and keyboard users (decision 7): a summary per layer and a table of the
 * buildings in view, which follows panning and zooming.
 */
export function MapPanel({ snapshot }: { snapshot: FactoryResponse }) {
  const [visible, setVisible] = useState(() => new Set(LAYERS.filter((l) => l.defaultVisible).map((l) => l.id)));
  const [view, setView] = useState<ViewM | null>(null);
  const shown = placed(snapshot.data.buildings);

  // Stable while the data and toggles are: a new array would make the canvas redraw.
  const drawn = useMemo(
    () => LAYERS.filter((l) => visible.has(l.id)).map((layer) => ({ layer, data: snapshot.data })),
    [visible, snapshot],
  );
  // First view: the factory itself, not the whole 7.5 km world. Computed once: later polls
  // never move the view.
  const [fitTo] = useState<ViewM | undefined>(() => {
    if (shown.length === 0) return undefined;
    const xs = shown.map((b) => b.location.xM);
    const ys = shown.map((b) => b.location.yM);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });

  const toggle = (id: string) =>
    setVisible((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const listed = visible.has(buildingsLayer.id) ? shown.filter(inView(view)) : [];

  return (
    <section aria-labelledby="map-heading" className="panel grid gap-4">
      <h3 id="map-heading" className="mb-0">
        Factory map
      </h3>
      <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <legend className="sr-only">Layers</legend>
        {LAYERS.map((layer) => (
          <label key={layer.id} className="flex min-h-touch items-center gap-2">
            <input type="checkbox" checked={visible.has(layer.id)} onChange={() => toggle(layer.id)} />
            {layer.label}
          </label>
        ))}
      </fieldset>
      {LAYERS.filter((l) => visible.has(l.id)).map((layer) => (
        <div key={layer.id}>{layer.legend()}</div>
      ))}

      <Suspense fallback={<div className="grid h-map min-h-map-min place-items-center rounded-card border border-line text-muted">Loading the map…</div>}>
        <MapCanvas config={GRID_BASE_MAP} layers={drawn} fitTo={fitTo} onView={setView} />
      </Suspense>
      <p className="text-sm text-muted">
        A plain grid, 500 m per square: no map art yet. Positions are approximate until they're checked in game.
      </p>

      {LAYERS.filter((l) => visible.has(l.id)).map((layer) => (
        <p key={layer.id}>{layer.describe(snapshot.data)}</p>
      ))}

      {visible.has(buildingsLayer.id) && (
        <div className="grid gap-2">
          <h4 id="map-list-heading">Buildings in view ({listed.length})</h4>
          {listed.length === 0 ? (
            <p className="text-sm text-muted">None in view. Zoom out or pan to see more.</p>
          ) : (
            // Focusable, so keyboard users can scroll it (axe scrollable-region-focusable).
            <div tabIndex={0} role="region" aria-labelledby="map-list-heading" className="max-h-80 overflow-auto">
              <table aria-labelledby="map-list-heading" className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col">Building</th>
                    <th scope="col">Recipe</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((b) => {
                    const percent = outputPercent(b);
                    return (
                      <tr key={b.id}>
                        <td>{b.name}</td>
                        <td>{b.recipe ?? "No recipe"}</td>
                        <td>
                          {STATE_LABEL[buildingState(b)]}
                          {percent !== null && ` · ${formatPercent(percent)}`}
                          {b.isBackedUp && " · Backed up"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
