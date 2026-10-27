import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isBackedUpState, type Factory, type FactoryResponse } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { ApiError } from "../api/errors";
import { describeError } from "../components/ErrorNotice";
import { formatPercent } from "../format";
import { Loadable, Skeleton, SkeletonLine, SkeletonStatus } from "../ui/Skeleton";
import { buildingsLayer, placed } from "./buildingsLayer";
import { buildingState, outputPercent, stateLabel } from "./buildingState";
import type { MapLayer } from "./layers";
import type { DrawnLayer, ViewM } from "./MapCanvas";
import { GRID_BASE_MAP } from "./projection";
import { railsLayer } from "./railsLayer";
import { trainsLayer } from "./trainsLayer";
import { resourceNodesLayer } from "./resourceNodesLayer";
import { markersLayer } from "./markersLayer";
import { powerLinesLayer } from "./powerLinesLayer";
import { dronePortsLayer, drawDronePorts } from "./dronePortsLayer";
import { itemLabels, labelFor } from "../factory/itemLabels";
import { MapFilterPanel } from "./MapFilterPanel";
import { buildingCounts, filterBuildings, filterNodes, typeEntries, useMapFilters } from "./mapFilters";
import {
  DronePortsTable,
  EMPTY_FILTERED,
  EMPTY_VIEW,
  MarkersTable,
  PowerLinesTable,
  RailsTable,
  ResourceNodesTable,
  StationsTable,
  TrainsTable,
} from "./WorldTables";

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
 * nodes are the data-derived base map, the power lines (#330) are thin wires over it and under the buildings they
 * feed, the buildings sit on top, the drone ports and their routes (#330) over the buildings (a route crosses them), the
 * players' markers (#330) above them (they point at things), and the live trains (M6) on top of all: they are the layer
 * that redraws every poll, so the canvas redraws only it.
 */
const LAYERS = [railsLayer, resourceNodesLayer, powerLinesLayer, buildingsLayer, dronePortsLayer, markersLayer, trainsLayer] as const;

/** Binds a layer to its data, which is all the canvas needs to draw it. */
const bind = <T,>(layer: MapLayer<T>, data: T): DrawnLayer => ({ id: layer.id, draw: (ctx) => layer.draw(ctx, data) });

/**
 * A world layer's text beside the map (#494: no "Loading…" line above content): a skeleton line the
 * height of the summary while it loads, the error with Retry, or the summary itself (plus a note when
 * the backend cut the layer to its item cap, so what's drawn is part of it).
 */
function WorldLayerText<T>({
  query,
  layer,
  filtered,
}: {
  query: Pick<UseQueryResult<{ data: T; truncated?: boolean }>, "isError" | "isPending" | "data">;
  layer: MapLayer<T>;
  /** What the filters let through, when the layer has filters: the text then speaks of that ("N of M shown"). */
  filtered?: { data: T; shown: number; total: number };
}) {
  // A failed layer says so in the shared error box (WorldErrors), not here.
  if (query.isError) return null;
  const truncated = query.data?.truncated ?? false;
  const hides = filtered !== undefined && filtered.shown < filtered.total;
  return (
    <Loadable pending={query.isPending} skeleton={<SkeletonLine label={`Loading ${layer.label.toLowerCase()}…`} />} className="grid gap-1">
      {query.data && (
        <p>{layer.describe(filtered?.data ?? query.data.data, { truncated, filteredOf: hides ? filtered.total : undefined })}</p>
      )}
      {truncated && (
        <p className="text-sm text-muted">
          Showing part of the {layer.label.toLowerCase()}: the server cut this layer to its size limit.
        </p>
      )}
    </Loadable>
  );
}

/** "Game server unreachable." as a clause after a colon: "game server unreachable". */
const clause = (message: string) => (message.charAt(0).toLowerCase() + message.slice(1)).replace(/\.$/, "");
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The failed world layers in one box, with one Retry (the same cause usually fails both): what failed and
 * why, the request ID small. It sits under the map and its legends, so a failure pushes nothing above it.
 */
function WorldErrors({ failed }: { failed: { label: string; error: unknown; retry: () => void }[] }) {
  if (failed.length === 0) return null;
  const reasons = new Map<string, string[]>();
  for (const { label, error } of failed) {
    const reason = clause(describeError(error));
    reasons.set(reason, [...(reasons.get(reason) ?? []), label.toLowerCase()]);
  }
  const requestId = failed.map((f) => (f.error instanceof ApiError ? f.error.requestId : undefined)).find(Boolean);
  return (
    <div role="alert" className="grid gap-2 text-sm">
      {[...reasons].map(([reason, labels]) => (
        <p key={reason}>
          {sentenceCase(labels.join(" and "))} couldn't load: {reason}.
        </p>
      ))}
      {requestId && <p className="text-xs text-muted">Request ID: {requestId}</p>}
      <div>
        <button type="button" onClick={() => failed.forEach((f) => f.retry())} className="min-h-touch">
          Retry
        </button>
      </div>
    </div>
  );
}

/** A legend row is captioned with its layer (the toggles are above the map, the legends below it). */
function LegendRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-fg">{label}</p>
      {children}
    </div>
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
  const [filters, setFilters] = useMapFilters();
  const visible = useMemo(
    () => new Set<string>(LAYERS.filter((l) => filters.layers.get(l.id) ?? l.defaultVisible).map((l) => l.id)),
    [filters.layers],
  );
  const [view, setView] = useState<ViewM | null>(null);
  // Filters apply before drawing: the layers get only what is shown, and the text speaks of that too.
  const filteredFactory = useMemo<Factory>(
    () => ({ ...snapshot.data, buildings: filterBuildings(snapshot.data.buildings, filters.hiddenStates) }),
    [snapshot, filters.hiddenStates],
  );
  const allPlaced = placed(snapshot.data.buildings);
  const shown = placed(filteredFactory.buildings);
  const counts = useMemo(() => buildingCounts(snapshot.data.buildings), [snapshot]);

  // A world layer is fetched only while its toggle is on (ADR-0038 §2).
  const rails = useQuery({ ...queries.mapRails(serverId), enabled: visible.has(railsLayer.id) });
  const nodes = useQuery({ ...queries.mapResourceNodes(serverId), enabled: visible.has(resourceNodesLayer.id) });
  const powerLines = useQuery({ ...queries.mapPowerLines(serverId), enabled: visible.has(powerLinesLayer.id) });
  const drones = useQuery({ ...queries.mapDroneRoutes(serverId), enabled: visible.has(dronePortsLayer.id) });
  const markers = useQuery({ ...queries.mapMarkers(serverId), enabled: visible.has(markersLayer.id) });
  const live = useQuery({ ...queries.mapLive(serverId), enabled: visible.has(trainsLayer.id) });
  const railsData = visible.has(railsLayer.id) ? rails.data : undefined;
  const nodesData = visible.has(resourceNodesLayer.id) ? nodes.data : undefined;
  const powerLinesData = visible.has(powerLinesLayer.id) ? powerLines.data : undefined;
  const dronesData = visible.has(dronePortsLayer.id) ? drones.data : undefined;
  const markersData = visible.has(markersLayer.id) ? markers.data : undefined;
  const liveData = visible.has(trainsLayer.id) ? live.data : undefined;
  const failed = [
    { on: visible.has(railsLayer.id), label: railsLayer.label, query: rails },
    { on: visible.has(resourceNodesLayer.id), label: resourceNodesLayer.label, query: nodes },
    { on: visible.has(powerLinesLayer.id), label: powerLinesLayer.label, query: powerLines },
    { on: visible.has(dronePortsLayer.id), label: dronePortsLayer.label, query: drones },
    { on: visible.has(markersLayer.id), label: markersLayer.label, query: markers },
    { on: visible.has(trainsLayer.id), label: trainsLayer.label, query: live },
  ]
    .filter((f) => f.on && f.query.isError)
    .map((f) => ({ label: f.label, error: f.query.error, retry: () => void f.query.refetch() }));

  const allNodes = nodesData?.data;
  const shownNodes = useMemo(
    () => (allNodes ? filterNodes(allNodes, filters.hiddenTypes, filters.use) : undefined),
    [allNodes, filters.hiddenTypes, filters.use],
  );
  const nodeTypes = useMemo(() => (allNodes ? typeEntries(allNodes) : []), [allNodes]);

  // Each layer is bound once per change of its own data: the canvas redraws only the layers whose bound
  // `draw` changed (and those above them), so a train poll never redraws the rails, nodes or buildings.
  const railsBound = useMemo(() => (railsData ? bind(railsLayer, railsData.data) : null), [railsData]);
  const nodesBound = useMemo(() => (shownNodes ? bind(resourceNodesLayer, shownNodes) : null), [shownNodes]);
  const powerLinesBound = useMemo(() => (powerLinesData ? bind(powerLinesLayer, powerLinesData.data) : null), [powerLinesData]);
  const buildingsBound = useMemo(() => bind(buildingsLayer, filteredFactory), [filteredFactory]);
  // Drone cargo is a class name; the live factory's items give it its in-game name where a machine reports it.
  // Keyed by the names themselves, not the snapshot: a factory poll with the same items never redraws the ports.
  const namesKey = useMemo(
    () => JSON.stringify([...itemLabels(snapshot.data.buildings)].map(([className, label]) => [className, label.name])),
    [snapshot],
  );
  const itemName = useMemo(() => {
    const names = new Map<string, string>(JSON.parse(namesKey) as [string, string][]);
    return (className: string) => names.get(className) ?? labelFor(new Map(), className).name;
  }, [namesKey]);
  const dronesBound = useMemo<DrawnLayer | null>(
    () => (dronesData ? { id: dronePortsLayer.id, draw: (ctx) => drawDronePorts(ctx, dronesData.data, itemName) } : null),
    [dronesData, itemName],
  );
  const markersBound = useMemo(() => (markersData ? bind(markersLayer, markersData.data) : null), [markersData]);
  const liveBound = useMemo(() => (liveData ? bind(trainsLayer, liveData.data) : null), [liveData]);
  // In LAYERS order; a new array alone doesn't redraw anything.
  const drawn = useMemo(() => {
    const list: DrawnLayer[] = [];
    if (railsBound) list.push(railsBound);
    if (nodesBound) list.push(nodesBound);
    if (powerLinesBound) list.push(powerLinesBound);
    if (visible.has(buildingsLayer.id)) list.push(buildingsBound);
    if (dronesBound) list.push(dronesBound);
    if (markersBound) list.push(markersBound);
    if (liveBound) list.push(liveBound);
    return list;
  }, [visible, railsBound, nodesBound, powerLinesBound, buildingsBound, dronesBound, markersBound, liveBound]);
  // First view: the factory itself, not the whole 7.5 km world. Computed once: later polls
  // never move the view.
  const [fitTo] = useState<ViewM | undefined>(() => {
    if (allPlaced.length === 0) return undefined;
    const xs = allPlaced.map((b) => b.location.xM);
    const ys = allPlaced.map((b) => b.location.yM);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });

  const toggle = (id: string) =>
    setFilters((current) => {
      const layers = new Map(current.layers);
      const on = layers.get(id) ?? LAYERS.find((l) => l.id === id)?.defaultVisible ?? false;
      layers.set(id, !on);
      return { ...current, layers };
    });

  const listed = visible.has(buildingsLayer.id) ? shown.filter(inView(view)) : [];

  return (
    <section aria-labelledby="map-heading" className="panel grid gap-4">
      <h3 id="map-heading" className="mb-0">
        Factory map
      </h3>
      {/* Three columns on a phone, so no label wraps on its own; a row from the small breakpoint up. */}
      <fieldset className="grid grid-cols-3 gap-x-2 gap-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6">
        <legend className="sr-only">Layers</legend>
        {LAYERS.map((layer) => (
          <label key={layer.id} className="flex min-h-touch items-center gap-2">
            <input type="checkbox" checked={visible.has(layer.id)} onChange={() => toggle(layer.id)} />
            {layer.label}
          </label>
        ))}
      </fieldset>
      {/* Only the groups of layers that are on; the types are the ones in the data (none until it arrives). */}
      <MapFilterPanel
        filters={filters}
        onChange={setFilters}
        types={nodesData ? nodeTypes : visible.has(resourceNodesLayer.id) ? [] : null}
        buildingCounts={visible.has(buildingsLayer.id) ? counts : null}
      />

      <Suspense fallback={<MapCanvasSkeleton />}>
        <MapCanvas config={GRID_BASE_MAP} layers={drawn} fitTo={fitTo} onView={setView} />
      </Suspense>
      {/* Under the map, not above it: three layers' legends above would push the map off a phone's first screen. */}
      {/* One captioned row per layer that has something drawn: off, empty, loading or failed layers have none. */}
      {railsData && railsData.data.length > 0 && <LegendRow label={railsLayer.label}>{railsLayer.legend()}</LegendRow>}
      {nodesData && nodesData.data.length > 0 && (
        <LegendRow label={resourceNodesLayer.label}>{resourceNodesLayer.legend()}</LegendRow>
      )}
      {powerLinesData && powerLinesData.data.length > 0 && (
        <LegendRow label={powerLinesLayer.label}>{powerLinesLayer.legend()}</LegendRow>
      )}
      {visible.has(buildingsLayer.id) && shown.length > 0 && (
        <LegendRow label={buildingsLayer.label}>{buildingsLayer.legend()}</LegendRow>
      )}
      {dronesData && dronesData.data.length > 0 && <LegendRow label={dronePortsLayer.label}>{dronePortsLayer.legend()}</LegendRow>}
      {markersData && markersData.data.length > 0 && <LegendRow label={markersLayer.label}>{markersLayer.legend()}</LegendRow>}
      {liveData && (liveData.data.trains.length > 0 || liveData.data.stations.length > 0) && (
        <LegendRow label={trainsLayer.label}>{trainsLayer.legend()}</LegendRow>
      )}
      <WorldErrors failed={failed} />
      <p className="text-sm text-muted">
        The island's coast, lakes and high ground, traced from the game's map, under a grid of 500 m squares, with the
        rails, resource nodes, power lines, drone ports, players' markers and trains the server reported, nodes drawn with the game's icons. Trains move with the
        latest reading, about every 10 seconds. Positions are approximate until they're checked in game.
      </p>
      <p className="text-sm text-muted">Satisfactory, its map and its icons © Coffee Stain Studios. Not affiliated.</p>

      {visible.has(railsLayer.id) && <WorldLayerText query={rails} layer={railsLayer} />}
      {visible.has(resourceNodesLayer.id) && (
        <WorldLayerText
          query={nodes}
          layer={resourceNodesLayer}
          filtered={allNodes && shownNodes ? { data: shownNodes, shown: shownNodes.length, total: allNodes.length } : undefined}
        />
      )}
      {visible.has(powerLinesLayer.id) && <WorldLayerText query={powerLines} layer={powerLinesLayer} />}
      {visible.has(dronePortsLayer.id) && <WorldLayerText query={drones} layer={dronePortsLayer} />}
      {visible.has(markersLayer.id) && <WorldLayerText query={markers} layer={markersLayer} />}
      {visible.has(trainsLayer.id) && <WorldLayerText query={live} layer={trainsLayer} />}
      {liveData?.stale && (
        <p className="text-sm text-muted">The game server can't be reached, so these are the last known train positions.</p>
      )}
      {visible.has(buildingsLayer.id) && (
        <p>
          {buildingsLayer.describe(filteredFactory, shown.length < allPlaced.length ? { filteredOf: allPlaced.length } : undefined)}
        </p>
      )}
      {visible.has(buildingsLayer.id) && (
        <div className="grid gap-2">
          <h4 id="map-list-heading">Buildings in view ({listed.length})</h4>
          {listed.length === 0 ? (
            <p className="text-sm text-muted">{shown.length === 0 && allPlaced.length > 0 ? EMPTY_FILTERED : EMPTY_VIEW}</p>
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
                        <td data-label="Building">{b.name}</td>
                        <td data-label="Recipe">{b.recipe ?? "No recipe"}</td>
                        <td data-label="State">
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
      {allNodes && shownNodes && <ResourceNodesTable nodes={shownNodes} view={view} hidden={allNodes.length - shownNodes.length} />}
      {powerLinesData && <PowerLinesTable lines={powerLinesData.data} view={view} />}
      {dronesData && <DronePortsTable ports={dronesData.data} view={view} itemName={itemName} />}
      {markersData && <MarkersTable markers={markersData.data} view={view} />}
      {liveData && <TrainsTable trains={liveData.data.trains} view={view} />}
      {liveData && <StationsTable stations={liveData.data.stations} view={view} />}
    </section>
  );
}
