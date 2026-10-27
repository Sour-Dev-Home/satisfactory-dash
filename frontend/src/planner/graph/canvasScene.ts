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
  hasUnknown,
  mergeStateCounts,
  outputLine,
  remoteText,
  shareText,
  siteNodes,
  UNKNOWN_FLOW_NOTE,
} from "../plannerText";
import { glyphKindOf, type GlyphKind } from "./buildingIcons";
import {
  INFERRED_FROM_NODE,
  MAX_SUMMARY_CHARS,
  edgeLabel,
  edgeLabelLines,
  extractorOutput,
  extractorOutputText,
  groupsExtractorOutput,
  isStaleNode,
  nameOr,
  nodeFacts,
  nodeSummary,
  nodeTitle,
  productSummary,
  STALE_NODE_NOTE,
  staleNodeLines,
  stalledNote,
  withName,
} from "./graphModel";
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
  type FlowQuality,
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
const UNNAMED_FACTORY = "Unnamed factory";

export type CardKind = "factory" | "bubble" | "group" | "fold";

export interface Card {
  /** Unique in the scene: a group's key, a bubble's `treeKey`, `fold|...`, a factory's key. */
  key: string;
  kind: CardKind;
  /** The groups the card stands for. */
  nodeKeys: string[];
  /** The name with its machine count ("8× Constructor"); not printed on the card, it names the card in edge tooltips. */
  title: string;
  /** What the card prints under its icon row: one line (a factory's name and then one line). Never empty. */
  lines: string[];
  /** Lines from this index on are a muted note (an extractor's "(inferred from the node)"); absent = none. */
  mutedFrom?: number;
  /** The "×N" machine count badge, when the card stands for machines. */
  count: number | undefined;
  /** The building class whose icon the card shows, when it stands for one class. */
  className: string | undefined;
  /** The generic glyph for the card's kind, drawn when its class has no icon (or the icon fails to load). */
  glyph: GlyphKind;
  /** The card's short name (a group's "8× Constructor, Iron Plate", a factory's name). */
  label: string;
  /** Everything the card does not print: the tooltip and the keyboard button's words (the findings count is added by the canvas). */
  description: string;
  /** A group's further words from the factory view (share split, where it stands, storage chips); the side panel lists them. */
  facts: string[];
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
  /** The label in one line (the tooltip's words), and as drawn: one to three lines (a bundle's up to four). */
  label: string;
  labelLines: string[];
  routeName?: string | undefined;
  /** The summed rate behind the label (null when no part had a number), its unit and its quality ("at least" kept). */
  ratePerMinute: number | null;
  unit: "items/min" | "m3/min";
  quality: FlowQuality;
  /** A bundle (`bundleFlows`): the links it draws as one line, each with its own item and rate. Absent on a single link. */
  parts?: CanvasFlow[] | undefined;
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
    ratePerMinute: f.ratePerMinute,
    unit: f.unit,
    quality: f.quality,
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
    ratePerMinute: edge.ratePerMinute,
    unit: edge.kind === "pipe" ? "m3/min" : "items/min",
    quality: edge.rate,
  };
}

/** A bundle's label names this many items; the rest are "+k more" (the tooltip and the Tables view list them all). */
export const BUNDLE_NAMES = 2;

/** Whether a link's rate counts in a sum: a finite number the backend did not call unknown. */
const known = (f: Pick<CanvasFlow, "quality" | "ratePerMinute">): boolean => f.quality !== "unknown" && f.ratePerMinute !== null && Number.isFinite(f.ratePerMinute);

/**
 * One drawn line per ordered pair of cards and carrier (2026-10-27, ADR-0059 amendment): links between the same two cards
 * in the same direction, on the same carrier (which sets the line's colour and a transport's glyph) and of the same kind
 * (supply or excess), become one line with one label, so they no longer run as near-parallel lines with stacked labels.
 * The label names the items (up to `BUNDLE_NAMES`, then "+k more"), folds links of no known item into "+u unknown", and
 * sums the rate by ADR-0053 Decision 3's rule (weakest quality wins, "at least" when a part has no number). Nothing is
 * dropped: `parts` keeps every link, the tooltip (`flowTitle`) lists each with its own rate, and the Tables view is
 * unchanged. Returns the drawn flows in first-seen order, each with the indexes of the links it stands for.
 */
export function bundleFlows(flows: readonly CanvasFlow[]): { flow: CanvasFlow; members: number[] }[] {
  const groups = new Map<string, number[]>();
  flows.forEach((f, i) => {
    // The unit too: a carrier can move items and fluid, and those never sum (hierarchy.ts keys on it as well).
    const key = [f.from, f.to, f.carrier, f.flow, f.unit].join("\u0001");
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [i]);
    else list.push(i);
  });
  return [...groups.values()].map((members) => ({ flow: members.length === 1 ? flows[members[0]] : bundledFlow(members.map((i) => flows[i])), members }));
}

function bundledFlow(parts: readonly CanvasFlow[]): CanvasFlow {
  const head = parts[0];
  const nameOf = (p: CanvasFlow): string | null => {
    const n = p.itemName ?? p.itemClassName;
    return n === null || n === "" ? null : n;
  };
  const names = [...new Set(parts.flatMap((p) => nameOf(p) ?? []))];
  const unknownItems = parts.filter((p) => nameOf(p) === null).length;
  const sure = parts.filter(known);
  const quality: FlowQuality =
    sure.length === 0
      ? "unknown"
      : sure.length < parts.length || parts.some((p) => p.quality === "atLeast")
        ? "atLeast"
        : parts.every((p) => p.quality === "measured")
          ? "measured"
          : "estimated";
  const ratePerMinute = sure.length === 0 ? null : sure.reduce((sum, p) => sum + p.ratePerMinute!, 0);
  const unit = head.unit;
  const rateLine = quality === "unknown" ? null : aggregateRateText({ quality, ratePerMinute, unit });
  const shown = names.slice(0, BUNDLE_NAMES);
  const more = names.length - shown.length;
  const mixed = parts.some((p) => p.mixed);
  const head1 = shown.length > 0 ? shown.join(", ") : `${unknownItems} items unknown`;
  const extras = [...(more > 0 ? [`+${more} more`] : []), ...(shown.length > 0 && unknownItems > 0 ? [`+${unknownItems} unknown`] : []), ...(mixed ? ["mixed"] : [])];
  const routes = new Set(parts.map((p) => p.routeName));
  return {
    from: head.from,
    to: head.to,
    itemClassName: null,
    itemName: null,
    carrier: head.carrier,
    flow: head.flow,
    mixed,
    rate: quality === "measured" ? "measured" : quality === "unknown" ? "unknown" : "estimated",
    label: [`${parts.length} links`, ...parts.map((p) => p.label)].join("; "),
    labelLines: [head1, ...(extras.length > 0 ? [extras.join(", ")] : []), ...(rateLine === null ? [] : [rateLine]), ...(head.flow === "excess" ? ["excess"] : [])],
    routeName: routes.size === 1 ? head.routeName : undefined,
    ratePerMinute,
    unit,
    quality,
    parts: [...parts],
  };
}

/** How sure an edge's rate is, in the tables' words. */
export const flowSureness = (flow: Pick<CanvasFlow, "rate">): string => (flow.rate === "measured" ? "measured" : flow.rate === "estimated" ? "estimated" : "rate unknown");

/**
 * A flow's tooltip and accessible words: "Train, route Ore Run: A to B: Iron Ore · 120 items/min (estimated)". A bundle
 * lists every link it draws, each with its own rate: "A to B, 2 links: Iron Ingot · 30 items/min (measured); Steel Pipe
 * (rate unknown)".
 */
export function flowTitle(flow: CanvasFlow, from: string, to: string): string {
  const by = flow.carrier === "belt" || flow.carrier === "pipe" ? "" : `${carrierWord(flow.carrier)}${flow.routeName === undefined ? "" : `, route ${flow.routeName}`}: `;
  const bundle = flow.parts !== undefined && flow.parts.length > 1 ? flow.parts : null;
  const why = (bundle ?? [flow]).some(hasUnknown) ? `. ${UNKNOWN_FLOW_NOTE}` : "";
  if (bundle !== null) {
    return `${by}${from} to ${to}, ${bundle.length} links: ${bundle.map((p) => `${flow.routeName === undefined && p.routeName !== undefined ? `route ${p.routeName}, ` : ""}${p.label} (${flowSureness(p)})`).join("; ")}${why}`;
  }
  return `${by}${from} to ${to}: ${flow.label} (${flowSureness(flow)})${why}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------------------------------

const blank = { upstream: undefined, frame: undefined, bubbleKey: undefined, className: undefined, count: undefined, facts: [] as string[] } as const;

/** The "×N" badge's number: only a finite, positive count prints (a bad one from the server leaves no badge, not "×NaN"). */
const countOf = (n: number): number | undefined => (Number.isFinite(n) && n > 0 ? n : undefined);

/** The same words in a sentence each: what the tooltip and the keyboard button read (the card itself prints one line). */
const sentences = (parts: readonly string[]): string => parts.filter((p) => p !== "").join(". ");

/**
 * A card's lines, plus a muted note under them (#728): "(inferred from the node)" under an extractor's guessed resource,
 * or the machines' state under a product that reads 0. An extractor guesses only when it has no product, so never both.
 */
const withMutedNote = (lines: string[], mined: { inferred: boolean } | null, stalled: string | null = null): Pick<Card, "lines" | "mutedFrom"> => {
  const note = mined?.inferred === true ? INFERRED_FROM_NODE : stalled;
  return note === null ? { lines } : { lines: [...lines, note], mutedFrom: lines.length };
};

/** The glyph of a card for several groups: the clock only when every group is stale, else the first group's own glyph. */
const glyphOfGroups = (nodes: readonly PlannerNode[], first: PlannerNode): GlyphKind =>
  glyphKindOf(nodes.every(isStaleNode) ? first : { kind: first.kind, ...(first.role === undefined ? {} : { role: first.role }) });

/** A card built from stale conveyor data (#728 cause 11): only the muted note, wrapped to the card's line limits. */
const staleCardLines = (): Pick<Card, "lines" | "mutedFrom"> => ({ lines: staleNodeLines(), mutedFrom: 0 });

/**
 * A group as a card (icon-first): the building's icon, a "×N" machine count and one line, its main product and rate. The
 * recipe, the other outputs and the loop marker are in `description` (the tooltip and the keyboard name) and the side
 * panel; `facts` are the further words the factory view adds (the share split, where the group stands, storage chips).
 */
export function groupCard(node: PlannerNode, facts: string[] = []): Card {
  const shown = withName(node);
  const { outputs, loop } = nodeFacts(node);
  return {
    ...blank,
    key: node.key,
    kind: "group",
    nodeKeys: [node.key],
    title: nodeTitle(shown),
    ...(isStaleNode(node) ? staleCardLines() : withMutedNote([nodeSummary(node)], extractorOutput(node), stalledNote(node.products[0], node.stateCounts))),
    count: countOf(node.count),
    className: node.className,
    glyph: glyphKindOf(node),
    label: groupLabel(shown),
    description: sentences([groupLabel(shown), ...outputs, ...(loop ? ["In a loop"] : []), ...facts]),
    facts,
    loop: node.loop === true,
  };
}

function bubbleCard(bubble: Bubble, chips: string[]): Card {
  const first = withName(bubble.nodes[0]);
  const title = bubbleTitle({ ...bubble, nodes: [first, ...bubble.nodes.slice(1)] });
  const tree = bubble.of > 1 ? ` · tree ${bubble.ordinal} of ${bubble.of}` : "";
  const groups = plural(bubble.nodes.length, "group", "groups");
  const loop = bubble.nodes.some((n) => n.loop === true);
  const mined = bubble.products.length === 0 ? groupsExtractorOutput(bubble.nodes) : null;
  const states = mergeStateCounts(bubble.nodes.map((n) => n.stateCounts));
  const stale = bubble.nodes.every(isStaleNode);
  const outputs = stale
    ? [STALE_NODE_NOTE]
    : mined !== null
      ? [extractorOutputText(mined)]
      : bubble.products.length === 0
        ? ["No output data"]
        : bubble.products.map((r) => outputLine(r, states));
  return {
    ...blank,
    key: bubble.key,
    kind: "bubble",
    nodeKeys: bubble.nodes.map((n) => n.key),
    title: nodeTitle({ name: first.name, count: bubble.machineCount }),
    ...(stale
      ? staleCardLines()
      : withMutedNote(
          [mined !== null ? cutTo(mined.name, MAX_SUMMARY_CHARS) : bubble.products.length === 0 ? groups : productSummary(bubble.products[0])],
          mined,
          stalledNote(bubble.products[0], states),
        )),
    count: countOf(bubble.machineCount),
    className: first.className,
    glyph: glyphOfGroups(bubble.nodes, first),
    label: title,
    description: sentences([title, ...outputs, `${groups}${tree}`, ...(loop ? ["In a loop"] : []), ...chips]),
    facts: chips,
    loop,
    bubbleKey: bubble.key,
  };
}

function foldCard(entry: { key: string; bubbles: Bubble[] }): Card {
  const nodes = entry.bubbles.flatMap((b) => b.nodes);
  const machines = nodes.reduce((sum, n) => sum + n.count, 0);
  const first = withName(nodes[0]);
  const text = foldText({ type: "fold", key: entry.key, bubbles: entry.bubbles });
  return {
    ...blank,
    key: entry.key,
    kind: "fold",
    nodeKeys: nodes.map((n) => n.key),
    title: cutTo(text, MAX_FACTORY_TITLE_CHARS),
    lines: [cutTo(text, MAX_SUMMARY_CHARS)],
    count: countOf(machines),
    className: first.className,
    glyph: glyphOfGroups(nodes, first),
    label: text,
    description: sentences([text, `${plural(machines, "machine", "machines")} in ${plural(nodes.length, "group", "groups")}`, "Click to show them"]),
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
  const name = nameOr(factory.name, UNNAMED_FACTORY);
  const title = cutTo(nameOr(factoryTitle(factory), UNNAMED_FACTORY), MAX_FACTORY_TITLE_CHARS);
  // The icon is the factory's main machine: the biggest group that makes its first product, else the biggest machine
  // group, else the biggest group (the first by key among equals). Never a consumer it feeds, such as its burners.
  const biggest = (nodes: readonly PlannerNode[]) => [...nodes].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0];
  const product = factory.products[0]?.className;
  const main =
    biggest(product === undefined ? [] : model.nodes.filter((n) => n.products.some((p) => p.className === product))) ??
    biggest(model.nodes.filter((n) => n.kind === "machines")) ??
    biggest(model.nodes);
  return {
    ...blank,
    key: factory.key,
    kind: "factory",
    nodeKeys: model.nodes.map((n) => n.key),
    title,
    // The name and one product line; where it stands, the other outputs and the ends are in `description`.
    ...withMutedNote([title, factory.products.length === 0 ? "No output data" : productSummary(factory.products[0])], null, stalledNote(factory.products[0], model.stateCounts)),
    count: countOf(factory.machineCount),
    className: main?.className,
    glyph: main === undefined ? "unknown" : glyphOfGroups(model.nodes, main),
    label: name,
    description: sentences([
      name,
      factorySitesText(model),
      plural(factory.machineCount, "machine", "machines"),
      ...(factory.products.length === 0 ? ["No output data"] : factory.products.map((r) => outputLine(r, model.stateCounts))),
      ...(factory.sharedNodeCount > 0 ? [plural(factory.sharedNodeCount, "shared group", "shared groups")] : []),
      ...model.destinations.map((d) => destinationChipText(d.destination, d.count)),
      ...(model.nodes.some((n) => n.loop === true) ? ["In a loop"] : []),
    ]),
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
    if (split !== null) extra.push(shareText(split, factoryNames));
    const away = remote.get(node.key);
    if (away !== undefined) extra.push(remoteText(away));
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
