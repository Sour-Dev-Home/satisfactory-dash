import { useEffect, useState } from "react";
import { isBackedUpState, type FactoryBuilding, type ResourceNode } from "@satisfactory-dash/shared";
import { buildingState, stateLabel, type BuildingState } from "./buildingState";

/**
 * The map's view choices (the owner's call, 2026-10-21): which layers are on, which resource types and
 * building states are hidden, in use vs free, and whether the Filters disclosure is open. A UI
 * preference kept in this browser only (nothing auth-related). Storage can be missing, throw (private
 * mode, blocked site data) or hold anything (an old version, hand edits): every read and write is in a
 * try/catch and what's read is validated, and anything wrong falls back to everything shown.
 *
 * Hidden things are stored, not shown ones, so a resource type that appears later in the data (unknown
 * to the saved state) is shown.
 */
export const MAP_FILTERS_KEY = "satis-manager.map-filters.v1";

export type UseFilter = "all" | "free" | "used";
/** A building's filter class: its state, or "backedUp" (the warn ring wins over the state, as it does when drawn). */
export type BuildingFilterKey = BuildingState | "backedUp";

export const BUILDING_FILTER_KEYS: readonly BuildingFilterKey[] = ["producing", "idle", "paused", "noRecipe", "backedUp"];
export const buildingFilterLabel = (key: BuildingFilterKey) => (key === "backedUp" ? "Backed up" : stateLabel(key));

export interface MapFilters {
  /** The user's layer toggles by layer id; a layer not in here keeps its default. */
  layers: ReadonlyMap<string, boolean>;
  open: boolean;
  hiddenTypes: ReadonlySet<string>;
  use: UseFilter;
  hiddenStates: ReadonlySet<BuildingFilterKey>;
}

export const DEFAULT_FILTERS: MapFilters = {
  layers: new Map(),
  open: false,
  hiddenTypes: new Set(),
  use: "all",
  hiddenStates: new Set(),
};

const MAX_ENTRIES = 200;
const MAX_NAME = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const names = (value: unknown): string[] | null =>
  Array.isArray(value) && value.length <= MAX_ENTRIES && value.every((v) => typeof v === "string" && v.length <= MAX_NAME)
    ? (value as string[])
    : null;

/** Validates what was stored; null when it isn't a current-version state (the caller shows everything). */
export function parseFilters(raw: string | null): MapFilters | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.v !== 1) return null;
    const { layers, open, hiddenTypes, use, hiddenStates } = value;
    const types = names(hiddenTypes);
    const states = names(hiddenStates);
    if (!isRecord(layers) || typeof open !== "boolean" || !types || !states) return null;
    if (use !== "all" && use !== "free" && use !== "used") return null;
    const entries = Object.entries(layers);
    if (entries.length > MAX_ENTRIES || !entries.every(([, on]) => typeof on === "boolean")) return null;
    return {
      layers: new Map(entries as [string, boolean][]),
      open,
      hiddenTypes: new Set(types),
      use,
      hiddenStates: new Set(BUILDING_FILTER_KEYS.filter((k) => states.includes(k))),
    };
  } catch {
    return null;
  }
}

export function serializeFilters(filters: MapFilters): string {
  return JSON.stringify({
    v: 1,
    layers: Object.fromEntries(filters.layers),
    open: filters.open,
    hiddenTypes: [...filters.hiddenTypes],
    use: filters.use,
    hiddenStates: [...filters.hiddenStates],
  });
}

function readStored(): MapFilters {
  try {
    return parseFilters(window.localStorage.getItem(MAP_FILTERS_KEY)) ?? DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** The map's choices, remembered in this browser. Without storage they still work for this page. */
export function useMapFilters(): [MapFilters, (update: (current: MapFilters) => MapFilters) => void] {
  const [filters, setFilters] = useState<MapFilters>(readStored);
  useEffect(() => {
    try {
      window.localStorage.setItem(MAP_FILTERS_KEY, serializeFilters(filters));
    } catch {
      // Not remembered across reloads.
    }
  }, [filters]);
  return [filters, (update) => setFilters(update)];
}

/** What a node is filtered by: its resource name, and "Geyser" for any geyser (the icon follows `nodeType` too). */
export const GEYSER_KEY = "Geyser";
export const nodeKey = (node: ResourceNode) => (node.nodeType === "geyser" ? GEYSER_KEY : node.type);

export function filterNodes(nodes: readonly ResourceNode[], hiddenTypes: ReadonlySet<string>, use: UseFilter): ResourceNode[] {
  return nodes.filter((n) => !hiddenTypes.has(nodeKey(n)) && (use === "all" || (use === "used") === n.exploited));
}

export const buildingFilterKey = (b: FactoryBuilding): BuildingFilterKey => (isBackedUpState(b) ? "backedUp" : buildingState(b));

/** Buildings without a position are kept: they're never drawn, and the text says how many have none. */
export function filterBuildings(buildings: readonly FactoryBuilding[], hidden: ReadonlySet<BuildingFilterKey>): FactoryBuilding[] {
  if (hidden.size === 0) return [...buildings];
  return buildings.filter((b) => !b.location || !hidden.has(buildingFilterKey(b)));
}

export interface TypeEntry {
  key: string;
  count: number;
  /** A node of the type, for its icon. */
  sample: ResourceNode;
}

/** The resource types present, most numerous first. */
export function typeEntries(nodes: readonly ResourceNode[]): TypeEntry[] {
  const found = new Map<string, TypeEntry>();
  for (const node of nodes) {
    const key = nodeKey(node);
    const entry = found.get(key);
    if (entry) entry.count++;
    else found.set(key, { key, count: 1, sample: node });
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

/** What the collapsed disclosure says is hidden, for the layers that are on (null = that layer is off). */
export function hiddenSummary(
  filters: MapFilters,
  types: readonly TypeEntry[] | null,
  buildingCounts: ReadonlyMap<BuildingFilterKey, number> | null,
): string {
  const parts: string[] = [];
  if (types) {
    const hidden = types.filter((t) => filters.hiddenTypes.has(t.key)).length;
    if (hidden > 0) parts.push(`${hidden} resource ${hidden === 1 ? "type" : "types"} hidden`);
    if (filters.use === "free") parts.push("free nodes only");
    if (filters.use === "used") parts.push("nodes in use only");
  }
  if (buildingCounts) {
    const hidden = BUILDING_FILTER_KEYS.filter((k) => filters.hiddenStates.has(k)).length;
    if (hidden > 0) parts.push(`${hidden} building ${hidden === 1 ? "state" : "states"} hidden`);
  }
  return parts.length === 0 ? "nothing hidden" : parts.join(", ");
}
