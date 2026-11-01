import type { PlannerDesignation, PlannerDesignationMatch, PlannerDesignationMember, PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { isStaleDesignation } from "../api/plannerWrites";
import { factoriesConnected, partsOf } from "./connectivity";
import { listedInPart, membersOf, type Place } from "./designationMatch";
import { MERGE_MAX, TOO_FEW_TO_MERGE, TOO_MANY_TO_MERGE, mergeRequest, type HierarchyPick } from "./designationOps";
import { NOT_CONNECTED_TEXT } from "./designationText";
import type { TreeNode } from "./factoryTree";
import type { FactoryModel } from "./graph/hierarchy";

/**
 * ADR-0055 Decision 12 (#727): what the selection bars can offer, from what the page shows. Pure; the request builders in
 * `designationOps.ts` do the rest once a name is given.
 */

export type MergeSources =
  | { ok: true; designations: PlannerDesignation[]; suggested: PlannerDesignationMember[][]; names: { name: string; machineCount: number }[] }
  | { ok: false; reason: string };

/**
 * The sources of a merge of the picked factories, or why Merge stays disabled: fewer than two or more than MERGE_MAX, not
 * one connected piece (the owner's "connected only, for now"), a read still missing, or a cap the result would pass.
 */
export function mergeSources(
  graph: ProductionGraph,
  picked: readonly FactoryModel[],
  designations: readonly PlannerDesignation[] | undefined,
  places: ReadonlyMap<string, Place> | undefined,
): MergeSources {
  if (picked.length < 2) return { ok: false, reason: TOO_FEW_TO_MERGE };
  if (picked.length > MERGE_MAX) return { ok: false, reason: TOO_MANY_TO_MERGE };
  if (!factoriesConnected(graph, picked.map((m) => m.factory.key))) return { ok: false, reason: NOT_CONNECTED_TEXT };
  const chosen: PlannerDesignation[] = [];
  const suggested: PlannerDesignationMember[][] = [];
  for (const model of picked) {
    const id = model.factory.designationId;
    if (id !== null) {
      if (designations === undefined) return { ok: false, reason: "The designated factories are still loading." };
      const d = designations.find((x) => x.id === id);
      if (d === undefined) return { ok: false, reason: `${model.factory.name} is no longer designated; select again.` };
      chosen.push(d);
    } else {
      if (places === undefined) return { ok: false, reason: "Machine positions are still loading." };
      const made = membersOf(model.nodes, places);
      if (!made.ok) return { ok: false, reason: made.reason };
      suggested.push(made.members);
    }
  }
  // The caps and the backend's revisions, checked by building the request with a stand-in name.
  const trial = mergeRequest({ designations: chosen, suggested, name: "Merged" });
  if (!trial.ok) return trial;
  return { ok: true, designations: chosen, suggested, names: picked.map((m) => ({ name: m.factory.name, machineCount: m.factory.machineCount })) };
}

export type HierarchyPicks = { ok: true; picks: HierarchyPick[] } | { ok: false; reason: string };

export const OWN_MACHINES_PICKED = "A factory's own machines move with it; pick the factory itself.";
/** ADR-0061: Merge joins machines; a factory with factories inside it is grouped or moved instead. */
export const PARENTS_DO_NOT_MERGE = "Only factories with no factories inside them merge.";

/**
 * ADR-0061 Decision 6: the picked cards of one level as Group and Move take them. A designated factory or a parent is its
 * designation as read; an automatic factory is its machines, found again in the Factory read (designated as it goes); a
 * parent's own-machines card is not a factory of its own, so it says why.
 */
export function hierarchyPicks(
  picked: readonly TreeNode[],
  designations: readonly PlannerDesignation[] | undefined,
  places: ReadonlyMap<string, Place> | undefined,
): HierarchyPicks {
  const picks: HierarchyPick[] = [];
  for (const node of picked) {
    if (node.kind === "own") return { ok: false, reason: OWN_MACHINES_PICKED };
    const id = node.designationId;
    if (id !== null) {
      if (designations === undefined) return { ok: false, reason: "The designated factories are still loading." };
      const d = designations.find((x) => x.id === id);
      if (d === undefined) return { ok: false, reason: `${node.name} is no longer designated; select again.` };
      picks.push({ designation: d });
    } else {
      if (places === undefined) return { ok: false, reason: "Machine positions are still loading." };
      const made = membersOf(node.card.nodes, places);
      if (!made.ok) return { ok: false, reason: made.reason };
      picks.push({ automatic: { name: node.name, members: made.members } });
    }
  }
  return { ok: true, picks };
}

/** The designation behind an opened factory, when this backend can split it (revisions and member-to-building ids). */
export interface SplitSource {
  designation: PlannerDesignation;
  match: PlannerDesignationMatch;
}

export function splitSourceOf(
  model: FactoryModel,
  list: { designations: PlannerDesignation[]; matches: PlannerDesignationMatch[] } | undefined,
): SplitSource | null {
  const id = model.factory.designationId;
  if (id === null || list === undefined) return null;
  const designation = list.designations.find((d) => d.id === id);
  const match = list.matches.find((m) => m.designationId === id);
  if (designation?.revision === undefined || match?.memberBuildingIds === undefined) return null;
  return { designation, match };
}

/** Runs a write and, when it answers `designation_stale`, tells the page (which drops its selection) before re-throwing. */
export async function staleAware(action: () => Promise<unknown>, onStale: () => void): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isStaleDesignation(error)) onStale();
    throw error;
  }
}

export type SplitMachines = { ok: true; machineIds: Set<string> } | { ok: false; reason: string };

/** The live machine ids of the picked groups, for intersecting with a designation's matched buildings. */
export function splitMachines(nodes: readonly PlannerNode[]): SplitMachines {
  if (nodes.length === 0) return { ok: false, reason: "Tick groups to split them into a new factory." };
  // The graph lists at most so many ids per group; a bigger group would be split in part.
  if (nodes.some(listedInPart)) return { ok: false, reason: "These groups are too large to split whole." };
  return { ok: true, machineIds: new Set(nodes.flatMap((n) => n.machineIds)) };
}

/**
 * What the split dialog says when either side would not be one connected piece. A designation stays one factory however
 * its machines are placed (the backend keys a designated factory by its id), so the words say that, not that it falls apart.
 */
export function splitPartsNote(graph: ProductionGraph, factory: FactoryModel, picked: ReadonlySet<string>): string | null {
  const rest = new Set(factory.nodes.map((n) => n.key).filter((k) => !picked.has(k)));
  const loose = partsOf(graph, picked) > 1 || partsOf(graph, rest) > 1;
  return loose ? "Not all of these machines are connected to each other by belts, pipes or transports. Each side still stays one factory." : null;
}
