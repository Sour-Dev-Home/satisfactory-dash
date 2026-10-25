import type { PlannerEdge, PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import {
  aggregateRateText,
  bubbleTitle,
  carrierWord,
  destinationChipText,
  factorySitesText,
  factoryTitle,
  foldText,
  groupLabel,
  outputLine,
  remoteText,
  shareText,
  siteNodes,
} from "../plannerText";
import { MAX_LINE_CHARS, edgeLabel, edgeLabelLines, keepFigures, nodeBody, nodeTitle, wrapText } from "./graphModel";
import {
  aggregateFlows,
  bubblesOf,
  factoryModels,
  factoryOfNode,
  flowParts,
  foldBubbles,
  remoteInfo,
  shareSplit,
  type AggregateFlow,
  type Bubble,
  type FactoryModel,
  type FlowPart,
} from "./hierarchy";

/**
 * What the canvas draws, as data (ADR-0055 Decision 6, ADR-0053 Decision 3): cards (a factory, a bubble of one recipe from
 * one source tree, a group, or the "N more trees" fold), frames around an expanded bubble's groups, and the flows between
 * cards. Pure and deterministic: the same graph and view state give the same scene, in the same order, so the layout can
 * be remembered by `topologyHash`. No React and no dagre; the sizes and positions are `layoutSite.ts`.
 */

/** A factory opens collapsed (bubbles, not groups) above this many groups (ADR-0053 Decision 3's `COLLAPSE_AT`). */
export const COLLAPSE_AT = 30;
/** Words over this many characters in a factory card's title are cut (the full name is in its tooltip). */
export const MAX_FACTORY_TITLE_CHARS = 30;
const MAX_CHIP_LINES = 3;
const MAX_PRODUCT_LINES = 2;

export type CardKind = "factory" | "bubble" | "group" | "fold";

export interface Card {
  /** Unique in the scene: a group's key, a bubble's `treeKey`, `fold|...`, a factory's key. */
  key: string;
  kind: CardKind;
  /** The groups the card stands for. */
  nodeKeys: string[];
  title: string;
  lines: string[];
  /** How many leading `lines` are muted (the recipe, or where a factory stands). */
  mutedLines: number;
  /** The building class whose icon the card shows, when it stands for one class. */
  className: string | undefined;
  /** The card's words for the tooltip and the keyboard button (the findings count is added by the canvas). */
  label: string;
  loop: boolean;
  /** The frame the card sits in. */
  frame: string | undefined;
  /** Collapse upstream: the groups this card post-dominates, and whether they are hidden now. */
  upstream?: { count: number; collapsed: boolean } | undefined;
  /** Which bubble this card opens or collapses (a bubble card, or a group inside a frame). */
  bubbleKey: string | undefined;
}

export interface Frame {
  /** `frame|<bubble key>`: distinct from every card key. */
  key: string;
  bubbleKey: string;
  title: string;
  cardKeys: string[];
}

export interface CanvasFlow {
  from: string;
  to: string;
  itemClassName: string | null;
  itemName: string | null;
  /** `belt`, `pipe`, or a transport mode (`train`, `truck`, `drone`, `depot`; a game-server string). */
  carrier: string;
  flow: string;
  mixed: boolean;
  /** How sure the rate is, for the line style: an "at least" sum counts as an estimate. */
  rate: "measured" | "estimated" | "unknown";
  /** The label in one line (the tooltip's words), and as drawn: one to three lines. */
  label: string;
  labelLines: string[];
  routeName?: string | undefined;
}

export type SceneLevel = "overview" | "factory" | "site";

export interface Scene {
  level: SceneLevel;
  /** The factory's, site's or "Factories" name, for the accessible label. */
  name: string;
  cards: Card[];
  frames: Frame[];
  flows: CanvasFlow[];
  /** Bubbles that can be expanded or collapsed, and the folds that can be opened (for the toolbar). */
  bubbleKeys: string[];
  foldKeys: string[];
  /** Whether the factory has storage nodes the toggle would fold. */
  hasStorage: boolean;
  /** Whether a bubble is expanded unless the viewer flipped it (a factory of few groups opens, a big one starts collapsed). */
  openByDefault: boolean;
  /** The first card kind word for the accessible label: "factories", "groups" or "cards". */
  noun: string;
}

export interface FactoryView {
  /** Bubbles whose state differs from the default (open below `COLLAPSE_AT` groups, collapsed above). */
  flipped: ReadonlySet<string>;
  /** Folds ("N more trees") that were opened. */
  unfolded: ReadonlySet<string>;
  /** Cards whose upstream is hidden. */
  collapsed: ReadonlySet<string>;
  storageDetail: boolean;
}

export const EMPTY_VIEW: FactoryView = { flipped: new Set(), unfolded: new Set(), collapsed: new Set(), storageDetail: true };

const cutTo = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------------------------------------------------

/** One summed flow as the canvas draws it (ADR-0053 Decision 3: weakest quality wins; "at least" when a part is unknown). */
export function canvasFlow(f: AggregateFlow): CanvasFlow {
  const item = f.itemName ?? f.itemClassName ?? "Item unknown";
  const head = f.mixed ? `${item} · mixed` : item;
  const rateLine = f.quality === "unknown" || f.ratePerMinute === null ? null : aggregateRateText(f);
  const lines = [head, ...(rateLine === null ? [] : [rateLine]), ...(f.flow === "excess" ? ["excess"] : [])];
  return {
    from: f.from,
    to: f.to,
    itemClassName: f.itemClassName,
    itemName: f.itemName,
    carrier: f.carrier,
    flow: f.flow,
    mixed: f.mixed,
    rate: f.quality === "measured" ? "measured" : f.quality === "unknown" ? "unknown" : "estimated",
    label: [item, ...(rateLine === null ? [] : [rateLine]), ...(f.mixed ? ["mixed"] : []), ...(f.flow === "excess" ? ["excess"] : [])].join(" · "),
    labelLines: lines,
    routeName: f.routeName,
  };
}

/** One site edge, as before the factory level existed: one line per connection, labelled by the edge's own words. */
function edgeFlow(edge: PlannerEdge): CanvasFlow {
  return {
    from: edge.from,
    to: edge.to,
    itemClassName: edge.itemClassName,
    itemName: edge.itemName,
    carrier: edge.kind,
    flow: edge.flow ?? "supply",
    mixed: edge.mixed,
    rate: edge.rate,
    label: edgeLabel(edge),
    labelLines: edgeLabelLines(edge),
    routeName: undefined,
  };
}

/** How sure an edge's rate is, in the tables' words. */
export const flowSureness = (flow: Pick<CanvasFlow, "rate">): string => (flow.rate === "measured" ? "measured" : flow.rate === "estimated" ? "estimated" : "rate unknown");

/** A flow's tooltip and accessible words: "Train, route Ore Run: A to B: Iron Ore · 120 items/min (estimated)". */
export function flowTitle(flow: CanvasFlow, from: string, to: string): string {
  const by = flow.carrier === "belt" || flow.carrier === "pipe" ? "" : `${carrierWord(flow.carrier)}${flow.routeName === undefined ? "" : `, route ${flow.routeName}`}: `;
  return `${by}${from} to ${to}: ${flow.label} (${flowSureness(flow)})`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------------------------------

const blank = { upstream: undefined, frame: undefined, bubbleKey: undefined, className: undefined } as const;

/** A group as a card: the title, recipe, outputs and loop marker the site canvas always drew. */
export function groupCard(node: PlannerNode, extra: string[] = []): Card {
  const { lines, recipeLines } = nodeBody(node);
  return {
    ...blank,
    key: node.key,
    kind: "group",
    nodeKeys: [node.key],
    title: nodeTitle(node),
    lines: [...lines, ...extra],
    mutedLines: recipeLines,
    className: node.className,
    label: groupLabel(node),
    loop: node.loop === true,
  };
}

function bubbleCard(bubble: Bubble, chips: string[]): Card {
  const first = bubble.nodes[0];
  const what = wrapText(first.recipe ?? first.resource?.name ?? "No recipe");
  const products = bubble.products.slice(0, MAX_PRODUCT_LINES).flatMap((rate) => wrapText(keepFigures(outputLine(rate))));
  const more = bubble.products.length - MAX_PRODUCT_LINES;
  const tree = bubble.of > 1 ? ` · tree ${bubble.ordinal} of ${bubble.of}` : "";
  return {
    ...blank,
    key: bubble.key,
    kind: "bubble",
    nodeKeys: bubble.nodes.map((n) => n.key),
    title: nodeTitle({ name: first.name, count: bubble.machineCount }),
    lines: [...what, ...(products.length === 0 ? ["No output data"] : products), ...(more > 0 ? [`+${more} more ${more === 1 ? "output" : "outputs"}`] : []), `${plural(bubble.nodes.length, "group", "groups")}${tree}`, ...chips],
    mutedLines: what.length,
    className: first.className,
    label: bubbleTitle(bubble),
    loop: bubble.nodes.some((n) => n.loop === true),
    bubbleKey: bubble.key,
  };
}

function foldCard(entry: { key: string; bubbles: Bubble[] }): Card {
  const nodes = entry.bubbles.flatMap((b) => b.nodes);
  const machines = nodes.reduce((sum, n) => sum + n.count, 0);
  return {
    ...blank,
    key: entry.key,
    kind: "fold",
    nodeKeys: nodes.map((n) => n.key),
    title: cutTo(foldText({ type: "fold", key: entry.key, bubbles: entry.bubbles }), MAX_FACTORY_TITLE_CHARS),
    lines: [`${plural(machines, "machine", "machines")} in ${plural(nodes.length, "group", "groups")}`, "Click to show them"],
    mutedLines: 0,
    className: undefined,
    label: foldText({ type: "fold", key: entry.key, bubbles: entry.bubbles }),
    loop: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The three scenes
// ---------------------------------------------------------------------------------------------------------------------

/** The site canvas of ADR-0050, unchanged: a card per group and a line per connection, for a backend without factories. */
export function siteScene(site: PlannerSite, graph: ProductionGraph): Scene {
  const nodes = siteNodes(graph, site);
  const keys = new Set(nodes.map((n) => n.key));
  return {
    level: "site",
    name: site.name,
    cards: nodes.map((n) => groupCard(n)),
    frames: [],
    flows: graph.edges.filter((e) => keys.has(e.from) && keys.has(e.to)).map(edgeFlow),
    bubbleKeys: [],
    foldKeys: [],
    hasStorage: false,
    openByDefault: true,
    noun: "group",
  };
}

function factoryCard(model: FactoryModel): Card {
  const { factory } = model;
  const where = wrapText(factorySitesText(model));
  // The figures and their unit stay together on a wrap ("Iron Plate:" then "48 / 80 items/min"), as on a group's card.
  const products = factory.products.slice(0, MAX_PRODUCT_LINES).flatMap((rate) => wrapText(keepFigures(outputLine(rate))));
  const more = factory.products.length - MAX_PRODUCT_LINES;
  const chips = model.destinations.slice(0, MAX_CHIP_LINES).map((d) => destinationChipText(d.destination, d.count));
  const chipMore = model.destinations.length - MAX_CHIP_LINES;
  return {
    ...blank,
    key: factory.key,
    kind: "factory",
    nodeKeys: model.nodes.map((n) => n.key),
    title: cutTo(factoryTitle(factory), MAX_FACTORY_TITLE_CHARS),
    lines: [
      ...where,
      plural(factory.machineCount, "machine", "machines"),
      ...(products.length === 0 ? ["No output data"] : products),
      ...(more > 0 ? [`+${more} more ${more === 1 ? "output" : "outputs"}`] : []),
      ...(factory.sharedNodeCount > 0 ? [`${plural(factory.sharedNodeCount, "shared group", "shared groups")}`] : []),
      ...chips,
      ...(chipMore > 0 ? [`+${chipMore} more ${chipMore === 1 ? "end" : "ends"}`] : []),
    ],
    mutedLines: where.length,
    className: undefined,
    label: factory.name,
    loop: model.nodes.some((n) => n.loop === true),
  };
}

/** The first level: a card per factory and the flows between them (ADR-0055 Decision 6). */
export function overviewScene(graph: ProductionGraph, models: readonly FactoryModel[]): Scene {
  const owner = factoryOfNode(graph);
  return {
    level: "overview",
    name: "Factories",
    cards: models.map(factoryCard),
    frames: [],
    flows: aggregateFlows(flowParts(graph), (key) => owner.get(key)).map(canvasFlow),
    bubbleKeys: [],
    foldKeys: [],
    hasStorage: false,
    openByDefault: true,
    noun: models.length === 1 ? "factory" : "factories",
  };
}

// ---- storage -------------------------------------------------------------------------------------------------------

const isFoldableStorage = (n: PlannerNode): boolean => n.kind === "storage" && (n.role === "buffer" || n.role === "storage");

interface Folded {
  parts: FlowPart[];
  /** The storage nodes folded away. */
  removed: Set<string>;
  /** Flows that ended in a folded terminal storage, by the node they left. */
  chips: Map<string, number>;
}

/**
 * The storage toggle off (ADR-0055 Decision 6): a buffer (a storage with an output of its own) is folded into its edges,
 * each belt into it joined to each belt out of it with the same item, and terminal storage becomes a count on the groups
 * that fill it. Only containers fold; a station is the far end of a transport and stays. A buffer nothing feeds stays, so
 * the groups after it keep a source. Parts are joined one buffer at a time in key order, so the result is deterministic.
 */
export function foldStorage(nodes: readonly PlannerNode[], parts: readonly FlowPart[]): Folded {
  const foldable = new Set(nodes.filter(isFoldableStorage).map((n) => n.key));
  const removed = new Set<string>();
  const chips = new Map<string, number>();
  let current = [...parts];
  const into = (list: readonly FlowPart[], key: string) => list.filter((p) => p.to === key && p.from !== key);
  const outOf = (list: readonly FlowPart[], key: string) => list.filter((p) => p.from === key && p.to !== key);
  // Terminal storage first: a container nothing leaves is a chip on whatever fills it.
  for (const key of [...foldable].sort()) {
    if (outOf(current, key).length > 0) continue;
    for (const p of into(current, key)) if (!foldable.has(p.from)) chips.set(p.from, (chips.get(p.from) ?? 0) + 1);
    current = current.filter((p) => p.from !== key && p.to !== key);
    removed.add(key);
  }
  // Then buffers, one at a time. A buffer that was only fed by other (folded) storage is a terminal now: re-check.
  for (const key of [...foldable].sort()) {
    if (removed.has(key)) continue;
    const ins = into(current, key);
    const outs = outOf(current, key);
    if (ins.length === 0) continue;
    const joined: FlowPart[] = [];
    for (const out of outs) {
      const same = ins.filter((i) => i.itemClassName === null || out.itemClassName === null || i.itemClassName === out.itemClassName);
      const sources = same.length > 0 ? same : ins;
      for (const i of sources) {
        // Several sources share the buffer's output: split it evenly, and no longer call it measured.
        const share = sources.length;
        const transport = i.carrier !== "belt" && i.carrier !== "pipe" ? i : out;
        joined.push({
          from: i.from,
          to: out.to,
          itemClassName: out.itemClassName ?? i.itemClassName,
          itemName: out.itemName ?? i.itemName,
          ratePerMinute: out.ratePerMinute === null ? null : out.ratePerMinute / share,
          rate: share === 1 || out.rate === "unknown" ? out.rate : "estimated",
          mixed: out.mixed || i.mixed,
          carrier: transport.carrier,
          flow: out.flow,
          unit: out.unit,
          routeName: transport.routeName,
        });
      }
    }
    current = [...current.filter((p) => p.from !== key && p.to !== key), ...joined];
    removed.add(key);
  }
  // Joining can leave a part from a node to itself; it is internal to that node.
  return { parts: current.filter((p) => p.from !== p.to), removed, chips };
}

// ---- collapse upstream ---------------------------------------------------------------------------------------------

/**
 * ADR-0055 Decision 4, step 7: the groups each node post-dominates, as the tree of `collapseUnder`. A node whose
 * post-dominator was folded away (a storage) hangs under that node's own. Returns each visible node's children.
 */
function dominanceChildren(all: ReadonlyMap<string, PlannerNode>, visible: ReadonlySet<string>): Map<string, string[]> {
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const key of visible) {
    let p = all.get(key)?.collapseUnder ?? null;
    let guard = 0;
    while (p !== null && !visible.has(p) && guard++ < 64) p = all.get(p)?.collapseUnder ?? null;
    if (p === null || p === key || !visible.has(p)) continue;
    parentOf.set(key, p);
  }
  for (const [key, p] of parentOf) {
    // A cycle in the data (never a real post-dominator tree) would let a collapsed card hide itself: drop its edges.
    let up: string | undefined = p;
    for (let steps = 0; up !== undefined && up !== key && steps <= parentOf.size; steps++) up = parentOf.get(up);
    if (up === key) continue;
    const list = children.get(p);
    if (list === undefined) children.set(p, [key]);
    else list.push(key);
  }
  return children;
}

/** Everything the members of a card post-dominate, not counting the members. */
function dominatedBy(members: readonly string[], children: ReadonlyMap<string, string[]>): Set<string> {
  const seen = new Set(members);
  const out = new Set<string>();
  const stack = [...members];
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

// ---- the opened factory --------------------------------------------------------------------------------------------

/** Whether a factory's bubbles are open unless flipped: it has few enough groups. */
export const defaultExpanded = (nodeCount: number): boolean => nodeCount <= COLLAPSE_AT;

/**
 * An opened factory (ADR-0055 Decision 6, ADR-0053 Decision 3): bubbles of a recipe and source tree, expanded in place
 * into their groups inside a labelled frame; the fold cap's "N more trees"; storage folded or drawn; and the upstream a
 * collapsed card hides. A bubble of one group is just that group's card. Flows between cards are summed with their
 * quality kept honest; a flow inside one card is internal and dropped.
 */
export function factoryScene(graph: ProductionGraph, model: FactoryModel, view: FactoryView): Scene {
  const all = new Map(graph.nodes.map((n) => [n.key, n]));
  const inFactory = new Set(model.nodes.map((n) => n.key));
  const parts = flowParts(graph).filter((p) => inFactory.has(p.from) && inFactory.has(p.to));
  const hasStorage = model.nodes.some(isFoldableStorage);
  const folded: Folded = view.storageDetail ? { parts, removed: new Set(), chips: new Map() } : foldStorage(model.nodes, parts);
  const shown = model.nodes.filter((n) => !folded.removed.has(n.key));
  const open = defaultExpanded(shown.length);
  const expanded = (key: string) => open !== view.flipped.has(key);

  const factoryNames = new Map((graph.factories ?? []).map((f) => [f.key, f.name]));
  const remote = remoteInfo(graph, model);
  const chipLines = (keys: readonly string[]): string[] => {
    const n = keys.reduce((sum, k) => sum + (folded.chips.get(k) ?? 0), 0);
    return n === 0 ? [] : [destinationChipText("storage", n)];
  };
  const groupWithFacts = (node: PlannerNode): Card => {
    const extra: string[] = [];
    const split = shareSplit(node);
    if (split !== null) extra.push(...wrapText(shareText(split, factoryNames), MAX_LINE_CHARS, 3));
    const away = remote.get(node.key);
    if (away !== undefined) extra.push(...wrapText(remoteText(away), MAX_LINE_CHARS, 3));
    extra.push(...chipLines([node.key]));
    return groupCard(node, extra);
  };

  const cards: Card[] = [];
  const frames: Frame[] = [];
  const bubbleKeys: string[] = [];
  const foldKeys: string[] = [];
  const entries = foldBubbles(bubblesOf(shown));
  const place = (bubble: Bubble) => {
    if (bubble.nodes.length === 1) {
      cards.push({ ...groupWithFacts(bubble.nodes[0]), bubbleKey: undefined });
      return;
    }
    bubbleKeys.push(bubble.key);
    if (!expanded(bubble.key)) {
      cards.push(bubbleCard(bubble, chipLines(bubble.nodes.map((n) => n.key))));
      return;
    }
    const frame = `frame|${bubble.key}`;
    const members = bubble.nodes.map((n) => ({ ...groupWithFacts(n), frame, bubbleKey: bubble.key }));
    cards.push(...members);
    frames.push({ key: frame, bubbleKey: bubble.key, title: bubbleTitle(bubble), cardKeys: members.map((c) => c.key) });
  };
  for (const entry of entries) {
    if (entry.type === "bubble") place(entry.bubble);
    else if (view.unfolded.has(entry.key)) entry.bubbles.forEach(place);
    else {
      foldKeys.push(entry.key);
      cards.push(foldCard(entry));
    }
  }

  // Collapse upstream: what a collapsed card post-dominates is hidden; a card goes when every group in it is hidden.
  const visibleKeys = new Set(shown.map((n) => n.key));
  const children = dominanceChildren(all, visibleKeys);
  const dominated = new Map(cards.map((c) => [c.key, dominatedBy(c.nodeKeys, children)]));
  const hidden = new Set<string>();
  for (const key of view.collapsed) for (const k of dominated.get(key) ?? []) hidden.add(k);
  const live = cards.filter((c) => !c.nodeKeys.every((k) => hidden.has(k)));
  const cardOf = new Map<string, string>();
  for (const c of live) for (const k of c.nodeKeys) cardOf.set(k, c.key);
  const withUpstream = live.map((c): Card => {
    const count = dominated.get(c.key)?.size ?? 0;
    return count === 0 || c.kind === "fold" ? c : { ...c, upstream: { count, collapsed: view.collapsed.has(c.key) } };
  });
  const liveKeys = new Set(withUpstream.map((c) => c.key));
  const liveFrames = frames.flatMap((f): Frame[] => {
    const cardKeys = f.cardKeys.filter((k) => liveKeys.has(k));
    return cardKeys.length === 0 ? [] : [{ ...f, cardKeys }];
  });

  const flows = aggregateFlows(folded.parts, (key) => cardOf.get(key)).map(canvasFlow);
  const allGroups = withUpstream.every((c) => c.kind === "group");
  return {
    level: "factory",
    name: model.factory.name,
    cards: withUpstream,
    frames: liveFrames,
    flows,
    bubbleKeys,
    foldKeys,
    hasStorage,
    openByDefault: open,
    noun: allGroups ? "group" : "card",
  };
}

/** The canvas's accessible name: counts only, since the tables carry the detail. */
export function sceneSummary(scene: Scene, loops: number): string {
  const n = scene.cards.length;
  const noun = scene.noun === "factories" || scene.noun === "factory" ? (n === 1 ? "factory" : "factories") : n === 1 ? scene.noun : `${scene.noun}s`;
  const c = `${scene.flows.length} ${scene.flows.length === 1 ? "connection" : "connections"}`;
  return `Graph of ${scene.name}: ${n} ${noun}, ${c}${loops > 0 ? `, ${loops} in a loop` : ""}. The Tables view lists the same.`;
}

/** The scene the canvas shows for a view of the graph: one factory, the factory overview, or (an older backend) one site. */
export function sceneFor(graph: ProductionGraph, target: { factory: string | null } | { site: PlannerSite }, view: FactoryView): Scene {
  if ("site" in target) return siteScene(target.site, graph);
  const models = factoryModels(graph);
  const model = target.factory === null ? undefined : models.find((m) => m.factory.key === target.factory);
  return model === undefined ? overviewScene(graph, models) : factoryScene(graph, model, view);
}
