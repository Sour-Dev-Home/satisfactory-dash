import { ownValue } from "@satisfactory-dash/shared";
import type {
  Bottleneck,
  PlannerEdge,
  PlannerFactory,
  PlannerNode,
  PlannerRate,
  PlannerSite,
  ProductionGraph,
} from "@satisfactory-dash/shared";
import { sectionNotes } from "../factory/bottlenecks";
import { machineState } from "../factory/machineState";
import { formatPerMinute, formatRate } from "../format";
import type { AggregateFlow, Bubble, BubbleEntry, ConnectionRow, FactoryModel, Remote, ShareSplit } from "./graph/hierarchy";

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
  return rateText(edge.rate, edge.ratePerMinute, edgeUnit(edge.kind));
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

// ---------------------------------------------------------------------------------------------------------------------
// ADR-0053 / ADR-0055: flows, destinations, transports, factories. Every value from the backend is a plain string with
// known values; an unknown one is shown as the backend's own word, as text, never dropped.
// ---------------------------------------------------------------------------------------------------------------------

type PerMinuteUnit = "items/min" | "m3/min";

/** A rate in the words of ADR-0050 Decision 2: measured plain, estimated with "about", unknown with no number. */
export function rateText(rate: "measured" | "estimated" | "unknown", ratePerMinute: number | null, unit: PerMinuteUnit): string {
  if (rate === "unknown" || ratePerMinute === null) return "unknown";
  const text = formatPerMinute(ratePerMinute, unit);
  return rate === "estimated" ? `about ${text}` : text;
}

/** A summed flow between cards (ADR-0053 Decision 3): "at least" when some part had no number. */
export function aggregateRateText(flow: Pick<AggregateFlow, "quality" | "ratePerMinute" | "unit">): string {
  if (flow.quality === "unknown" || flow.ratePerMinute === null) return "unknown";
  const text = formatPerMinute(flow.ratePerMinute, flow.unit);
  return flow.quality === "estimated" ? `about ${text}` : flow.quality === "atLeast" ? `at least ${text}` : text;
}

const ENDS_ONWARD: ReadonlySet<string> = new Set(["factory", "machine"]);
const DESTINATION_PHRASE: Record<string, string> = {
  storage: "storage",
  depot: "the Dimensional Depot",
  sink: "the AWESOME Sink",
  power: "power",
  export: "a station whose route is not read",
  unknown: "an unknown end",
};

/** Where a flow ends, in words ("the AWESOME Sink"); null when it goes on to another machine group or does not say. */
export function destinationPhrase(destination: string | undefined): string | null {
  if (destination === undefined || ENDS_ONWARD.has(destination)) return null;
  return ownValue(DESTINATION_PHRASE, destination) ?? destination;
}

/** "Supply", "Excess to the AWESOME Sink", "Output to storage" (ADR-0053 Decision 1, ADR-0055 Decision 3). */
export function flowText(flow: string, destination: string | undefined): string {
  const where = destinationPhrase(destination);
  if (flow === "supply") return "Supply";
  const word = flow === "excess" ? "Excess" : flow === "output" ? "Output" : flow;
  return where === null ? word : `${word} to ${where}`;
}

const MODE_WORD: Record<string, string> = { train: "Train", truck: "Truck", drone: "Drone", depot: "Depot" };
const CARRIER_PLURAL: Record<string, string> = { train: "trains", truck: "trucks", drone: "drones" };

/** "Belt", "Pipe", or a transport's mode ("Train"); an unknown mode keeps the backend's word. */
export function carrierWord(carrier: string): string {
  if (carrier === "belt") return "Belt";
  if (carrier === "pipe") return "Pipe";
  return ownValue(MODE_WORD, carrier) ?? carrier;
}

/** "Belt", or "Train: Ore Run (2 trains)" for a transport; the route name is game text. */
export function carrierText(row: Pick<ConnectionRow, "carrier" | "routeName" | "carriers">): string {
  const word = carrierWord(row.carrier);
  const route = row.routeName !== null && row.routeName !== "" ? `: ${row.routeName}` : "";
  const plural = ownValue(CARRIER_PLURAL, row.carrier);
  const n = row.carriers !== null && row.carriers > 1 && plural !== undefined ? ` (${row.carriers} ${plural})` : "";
  return `${word}${route}${n}`;
}

const ITEM_FROM: Record<string, string> = {
  recipe: "inferred from the recipes at both ends",
  resourceNode: "inferred from the resource node",
  upstream: "inferred from what feeds it",
  downstream: "inferred from what it feeds",
};

/** How an inferred item was found, or null for one the data named (ADR-0053 Decision 4). */
export const itemFromText = (itemFrom: string | undefined): string | null =>
  itemFrom === undefined ? null : (ownValue(ITEM_FROM, itemFrom) ?? `inferred (${itemFrom})`);

const ROLE_WORD: Record<string, string> = {
  buffer: "Buffer",
  storage: "Storage",
  depot: "Dimensional Depot",
  sink: "AWESOME Sink",
  power: "Power",
  export: "Station, route not read",
};

/** A node's role word (ADR-0055 Decision 9); null when it has none. */
export const roleText = (role: string | undefined): string | null => (role === undefined ? null : (ownValue(ROLE_WORD, role) ?? role));

/** "Iron Plate factory (+ Iron Rod)": the side products a small factory folded in (ADR-0055 Decision 4, step 6). */
export const factoryTitle = (factory: Pick<PlannerFactory, "name" | "sideProducts">): string =>
  factory.sideProducts.length > 0 ? `${factory.name} (+ ${factory.sideProducts.join(", ")})` : factory.name;

/** "Main base + 1 remote": where the factory stands (ADR-0055 Decision 6). */
export function factorySitesText(model: Pick<FactoryModel, "home" | "remoteSites">): string {
  if (model.home === null) return "No site listed";
  const n = model.remoteSites.length;
  return n === 0 ? model.home.name : `${model.home.name} + ${n} remote`;
}

const CHIP_WORD: Record<string, string> = {
  storage: "to storage",
  depot: "to the Depot",
  sink: "to the Sink",
  power: "to power",
  export: "leaving by station",
  unknown: "to unknown ends",
};

/** A chip for where a factory's flows end: "to storage: 3". */
export const destinationChipText = (destination: string, count: number): string =>
  `${ownValue(CHIP_WORD, destination) ?? `to ${destination}`}: ${count}`;

/** "850 m" under a kilometre, else "1.8 km". */
export function distanceText(metres: number): string {
  const whole = Math.round(metres);
  return whole < 1000 ? `${whole} m` : `${(Math.round(metres / 100) / 10).toLocaleString("en")} km`;
}

/** "Ore farm, 1.8 km, by train": a remote group's place, distance and the transport that joins its site. */
export function remoteText(remote: Remote): string {
  const parts = [remote.siteName];
  if (remote.distanceM !== null) parts.push(distanceText(remote.distanceM));
  if (remote.modes.length > 0) parts.push(`by ${remote.modes.map((m) => (ownValue(MODE_WORD, m) ?? m).toLowerCase()).join(" and ")}`);
  return parts.join(", ");
}

/** "75% here, 25% Computer factory, 3% other" (ADR-0055 Decision 6); a share of a factory not listed says "another factory". */
export function shareText(split: ShareSplit, nameOf: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  if (split.here !== null) parts.push(`${split.here}% here`);
  for (const other of split.others) parts.push(`${other.percent}% ${nameOf.get(other.factoryKey) ?? "another factory"}`);
  if (split.rest > 0) parts.push(`${split.rest}% other`);
  return parts.join(", ");
}

/** A folded entry's label: "3 more Iron Ingot trees". */
export function foldText(entry: Extract<BubbleEntry, { type: "fold" }>): string {
  const first = entry.bubbles[0].nodes[0];
  const n = entry.bubbles.length;
  return `${n} more ${first.recipe ?? first.name} ${n === 1 ? "tree" : "trees"}`;
}

/** "3× Constructor, Iron Plate, tree 2 of 3": a bubble's heading; a recipe with one tree has no ordinal. */
export function bubbleTitle(bubble: Pick<Bubble, "nodes" | "ordinal" | "of" | "machineCount">): string {
  const first = bubble.nodes[0];
  const what = first.recipe ?? first.resource?.name ?? null;
  const tree = bubble.of > 1 ? `, tree ${bubble.ordinal} of ${bubble.of}` : "";
  return `${bubble.machineCount}× ${first.name}${what === null ? "" : `, ${what}`}${tree}`;
}
