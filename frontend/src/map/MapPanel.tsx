import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isBackedUpState, type FactoryResponse } from "@satisfactory-dash/shared";
import { queries, type WorldLayerRead } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { formatPercent } from "../format";
import { Loadable, Skeleton, SkeletonLine, SkeletonStatus } from "../ui/Skeleton";
import { buildingsLayer, placed } from "./buildingsLayer";
import { buildingState, outputPercent, stateLabel } from "./buildingState";
import type { MapLayer } from "./layers";
import type { DrawnLayer, ViewM } from "./MapCanvas";
import { GRID_BASE_MAP } from "./projection";
import { railsLayer } from "./railsLayer";
import { resourceNodesLayer } from "./resourceNodesLayer";
import { RailsTable, ResourceNodesTable } from "./WorldTables";

// Leaflet (about 40 kB gzip) is only needed here: a separate chunk, loaded with this page.
// React.lazy caches a failed import for good, so on failure swap in a fresh lazy component
// and the section's Try again imports again (the same pattern as PowerHistoryPanel).
const loadCanvas = () =>
  import("./MapCanvas").catch((error: unknown) => {
    MapCanvas = lazy(loadCanvas);
    throw error;
  });
let MapCanvas = lazy(loadCanvas);

/**
 * The layers in draw order, bottom first (ADR-0023 decision 5; ADR-0038 M5): the rails and the resource
 * nodes are the data-derived base map, the buildings sit on top. The trains layer (M6) joins next.
 */
const LAYERS = [railsLayer, resourceNodesLayer, buildingsLayer] as const;

/** Binds a layer to its data, which is all the canvas needs to draw it. */
const bind = <T,>(layer: MapLayer<T>, data: T): DrawnLayer => ({ id: layer.id, draw: (ctx) => layer.draw(ctx, data) });

/**
 * A world layer's text beside the map (#494: no "Loading…" line above content): a skeleton line the
 * height of the summary while it loads, the error with Retry, or the summary itself (plus a note when
 * the backend cut the layer to its item cap, so what's drawn is part of it).
 */
function WorldLayerText<T>({ query, layer }: { query: UseQueryResult<WorldLayerRead<T>>; layer: MapLayer<T> }) {
  if (query.isError) {
    return (
      <ErrorNotice
        error={query.error}
        action={
          <button type="button" onClick={() => void query.refetch()} className="min-h-touch">
            Retry {layer.label.toLowerCase()}
          </button>
        }
      />
    );
  }
  return (
    <Loadable pending={query.isPending} skeleton={<SkeletonLine label={`Loading ${layer.label.toLowerCase()}…`} />}>
      {query.data && (
        <p>
          {layer.describe(query.data.data)}
          {query.data.truncated && " The server cut this layer to its size limit, so part of it isn't drawn."}
        </p>
      )}
    </Loadable>
  );
}

/**
 * The canvas's box while its chunk (or the factory) loads: the same `h-map` the map takes, so the
 * panel doesn't grow when Leaflet arrives. `announce` is off inside a panel skeleton that says so.
 */
export function MapCanvasSkeleton({ announce = true }: { announce?: boolean }) {
  return (
    <>
      {announce && <SkeletonStatus>Loading the map…</SkeletonStatus>}
      <Skeleton className="h-map min-h-map-min rounded-card" />
    </>
  );
}

const inView = (view: ViewM | null) => (b: { location: { xM: number; yM: number } }) =>
  !view || (b.location.xM >= view.minX && b.location.xM <= view.maxX && b.location.yM >= view.minY && b.location.yM <= view.maxY);

/**
 * The live factory map (ADR-0023): the map canvas, and the same data as text next to it, for
 * screen readers and keyboard users (decision 7): a summary per layer and a table of the
 * buildings in view, which follows panning and zooming.
 */
export function MapPanel({ snapshot, serverId }: { snapshot: FactoryResponse; serverId: string }) {
  const [visible, setVisible] = useState(() => new Set<string>(LAYERS.filter((l) => l.defaultVisible).map((l) => l.id)));
  const [view, setView] = useState<ViewM | null>(null);
  const shown = placed(snapshot.data.buildings);

  // A world layer is fetched only while its toggle is on (ADR-0038 §2).
  const rails = useQuery({ ...queries.mapRails(serverId), enabled: visible.has(railsLayer.id) });
  const nodes = useQuery({ ...queries.mapResourceNodes(serverId), enabled: visible.has(resourceNodesLayer.id) });
  const railsData = visible.has(railsLayer.id) ? rails.data : undefined;
  const nodesData = visible.has(resourceNodesLayer.id) ? nodes.data : undefined;

  // Stable while the data and toggles are: a new array would make the canvas redraw. In LAYERS order.
  const drawn = useMemo(() => {
    const list: DrawnLayer[] = [];
    if (railsData) list.push(bind(railsLayer, railsData.data));
    if (nodesData) list.push(bind(resourceNodesLayer, nodesData.data));
    if (visible.has(buildingsLayer.id)) list.push(bind(buildingsLayer, snapshot.data));
    return list;
  }, [visible, snapshot, railsData, nodesData]);
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

      <Suspense fallback={<MapCanvasSkeleton />}>
        <MapCanvas config={GRID_BASE_MAP} layers={drawn} fitTo={fitTo} onView={setView} />
      </Suspense>
      <p className="text-sm text-muted">
        A plain grid, 500 m per square, with the rails and resource nodes the server reported: no game map art.
        Positions are approximate until they're checked in game.
      </p>

      {visible.has(railsLayer.id) && <WorldLayerText query={rails} layer={railsLayer} />}
      {visible.has(resourceNodesLayer.id) && <WorldLayerText query={nodes} layer={resourceNodesLayer} />}
      {visible.has(buildingsLayer.id) && <p>{buildingsLayer.describe(snapshot.data)}</p>}
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
                          {stateLabel(buildingState(b))}
                          {percent !== null && ` · ${formatPercent(percent)}`}
                          {isBackedUpState(b) &&" · Backed up"}
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

      {/* After the buildings' list, so a world layer arriving never pushes it down. */}
      {railsData && <RailsTable segments={railsData.data} view={view} />}
      {nodesData && <ResourceNodesTable nodes={nodesData.data} view={view} />}
    </section>
  );
}
