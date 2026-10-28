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
import { formatAmount, formatPerMinute, formatRate, unitLabel } from "../format";
import type { AggregateFlow, Bubble, BubbleEntry, ConnectionRow, FactoryModel, Remote, ShareSplit } from "./graph/hierarchy";
import type { DestinationCap } from "./graph/capModel";

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

/**
 * Whether a rate prints as 0 (#728 step 2). FRM's CurrentProd "decreases if an ingredient is unavailable"
 * (docs-vault/raw-sources/frm-getFactory.md, E3), so a 0 says "0 of <max>" and the machines' state, never a bare 0.
 */
export const isZeroRate = (rate: Pick<PlannerRate, "currentPerMinute">): boolean => formatAmount(rate.currentPerMinute) === formatAmount(0);

/** Whether a rate has a maximum worth naming: a finite one that does not itself round to 0 (null or NaN from a bad payload has none). */
export const hasMax = (rate: Pick<PlannerRate, "maxPerMinute">): boolean => Number.isFinite(rate.maxPerMinute) && !isZeroRate({ currentPerMinute: rate.maxPerMinute });

/** What a 0 rate says when there are no machine states to name. */
export const NOT_PRODUCING = "not producing";

/** Several groups' state counts summed (a bubble's), keyed safely: the states are the backend's strings. */
export function mergeStateCounts(list: readonly Record<string, number>[]): Record<string, number> {
  const merged = Object.create(null) as Record<string, number>;
  for (const counts of list) for (const [state, n] of Object.entries(counts)) merged[state] = (merged[state] ?? 0) + n;
  return merged;
}

/**
 * The state of a group whose rate reads 0, lower case for "· backed up": the one state all its machines are in ("backed
 * up", "underfed", "paused", a state this build doesn't know as the backend's word), else "not producing".
 */
export function stalledStateText(counts: Record<string, number>): string {
  const state = soleStalledState(counts);
  if (state === undefined) return NOT_PRODUCING;
  return machineState(state)?.label.toLowerCase() ?? state;
}

/** The one state all of a group's machines are in, unless that is "producing"; undefined when they differ or none is counted. */
function soleStalledState(counts: Record<string, number>): string | undefined {
  const present = Object.entries(counts).filter(([, n]) => n > 0);
  if (present.length !== 1 || present[0][0] === "producing") return undefined;
  return present[0][0];
}

/** The stalled states the canvas draws a `StateMark` for (ADR-0062 Decision 2): machine states (`machineState.ts`) by key. */
export type StalledKind = "backedUp" | "underfed" | "paused" | "idle";

const STALLED_KINDS: ReadonlySet<string> = new Set<StalledKind>(["backedUp", "underfed", "paused", "idle"]);

const isStalledKind = (state: string): state is StalledKind => STALLED_KINDS.has(state);

/**
 * The mark for a group whose rate reads 0 (the caller checks the rate, as for `stalledStateText`): the state all its machines
 * share when it has a mark, else undefined. Undefined is exactly where the words have no mark: "not producing" (mixed, none
 * counted or all producing), "unpowered", and a state this build doesn't know; the word is drawn as before there.
 */
export function stalledOf(counts: Record<string, number>): StalledKind | undefined {
  const state = soleStalledState(counts);
  return state !== undefined && isStalledKind(state) ? state : undefined;
}

/** A rate that reads 0 as "0 of 30 items/min", or "0 items/min" when the max is 0 too. */
const zeroRateText = (rate: Pick<PlannerRate, "maxPerMinute" | "unit">): string =>
  hasMax(rate) ? `${formatAmount(0)} of ${formatAmount(rate.maxPerMinute)} ${unitLabel(rate.unit)}` : `${formatAmount(0)} ${unitLabel(rate.unit)}`;

/**
 * One product as "Iron Plate: 72 / 160 items/min" (actual over max, ADR-0015 unit when the backend sent one). A 0 reads
 * "Iron Ingot: 0 of 30 items/min · backed up": the state from `stateCounts` when given (a single machine's line, whose
 * state is printed beside it, passes none).
 */
export function outputLine(
  rate: Pick<PlannerRate, "name" | "currentPerMinute" | "maxPerMinute" | "unit">,
  stateCounts?: Record<string, number>,
  /** ADR-0061 Decision 2: a parent's net rate whose internal flows were estimated or unknown is a floor. */
  atLeast = false,
): string {
  if (!isZeroRate(rate)) return `${rate.name}: ${atLeast ? "at least " : ""}${formatRate(rate.currentPerMinute, rate.maxPerMinute, rate.unit)}`;
  const state = stateCounts === undefined ? "" : ` · ${stalledStateText(stateCounts)}`;
  return `${rate.name}: ${zeroRateText(rate)}${state}`;
}

/**
 * The step 5 sentence (#728): why a flow's item or rate can be unknown. The legend, the Tables view and an unknown
 * flow's tooltip say it in these words.
 */
export const UNKNOWN_FLOW_NOTE = "The game doesn't report what's on a belt or how fast it moves; items and rates are inferred where possible.";

/** A flow whose item or rate the data could not give: the ones `UNKNOWN_FLOW_NOTE` explains. */
export const hasUnknown = (f: { itemName: string | null; itemClassName: string | null; rate: string }): boolean =>
  (f.itemName ?? f.itemClassName ?? "") === "" || f.rate === "unknown";

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

/** "2 bottlenecks" / "1 bottleneck" / "No bottlenecks": the Factory page's own words, so its summary and the cards agree. */
export { bottleneckCountText } from "../factory/bottlenecks";

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

/** A chip for where a factory's flows end: "3 flows to storage", "1 flow to the Depot". */
export const destinationChipText = (destination: string, count: number): string =>
  `${count} ${count === 1 ? "flow" : "flows"} ${ownValue(CHIP_WORD, destination) ?? `to ${destination}`}`;

/**
 * A destination cap's words (ADR-0062 Decision 1), its `<title>` and button name, so its speed is never the only carrier
 * of the rate: "about 120 items/min to storage, 3 flows", "48 items/min to the Sink", "2 flows to power, rate unknown". A
 * unit with no number makes the others "at least"; a stalled cap says its machines' state.
 */
export function capText(cap: Pick<DestinationCap, "destination" | "count" | "rates" | "stalled">): string {
  const words = ownValue(CHIP_WORD, cap.destination) ?? `to ${cap.destination}`;
  const known = cap.rates.filter((r) => r.quality !== "unknown" && r.ratePerMinute !== null);
  const partial = known.length < cap.rates.length;
  const rate = known.map((r) => aggregateRateText(partial && r.quality !== "atLeast" ? { ...r, quality: "atLeast" } : r)).join(" and ");
  const head = known.length === 0 ? `${destinationChipText(cap.destination, cap.count)}, rate unknown` : `${rate} ${words}${cap.count === 1 ? "" : `, ${cap.count} flows`}`;
  return cap.stalled === undefined ? head : `${head}, not moving: ${machineState(cap.stalled)?.label.toLowerCase() ?? cap.stalled}`;
}

/** A "+k" cap's words: how many more kinds, and where (each kind's own words are in its cap and the detail). */
export function moreCapsText(more: readonly Pick<DestinationCap, "destination" | "count">[]): string {
  const total = more.reduce((sum, c) => sum + c.count, 0);
  return `${more.length} more destinations (${more.map((c) => destinationChipText(c.destination, c.count)).join(", ")}), ${total} ${total === 1 ? "flow" : "flows"}`;
}

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
