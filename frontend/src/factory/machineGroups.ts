import {
  isBackedUpState,
  type FactoryBuilding,
  type PlannerDesignation,
  type PlannerNode,
  type ProductionGraph,
  type ProductionRate,
} from "@satisfactory-dash/shared";
import { buildFactoryTree, type TreeNode } from "../planner/factoryTree";
import { factoryOfNode } from "../planner/graph/hierarchy";
import { groupLabel } from "../planner/plannerText";
import { machineState, type MachineStateView } from "./machineState";

/**
 * ADR-0062 F.2, pure: the Factory page's machines grouped the way the Planner shows them, by factory (with ADR-0061's
 * parents) and then by group, from the same production graph and designations reads. Each machine is
 * listed once: under the group that names its id first, in the tree's order (a group shared between factories goes under
 * the factory that owns it, `factoryOfNode`), and whatever no group names under "Other machines".
 */

export interface MachineGroup {
  /** The graph node's key; for UI state only. */
  key: string;
  /** "8× Constructor, Iron Plate": the Planner's words, counted over the machines listed here. */
  label: string;
  buildings: FactoryBuilding[];
  /** The group's machines before the filter and search. */
  total: number;
}

export interface MachineFactory {
  key: string;
  name: string;
  /** A leaf's (or a parent's own machines') groups; empty for a parent. */
  groups: MachineGroup[];
  /** A parent's parts in the tree's order: its own machines first, then its children. Empty for the others. */
  parts: MachineFactory[];
  /** Over the groups and parts below, shown and before the filter. */
  machineCount: number;
  total: number;
  /** All groups below it, the count the outline's "over 20 groups starts closed" rule reads. */
  groupCount: number;
}

export interface MachineGrouping {
  factories: MachineFactory[];
  /** Groups no factory claims: every group, from a backend without factories. */
  groups: MachineGroup[];
  /** Machines no group names (a machine built since the graph was read, or one the graph's caps left out). */
  other: FactoryBuilding[];
  otherTotal: number;
}

/** The key of the "Other machines" section, for UI state; a graph node's key never has a NUL. */
export const OTHER_MACHINES_KEY = "\u0000other";

/**
 * The grouping, or null when there is nothing to group by: no graph yet (late or failed, so the table shows flat, one
 * group), or a graph that names none of these machines (a graph read from another snapshot).
 */
export function groupMachines(
  buildings: readonly FactoryBuilding[],
  graph: ProductionGraph | undefined,
  designations: readonly PlannerDesignation[] | undefined,
): MachineGrouping | null {
  if (graph === undefined) return null;
  // Ids come from the game server: a Map. A repeated id (never expected) groups its first building; the others go under
  // "Other machines", so every row the flat table would show is still listed (`test-hunter`).
  const byId = new Map<string, FactoryBuilding>();
  for (const b of buildings) if (!byId.has(b.id)) byId.set(b.id, b);
  const claimed = new Set<string>();
  const grouped = new Set<FactoryBuilding>();
  const visited = new Set<string>();
  const groupOf = (node: PlannerNode): MachineGroup[] => {
    if (visited.has(node.key)) return [];
    visited.add(node.key);
    const list: FactoryBuilding[] = [];
    for (const id of node.machineIds) {
      const b = byId.get(id);
      if (b === undefined || claimed.has(id)) continue;
      claimed.add(id);
      grouped.add(b);
      list.push(b);
    }
    if (list.length === 0) return [];
    return [{ key: node.key, label: groupLabel({ ...node, count: list.length }), buildings: list, total: list.length }];
  };

  const owner = factoryOfNode(graph);
  const tree = buildFactoryTree(graph, designations);
  const sectionOf = (entry: TreeNode): MachineFactory[] => {
    if (entry.kind === "parent") {
      const parts = entry.childKeys.flatMap((k) => {
        const part = tree.nodes.get(k);
        return part === undefined ? [] : sectionOf(part);
      });
      return parts.length === 0 ? [] : [factorySection(entry.key, entry.name, [], parts)];
    }
    const opens = entry.opens;
    if (opens === undefined) return [];
    const groups = opens.nodes.filter((n) => owner.get(n.key) === opens.factory.key).flatMap(groupOf);
    return groups.length === 0 ? [] : [factorySection(entry.key, entry.name, groups, [])];
  };
  const factories = tree.rootKeys.flatMap((k) => {
    const entry = tree.nodes.get(k);
    return entry === undefined ? [] : sectionOf(entry);
  });
  const groups = graph.nodes.flatMap(groupOf);
  if (claimed.size === 0) return null;
  const other = buildings.filter((b) => !grouped.has(b));
  return { factories, groups, other, otherTotal: other.length };
}

function factorySection(key: string, name: string, groups: MachineGroup[], parts: MachineFactory[]): MachineFactory {
  const machineCount = groups.reduce((s, g) => s + g.buildings.length, 0) + parts.reduce((s, p) => s + p.machineCount, 0);
  const total = groups.reduce((s, g) => s + g.total, 0) + parts.reduce((s, p) => s + p.total, 0);
  const groupCount = groups.length + parts.reduce((s, p) => s + p.groupCount, 0);
  return { key, name, groups, parts, machineCount, total, groupCount };
}

/**
 * The grouping with only the machines `match` keeps (the state filter and the search), every count but `total` taken over
 * them, and a group or factory left with none dropped. The same object when nothing is filtered.
 */
export function narrowGrouping(grouping: MachineGrouping, match: ((b: FactoryBuilding) => boolean) | null): MachineGrouping {
  if (match === null) return grouping;
  const narrowGroups = (groups: readonly MachineGroup[]) =>
    groups.flatMap((g) => {
      const buildings = g.buildings.filter(match);
      return buildings.length === 0 ? [] : [{ ...g, buildings }];
    });
  const narrowFactory = (f: MachineFactory): MachineFactory[] => {
    const groups = narrowGroups(f.groups);
    const parts = f.parts.flatMap(narrowFactory);
    if (groups.length === 0 && parts.length === 0) return [];
    const section = factorySection(f.key, f.name, groups, parts);
    // The default open state reads the whole factory, not what the filter left: a filter never folds or unfolds one by count.
    return [{ ...section, total: f.total, groupCount: f.groupCount }];
  };
  return {
    factories: grouping.factories.flatMap(narrowFactory),
    groups: narrowGroups(grouping.groups),
    other: grouping.other.filter(match),
    otherTotal: grouping.otherTotal,
  };
}

/**
 * ADR-0064: a group's row in the folded table, "4× Smelter": its count and its building (a Planner group is one building
 * and one recipe; the recipe has its own column). `count` is what the row lists (the filter's narrowed count).
 */
export function groupTitle(group: Pick<MachineGroup, "buildings">, count = group.buildings.length): string {
  const name = group.buildings[0]?.name ?? "";
  return count > 1 ? `${count}× ${name}` : name;
}

/**
 * ADR-0064: a group's rates as one row, per item in first-seen order: current and max added over its machines, the percent
 * that of the sums (0 when nothing can be made). The unit is the first machine's for that item (one item, one unit).
 * `pick` reads a machine's outputs or inputs; a machine without the list (an older backend's inputs) adds nothing.
 */
export function sumRates(buildings: readonly FactoryBuilding[], pick: (b: FactoryBuilding) => readonly ProductionRate[] | undefined): ProductionRate[] {
  // Class names come from the game server: a Map.
  const byItem = new Map<string, ProductionRate>();
  for (const b of buildings) {
    for (const rate of pick(b) ?? []) {
      const seen = byItem.get(rate.className);
      byItem.set(
        rate.className,
        seen === undefined
          ? { ...rate }
          : { ...seen, currentPerMinute: seen.currentPerMinute + rate.currentPerMinute, maxPerMinute: seen.maxPerMinute + rate.maxPerMinute },
      );
    }
  }
  return [...byItem.values()].map((r) => ({ ...r, percent: r.maxPerMinute > 0 ? (r.currentPerMinute / r.maxPerMinute) * 100 : 0 }));
}

/** One state the group's row counts: its view (word and tone), the backend's state string, and how many machines are in it. */
export interface StateCount {
  state: string;
  view: MachineStateView;
  count: number;
}

/**
 * A machine's states worth a word (ADR-0064: normal says nothing): its backend state and any flag the state doesn't already
 * say (backed up, paused), minus "producing" and any state this frontend doesn't know (`machineState`).
 */
export function notableStates(b: FactoryBuilding): { state: string; view: MachineStateView }[] {
  const states = [
    b.state,
    b.isBackedUp && b.state !== "backedUp" ? "backedUp" : undefined,
    b.isPaused && b.state !== "paused" ? "paused" : undefined,
  ];
  return states.flatMap((state) => {
    const view = machineState(state);
    return state === undefined || state === "producing" || view === null ? [] : [{ state, view }];
  });
}

/** A group's row's State column (ADR-0064): how many of its machines are in each state worth a word, in first-seen order. */
export function stateCounts(buildings: readonly FactoryBuilding[]): StateCount[] {
  const byState = new Map<string, StateCount>();
  for (const b of buildings) {
    for (const { state, view } of notableStates(b)) {
      const seen = byState.get(state);
      byState.set(state, seen === undefined ? { state, view, count: 1 } : { ...seen, count: seen.count + 1 });
    }
  }
  return [...byState.values()];
}

/** A section's backed-up machines, for its counts. */
export function backedUpIn(f: MachineFactory | MachineGroup): number {
  if ("buildings" in f) return f.buildings.filter(isBackedUpState).length;
  return f.groups.reduce((s, g) => s + backedUpIn(g), 0) + f.parts.reduce((s, p) => s + backedUpIn(p), 0);
}
