import type { Bottleneck, PlannerEdge, PlannerNode, PlannerRate, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { sectionNotes } from "../factory/bottlenecks";
import { machineState } from "../factory/machineState";
import { formatPerMinute, formatRate } from "../format";

/** The Factory page's Bottlenecks section: a finding has no anchor of its own, so the link goes to the section. */
export const BOTTLENECKS_LINK = "/app/factory#bottlenecks-heading";

/**
 * "6 Producing, 2 Underfed": a state's label from the machine states the Factory page knows; a state this build
 * doesn't know keeps the backend's own word (shown as text). Zero counts are left out.
 */
export function stateCountsText(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${machineState(state)?.label ?? state}`);
  return parts.length > 0 ? parts.join(", ") : "No machine states";
}

/** One product as "Iron Plate: 72 / 160 items/min" (actual over max, ADR-0015 unit when the backend sent one). */
export function outputLine(rate: PlannerRate): string {
  return `${rate.name}: ${formatRate(rate.currentPerMinute, rate.maxPerMinute, rate.unit)}`;
}

/** A group as a player names it: "8× Constructor, Iron Plate" (a single machine has no count). */
export function groupLabel(node: Pick<PlannerNode, "name" | "count" | "recipe">): string {
  const name = node.count > 1 ? `${node.count}× ${node.name}` : node.name;
  return node.recipe ? `${name}, ${node.recipe}` : name;
}

const edgeUnit = (kind: PlannerEdge["kind"]) => (kind === "pipe" ? "m3/min" : "items/min");

/**
 * An edge's rate in the words of ADR-0050 Decision 2: measured plain, estimated with "about", unknown with no number.
 * A pipe carries m³/min and a belt (or lift) items/min; the edge has no unit field of its own.
 */
export function edgeRateText(edge: Pick<PlannerEdge, "kind" | "rate" | "ratePerMinute">): string {
  if (edge.rate === "unknown" || edge.ratePerMinute === null) return "unknown";
  const text = formatPerMinute(edge.ratePerMinute, edgeUnit(edge.kind));
  return edge.rate === "estimated" ? `about ${text}` : text;
}

/** The edge's item: its name, "Item not inferred" when the backend could not tell, and a mixed belt says so. */
export function edgeItemText(edge: Pick<PlannerEdge, "itemName" | "itemClassName" | "mixed">): string {
  const item = edge.itemName ?? edge.itemClassName ?? "Item not inferred";
  return edge.mixed ? `${item} (mixed belt)` : item;
}

/** The edge's capacity (an unbranched chain's slowest tier), or null. */
export function edgeCapacityText(edge: Pick<PlannerEdge, "kind" | "capacityPerMinute">): string | null {
  return edge.capacityPerMinute === null ? null : formatPerMinute(edge.capacityPerMinute, edgeUnit(edge.kind));
}

/** The nodes a site lists, in the order it lists them; a key no node answers to is skipped. */
export function siteNodes(graph: ProductionGraph, site: PlannerSite): PlannerNode[] {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  return site.nodeKeys.flatMap((key) => byKey.get(key) ?? []);
}

/** The edges that touch the site's nodes. */
export function siteEdges(graph: ProductionGraph, nodes: PlannerNode[]): PlannerEdge[] {
  const keys = new Set(nodes.map((n) => n.key));
  return graph.edges.filter((e) => keys.has(e.from) || keys.has(e.to));
}

/**
 * The findings that touch a set of machines: joined by building id, as ADR-0050 Decision 4 says, with no contract change.
 * A finding is one root cause: it matches by its representative machine or any machine it lists as affected.
 */
export function findingsFor(machineIds: Iterable<string>, findings: readonly Bottleneck[] | undefined): Bottleneck[] {
  if (findings === undefined) return [];
  const ids = new Set(machineIds);
  return findings.filter((f) => ids.has(f.buildingId) || (f.affected ?? []).some((m) => ids.has(m.buildingId)));
}

export const nodeFindings = (node: PlannerNode, findings: readonly Bottleneck[] | undefined) =>
  findingsFor(node.machineIds, findings);

export function siteFindings(nodes: PlannerNode[], findings: readonly Bottleneck[] | undefined): Bottleneck[] {
  return findingsFor(
    nodes.flatMap((n) => n.machineIds),
    findings,
  );
}

/** "2 bottlenecks" / "1 bottleneck" / "No bottlenecks". */
export function bottleneckCountText(count: number): string {
  return count === 0 ? "No bottlenecks" : `${count} ${count === 1 ? "bottleneck" : "bottlenecks"}`;
}

/** "3 machines are on no conveyor the last read knew of, so they are in no group." */
export function unconnectedText(count: number): string | null {
  if (count === 0) return null;
  const [be, pronoun] = count === 1 ? ["machine is", "it is"] : ["machines are", "they are"];
  return `${count} ${be} on no conveyor the last read knew of, so ${pronoun} in no group.`;
}

/** The page's notes: the unconnected machines, then the finder's wording per `beltData` mode (shared with the Factory page). */
export function plannerNotes(data: ProductionGraph): string[] {
  const notes = sectionNotes(data);
  const gap = unconnectedText(data.unconnectedMachineIds.length);
  return gap === null ? notes : [gap, ...notes];
}

/** A machine total across a graph's sites, for the summary line. */
export const totalMachines = (sites: readonly PlannerSite[]) => sites.reduce((sum, s) => sum + s.machineCount, 0);
