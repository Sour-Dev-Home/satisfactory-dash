import { isBackedUpState, type FactoryBuilding, type PlannerDesignation, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { buildFactoryTree, type TreeNode } from "../planner/factoryTree";
import { factoryOfNode } from "../planner/graph/hierarchy";
import { OUTLINE_OPEN_MAX } from "../planner/outlineModel";
import { groupLabel } from "../planner/plannerText";

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

/** The outline's rule (ADR-0062 Decision 3): a factory of more than `OUTLINE_OPEN_MAX` groups starts closed. */
export const startsOpen = (f: Pick<MachineFactory, "groupCount">): boolean => f.groupCount <= OUTLINE_OPEN_MAX;

/** A section's backed-up machines, for its counts. */
export function backedUpIn(f: MachineFactory | MachineGroup): number {
  if ("buildings" in f) return f.buildings.filter(isBackedUpState).length;
  return f.groups.reduce((s, g) => s + backedUpIn(g), 0) + f.parts.reduce((s, p) => s + backedUpIn(p), 0);
}
