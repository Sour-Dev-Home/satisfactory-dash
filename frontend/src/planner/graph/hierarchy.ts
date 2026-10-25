import type {
  PlannerEdge,
  PlannerFactory,
  PlannerNode,
  PlannerRate,
  PlannerSite,
  PlannerTransport,
  ProductionGraph,
} from "@satisfactory-dash/shared";

/**
 * The planner's hierarchy, pure (ADR-0055 Decisions 4 and 6, ADR-0053 Decision 3): factories over groups, groups folded
 * into bubbles (one recipe from one source tree), and the flows between cards summed with their quality kept honest.
 * No React, no layout: the text form reads it today and the canvas will tomorrow. Everything is deterministic in the
 * order the backend sent; a key no node answers to is skipped, never guessed at.
 */

/** ADR-0053 Decision 3's fold cap: a recipe with more than this many trees shows `FOLD_KEEP` and one "N more" entry. */
export const FOLD_AT = 6;
export const FOLD_KEEP = 5;

/** Factories are the first level only when the backend sent some; an older backend (or none found) falls back to sites. */
export const hasFactories = (graph: ProductionGraph): boolean => (graph.factories?.length ?? 0) > 0;

// ---------------------------------------------------------------------------------------------------------------------
// Bubbles: recipe x source tree
// ---------------------------------------------------------------------------------------------------------------------

/** The things two groups must share to be "the same recipe": class, recipe and, for an extractor, the item it mines. */
function familyOf(node: PlannerNode): string {
  const item = node.kind === "machines" ? "" : (node.resource?.className ?? node.products[0]?.className ?? "");
  return [node.kind, node.className, node.recipe ?? "", item].join("|");
}

export interface Bubble {
  /** `treeKey` from the backend; without it a key built from the site and the recipe (valid for one response). */
  key: string;
  family: string;
  nodes: PlannerNode[];
  machineCount: number;
  /** Summed over the bubble's groups (they all make the same thing). */
  products: PlannerRate[];
  /** 1-based among the trees of the same recipe, largest first; `of` is how many there are. */
  ordinal: number;
  of: number;
}

function sumProducts(nodes: readonly PlannerNode[]): PlannerRate[] {
  const byClass = new Map<string, PlannerRate>();
  for (const node of nodes) {
    for (const rate of node.products) {
      const seen = byClass.get(rate.className);
      if (seen === undefined) byClass.set(rate.className, { ...rate });
      else {
        seen.currentPerMinute += rate.currentPerMinute;
        seen.maxPerMinute += rate.maxPerMinute;
      }
    }
  }
  return [...byClass.values()];
}

/**
 * Bubbles from `treeKey`. A group without one is grouped by (site, kind, class, recipe, mined item), ADR-0053's fallback
 * for an older backend. Order is the order the first group of each bubble appears in.
 */
export function bubblesOf(nodes: readonly PlannerNode[]): Bubble[] {
  const groups = new Map<string, PlannerNode[]>();
  for (const node of nodes) {
    const key = node.treeKey ?? `bubble|${node.siteKey}|${familyOf(node)}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [node]);
    else list.push(node);
  }
  const bubbles: Bubble[] = [...groups].map(([key, members]) => ({
    key,
    family: familyOf(members[0]),
    nodes: members,
    machineCount: members.reduce((sum, n) => sum + n.count, 0),
    products: sumProducts(members),
    ordinal: 1,
    of: 1,
  }));
  const byFamily = new Map<string, Bubble[]>();
  for (const bubble of bubbles) {
    const list = byFamily.get(bubble.family);
    if (list === undefined) byFamily.set(bubble.family, [bubble]);
    else list.push(bubble);
  }
  for (const list of byFamily.values()) {
    const bySize = [...list].sort((a, b) => b.machineCount - a.machineCount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    bySize.forEach((bubble, i) => {
      bubble.ordinal = i + 1;
      bubble.of = bySize.length;
    });
  }
  return bubbles;
}

export type BubbleEntry =
  | { type: "bubble"; bubble: Bubble }
  /** The trees beyond the cap, folded into one entry that expands into them. */
  | { type: "fold"; key: string; bubbles: Bubble[] };

/**
 * Applies the fold cap: of a recipe with more than `at` trees the `keep` largest stay, the rest become one "fold" entry in
 * the place of the first folded tree. Other recipes are untouched.
 */
export function foldBubbles(bubbles: readonly Bubble[], at = FOLD_AT, keep = FOLD_KEEP): BubbleEntry[] {
  const folded = new Map<string, Bubble[]>();
  for (const bubble of bubbles) {
    if (bubble.of > at && bubble.ordinal > keep) {
      const list = folded.get(bubble.family);
      if (list === undefined) folded.set(bubble.family, [bubble]);
      else list.push(bubble);
    }
  }
  const entries: BubbleEntry[] = [];
  const placed = new Set<string>();
  for (const bubble of bubbles) {
    const rest = folded.get(bubble.family);
    if (rest === undefined || bubble.ordinal <= keep) {
      entries.push({ type: "bubble", bubble });
    } else if (!placed.has(bubble.family)) {
      placed.add(bubble.family);
      entries.push({ type: "fold", key: `fold|${bubble.family}`, bubbles: [...rest].sort((a, b) => a.ordinal - b.ordinal) });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------------------------------
// Flows between cards, quality kept honest
// ---------------------------------------------------------------------------------------------------------------------

/** One belt, pipe or transport as the aggregation sees it. */
export interface FlowPart {
  from: string;
  to: string;
  itemClassName: string | null;
  itemName: string | null;
  ratePerMinute: number | null;
  rate: "measured" | "estimated" | "unknown";
  mixed: boolean;
  /** `belt`, `pipe` or a transport mode (`train`, ...). */
  carrier: string;
  flow: string;
  unit: "items/min" | "m3/min";
}

export type FlowQuality = "measured" | "estimated" | "atLeast" | "unknown";

export interface AggregateFlow {
  from: string;
  to: string;
  itemClassName: string | null;
  itemName: string | null;
  carrier: string;
  flow: string;
  unit: "items/min" | "m3/min";
  mixed: boolean;
  parts: number;
  ratePerMinute: number | null;
  quality: FlowQuality;
}

const edgePart = (e: PlannerEdge): FlowPart => ({
  from: e.from,
  to: e.to,
  itemClassName: e.itemClassName,
  itemName: e.itemName,
  ratePerMinute: e.ratePerMinute,
  rate: e.rate,
  mixed: e.mixed,
  carrier: e.kind,
  flow: e.flow ?? "supply",
  unit: e.kind === "pipe" ? "m3/min" : "items/min",
});

const transportPart = (t: PlannerTransport): FlowPart => ({
  from: t.from,
  to: t.to,
  itemClassName: t.itemClassName,
  itemName: t.itemName,
  ratePerMinute: t.ratePerMinute,
  rate: t.rate,
  mixed: false,
  carrier: t.mode,
  flow: t.flow ?? "supply",
  unit: "items/min",
});

/** Every belt, pipe and transport of the graph as one list of parts (edges first, in the backend's order). */
export const flowParts = (graph: ProductionGraph): FlowPart[] => [...graph.edges.map(edgePart), ...(graph.transports ?? []).map(transportPart)];

const SEP = "\u0001";

/**
 * ADR-0053 Decision 3, "Edges at each level": the parts summed by (from card, to card, item, carrier, flow). Quality is
 * the weakest part: all measured is measured; any part with a number gives "about" the sum of the known parts, or "at
 * least" when some part is unknown; none known gives no number. A part inside one card is internal and dropped, and so is
 * one whose end belongs to no card. Output is sorted, so it is the same whatever order the parts came in.
 */
export function aggregateFlows(parts: readonly FlowPart[], cardOf: (nodeKey: string) => string | undefined): AggregateFlow[] {
  const groups = new Map<string, { head: FlowPart; from: string; to: string; list: FlowPart[] }>();
  for (const part of parts) {
    const from = cardOf(part.from);
    const to = cardOf(part.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = [from, to, part.itemClassName ?? "", part.carrier, part.flow, part.unit].join(SEP);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { head: part, from, to, list: [part] });
    else group.list.push(part);
  }
  const flows = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { head, from, to, list }]): AggregateFlow => {
      const known = list.filter((p) => p.ratePerMinute !== null && p.rate !== "unknown");
      const sum = known.reduce((total, p) => total + (p.ratePerMinute ?? 0), 0);
      const quality: FlowQuality =
        known.length === 0
          ? "unknown"
          : known.length < list.length
            ? "atLeast"
            : list.every((p) => p.rate === "measured")
              ? "measured"
              : "estimated";
      return {
        from,
        to,
        itemClassName: head.itemClassName,
        itemName: list.find((p) => p.itemName !== null)?.itemName ?? head.itemName,
        carrier: head.carrier,
        flow: head.flow,
        unit: head.unit,
        mixed: list.some((p) => p.mixed),
        parts: list.length,
        ratePerMinute: known.length === 0 ? null : sum,
        quality,
      };
    });
  return flows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Connection rows: edges and transports in one table
// ---------------------------------------------------------------------------------------------------------------------

export interface ConnectionRow {
  key: string;
  from: string;
  to: string;
  itemClassName: string | null;
  itemName: string | null;
  mixed: boolean;
  itemFrom: string | undefined;
  ratePerMinute: number | null;
  rate: "measured" | "estimated" | "unknown";
  unit: "items/min" | "m3/min";
  capacityPerMinute: number | null;
  /** `belt`, `pipe` or a transport mode. */
  carrier: string;
  /** Transports only. */
  carriers: number | null;
  routeName: string | null;
  flow: string;
  destination: string | undefined;
}

/** The belts, pipes and transports with an end in `nodeKeys`, edges first, each in the backend's order. */
export function connectionRows(graph: ProductionGraph, nodeKeys: ReadonlySet<string>): ConnectionRow[] {
  const touches = (x: { from: string; to: string }) => nodeKeys.has(x.from) || nodeKeys.has(x.to);
  const belts = graph.edges.filter(touches).map(
    (e): ConnectionRow => ({
      key: [e.from, e.to, e.itemClassName ?? "", e.kind, e.flow ?? "supply"].join(SEP),
      from: e.from,
      to: e.to,
      itemClassName: e.itemClassName,
      itemName: e.itemName,
      mixed: e.mixed,
      itemFrom: e.itemFrom,
      ratePerMinute: e.ratePerMinute,
      rate: e.rate,
      unit: e.kind === "pipe" ? "m3/min" : "items/min",
      capacityPerMinute: e.capacityPerMinute,
      carrier: e.kind,
      carriers: null,
      routeName: null,
      flow: e.flow ?? "supply",
      destination: e.destination,
    }),
  );
  const routes = (graph.transports ?? []).filter(touches).map(
    (t): ConnectionRow => ({
      key: [t.from, t.to, t.itemClassName ?? "", t.mode, t.flow ?? "supply", t.routeName ?? ""].join(SEP),
      from: t.from,
      to: t.to,
      itemClassName: t.itemClassName,
      itemName: t.itemName,
      mixed: false,
      itemFrom: t.itemFrom,
      ratePerMinute: t.ratePerMinute,
      rate: t.rate,
      unit: "items/min",
      capacityPerMinute: null,
      carrier: t.mode,
      carriers: t.carriers,
      routeName: t.routeName,
      flow: t.flow ?? "supply",
      destination: t.destination,
    }),
  );
  return [...belts, ...routes];
}

// ---------------------------------------------------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------------------------------------------------

/** Destinations that are not "the line goes on": a factory's chips count the flows that end in these. */
const ONWARD_DESTINATIONS: ReadonlySet<string> = new Set(["factory", "machine"]);
const DESTINATION_ORDER = ["storage", "depot", "sink", "power", "export", "unknown"];

export interface FactoryModel {
  factory: PlannerFactory;
  /** The factory's groups in its own order; a key no node answers to is skipped. */
  nodes: PlannerNode[];
  /** The site holding most of its machines. */
  home: PlannerSite | null;
  /** The other sites it spans, the larger first. */
  remoteSites: PlannerSite[];
  stateCounts: Record<string, number>;
  /** Flows leaving the factory to somewhere that is not another machine group, by destination. */
  destinations: { destination: string; count: number }[];
  sharedNodes: PlannerNode[];
}

function homeSite(nodes: readonly PlannerNode[], sites: readonly PlannerSite[], siteKeys: readonly string[]): PlannerSite | null {
  const known = new Map(sites.map((s) => [s.key, s]));
  const machines = new Map<string, number>();
  for (const node of nodes) machines.set(node.siteKey, (machines.get(node.siteKey) ?? 0) + node.count);
  let best: PlannerSite | null = null;
  let bestCount = -1;
  // Ties go to the earlier of the factory's own site list, then to the earlier site of the graph.
  const order = [...siteKeys, ...sites.map((s) => s.key)];
  for (const key of order) {
    const site = known.get(key);
    const count = machines.get(key) ?? 0;
    if (site !== undefined && count > bestCount) {
      best = site;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

/** The factories the backend sent, each with its groups and where it stands. Empty when it sent none. */
export function factoryModels(graph: ProductionGraph): FactoryModel[] {
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const siteByKey = new Map(graph.sites.map((s) => [s.key, s]));
  const outgoing = [...graph.edges, ...(graph.transports ?? [])];
  return (graph.factories ?? []).map((factory) => {
    const nodes = factory.nodeKeys.flatMap((key) => byKey.get(key) ?? []);
    const inFactory = new Set(nodes.map((n) => n.key));
    const home = homeSite(nodes, graph.sites, factory.siteKeys);
    const machinesAt = new Map<string, number>();
    for (const n of nodes) machinesAt.set(n.siteKey, (machinesAt.get(n.siteKey) ?? 0) + n.count);
    const remoteSites = factory.siteKeys
      .filter((key) => key !== home?.key)
      .flatMap((key) => siteByKey.get(key) ?? [])
      .sort((a, b) => (machinesAt.get(b.key) ?? 0) - (machinesAt.get(a.key) ?? 0));
    const stateCounts: Record<string, number> = {};
    for (const n of nodes) for (const [state, count] of Object.entries(n.stateCounts)) stateCounts[state] = (stateCounts[state] ?? 0) + count;
    const ends = new Map<string, number>();
    for (const x of outgoing) {
      if (!inFactory.has(x.from) || x.destination === undefined || ONWARD_DESTINATIONS.has(x.destination)) continue;
      ends.set(x.destination, (ends.get(x.destination) ?? 0) + 1);
    }
    const rank = (d: string) => {
      const i = DESTINATION_ORDER.indexOf(d);
      return i < 0 ? DESTINATION_ORDER.length : i;
    };
    const destinations = [...ends]
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => rank(a.destination) - rank(b.destination) || (a.destination < b.destination ? -1 : 1));
    return { factory, nodes, home, remoteSites, stateCounts, destinations, sharedNodes: nodes.filter((n) => (n.shares?.length ?? 0) > 0) };
  });
}

/** Which factory each group is listed under (the factory's own list first, then the group's `factoryKey`). */
export function factoryOfNode(graph: ProductionGraph): Map<string, string> {
  const owner = new Map<string, string>();
  for (const factory of graph.factories ?? []) for (const key of factory.nodeKeys) if (!owner.has(key)) owner.set(key, factory.key);
  for (const node of graph.nodes) if (!owner.has(node.key) && node.factoryKey !== undefined) owner.set(node.key, node.factoryKey);
  return owner;
}

/** Groups that no factory claims: the contract promises none, so any is worth a line. */
export function unassignedCount(graph: ProductionGraph): number {
  const owner = factoryOfNode(graph);
  return graph.nodes.filter((n) => !owner.has(n.key)).length;
}

export interface Remote {
  siteName: string;
  /** Straight-line metres from the factory's home site to the group, or null when there is no home site. */
  distanceM: number | null;
  /** Transport modes that join this site to another one, sorted. */
  modes: string[];
}

/** For each group of the factory outside its home site: where it is, how far, and how things get from there. */
export function remoteInfo(graph: ProductionGraph, model: FactoryModel): Map<string, Remote> {
  const siteName = new Map(graph.sites.map((s) => [s.key, s.name]));
  const siteOfNode = new Map(graph.nodes.map((n) => [n.key, n.siteKey]));
  const modesAt = new Map<string, Set<string>>();
  for (const t of graph.transports ?? []) {
    const a = siteOfNode.get(t.from);
    const b = siteOfNode.get(t.to);
    if (a === undefined || b === undefined || a === b) continue;
    for (const site of [a, b]) {
      const set = modesAt.get(site);
      if (set === undefined) modesAt.set(site, new Set([t.mode]));
      else set.add(t.mode);
    }
  }
  const out = new Map<string, Remote>();
  for (const node of model.nodes) {
    if (model.home === null || node.siteKey === model.home.key) continue;
    out.set(node.key, {
      siteName: siteName.get(node.siteKey) ?? "Site not listed",
      distanceM: Math.round(Math.hypot(node.at.x - model.home.at.x, node.at.y - model.home.at.y)),
      modes: [...(modesAt.get(node.siteKey) ?? [])].sort(),
    });
  }
  return out;
}

export interface ShareSplit {
  /** Percent of the group's design output that stays in the factory it is listed under, or null when it does not say. */
  here: number | null;
  others: { factoryKey: string; percent: number }[];
  /** Percent not accounted for by the listed shares (the backend sends the top few), 0 when it all adds up. */
  rest: number;
}

/** A shared group's split, in whole percents, the largest other share first; null for a group with no shares. */
export function shareSplit(node: Pick<PlannerNode, "shares" | "factoryKey">): ShareSplit | null {
  const shares = node.shares;
  if (shares === undefined || shares.length === 0) return null;
  const here = shares.find((s) => s.factoryKey === node.factoryKey);
  const others = shares
    .filter((s) => s !== here)
    .sort((a, b) => b.share - a.share || (a.factoryKey < b.factoryKey ? -1 : 1))
    .map((s) => ({ factoryKey: s.factoryKey, percent: Math.round(s.share * 100) }));
  const total = shares.reduce((sum, s) => sum + s.share, 0);
  const rest = Math.round(Math.max(0, 1 - total) * 100);
  return { here: here === undefined ? null : Math.round(here.share * 100), others, rest };
}

/** A factory as a site, for the existing canvas, which draws one site's groups (the factory canvas is the next PR). */
export function factoryAsSite(model: FactoryModel): PlannerSite {
  const { factory, nodes } = model;
  const machines = nodes.reduce((sum, n) => sum + n.count, 0);
  const weight = (n: PlannerNode) => n.count;
  const total = nodes.reduce((sum, n) => sum + weight(n), 0);
  const at = {
    x: total === 0 ? 0 : Math.round(nodes.reduce((sum, n) => sum + n.at.x * weight(n), 0) / total),
    y: total === 0 ? 0 : Math.round(nodes.reduce((sum, n) => sum + n.at.y * weight(n), 0) / total),
  };
  return {
    key: factory.key,
    name: factory.name,
    at,
    machineCount: factory.machineCount > 0 ? factory.machineCount : machines,
    stateCounts: model.stateCounts,
    topOutputs: factory.products.slice(0, 5),
    nodeKeys: nodes.map((n) => n.key),
  };
}
