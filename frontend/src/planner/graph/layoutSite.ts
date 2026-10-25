import dagre from "@dagrejs/dagre";
import type { PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { siteScene, type Card, type CanvasFlow, type Frame, type Scene } from "./canvasScene";
import { buildingIconUrl } from "./buildingIcons";
import { nodeBody, nodeTitle } from "./graphModel";

// Sizes are SVG user units, tied to the canvas's text classes (title `text-base` 16 px semibold, body lines and edge
// labels `text-sm` 14 px). The title's baseline is TITLE_H down from the card's top, each line LINE_H below the last.
export const CHAR_W_TITLE = 9.2;
export const CHAR_W_BODY = 7.7;
export const NODE_PAD_X = 10;
export const NODE_PAD_Y = 5;
export const TITLE_H = 24;
export const LINE_H = 20;
export const NODE_MIN_W = 100;
/** The building icon on a card: a square at the card's top-left, as tall as the title row, and the gap before the title. */
export const BUILDING_ICON_SIZE = 18;
export const BUILDING_ICON_GAP = 3;
export const LABEL_H = 18;
/** One line of an edge label (`text-sm` 14 px). */
export const LABEL_LINE_H = 16;
export const LABEL_PAD = 4;
/** The gap between an edge label and the line it names. */
export const LABEL_GAP = 4;
/** Dagre's spacing, tight on purpose: a fit should show the drawing, so the ranks and rows sit close. */
export const RANK_SEP = 40;
export const NODE_SEP = 20;
/** The graph's margin, and the height of the tab on an expanded bubble's frame that holds its title and its Collapse button (half of it stands above the frame's top edge). */
export const MARGIN = 16;
export const FRAME_HEADER_H = 22;

export interface LaidNode {
  key: string;
  /** The top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  /** How many leading `lines` are drawn muted (the recipe, or where a factory stands). */
  recipeLines: number;
  /** The building's icon, when its class has one; the title then starts `titleX` from the card's left. */
  iconUrl: string | undefined;
  titleX: number;
  card: Card;
}

export interface LaidFrame {
  key: string;
  bubbleKey: string;
  title: string;
  x: number;
  y: number;
  width: number;
  /** Including the header strip. */
  height: number;
}

export interface LaidEdge {
  /** Index into `SiteLayout.flows`. */
  index: number;
  flow: CanvasFlow;
  /** The path, from the source card's side to the destination's. */
  points: { x: number; y: number }[];
  /** The label in one line (the tooltip's words). */
  label: string;
  /** The label as drawn: one to three lines. */
  labelLines: string[];
  /** The label's centre: just above the middle of the path (see `labelPlacement`). */
  labelX: number;
  labelY: number;
  /** The label box's estimated width and height. */
  labelWidth: number;
  labelHeight: number;
}

export interface SiteLayout {
  nodes: LaidNode[];
  frames: LaidFrame[];
  edges: LaidEdge[];
  /** The flows the layout was given (those with both ends drawn), in the order `LaidEdge.index` refers to. */
  flows: CanvasFlow[];
  width: number;
  height: number;
}

type CardSize = Pick<LaidNode, "width" | "height" | "title" | "lines" | "recipeLines" | "iconUrl" | "titleX">;

/** A card's size from its text: as wide as its longest line, as tall as its lines. */
export function cardSize(card: Card): CardSize {
  const iconUrl = card.className === undefined ? undefined : buildingIconUrl(card.className);
  const titleShift = iconUrl === undefined ? 0 : BUILDING_ICON_SIZE + BUILDING_ICON_GAP;
  const text = Math.max(card.title.length * CHAR_W_TITLE + titleShift, ...card.lines.map((l) => l.length * CHAR_W_BODY));
  return {
    title: card.title,
    lines: card.lines,
    recipeLines: card.mutedLines,
    iconUrl,
    titleX: NODE_PAD_X + titleShift,
    width: Math.max(NODE_MIN_W, Math.ceil(text + 2 * NODE_PAD_X)),
    height: Math.ceil(TITLE_H + card.lines.length * LINE_H + 2 * NODE_PAD_Y),
  };
}

/** A group's card size, from the group alone. */
export function nodeSize(node: PlannerNode): CardSize {
  const { lines, recipeLines } = nodeBody(node);
  return cardSize({ key: node.key, kind: "group", nodeKeys: [node.key], title: nodeTitle(node), lines, mutedLines: recipeLines, className: node.className, label: "", loop: false, frame: undefined, bubbleKey: undefined });
}

/** The estimated width of an edge label's text. */
export const labelWidth = (text: string) => Math.ceil(text.length * CHAR_W_BODY + LABEL_PAD);

/** A label box's size from its lines: as wide as the longest, as tall as the lines (each `LABEL_LINE_H`) plus padding. */
export const labelSize = (lines: readonly string[]) => ({
  width: Math.max(0, ...lines.map(labelWidth)),
  height: lines.length * LABEL_LINE_H + LABEL_PAD,
});

type Point = { x: number; y: number };

const lengthOf = (points: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
};

/**
 * Where an edge's label goes: the centre of a `width` x `LABEL_H` box beside the path's middle (by length), pushed off the
 * segment along its normal, on the upper side (the right when the segment is vertical), far enough that the box clears the
 * line by `LABEL_GAP`. So a level edge's label sits just above it and a steep one's beside it. A path with no length puts the label
 * on its point.
 */
export function labelPlacement(points: readonly Point[], width: number, height = LABEL_H): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = lengthOf(points);
  if (total === 0) return { ...points[0] };
  let rest = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0 || rest > len) {
      rest -= len;
      continue;
    }
    const t = rest / len;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // The normal on the upper side; a vertical segment has none, so the right.
    let nx = uy;
    let ny = -ux;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const d = Math.abs(nx) * (width / 2) + Math.abs(ny) * (height / 2) + LABEL_GAP;
    return { x: a.x + (b.x - a.x) * t + nx * d, y: a.y + (b.y - a.y) * t + ny * d };
  }
  return { ...points[points.length - 1] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The layout, remembered
// ---------------------------------------------------------------------------------------------------------------------

/** Where dagre put things, with no text in it: what the layout memo keeps. Centres for cards, boxes for frames. */
interface Placement {
  centres: Map<string, Point>;
  frames: Map<string, { x: number; y: number; width: number; height: number }>;
  paths: Point[][];
  /** How far up each flow's label stands above where its own box would (flows merged into one dagre edge stack their labels). */
  stack: number[];
  width: number;
  height: number;
}

const MEMO_LIMIT = 12;
const memo = new Map<string, Placement>();
const stats = { computed: 0, reused: 0, lastMs: 0, slowestMs: 0 };

/** For tests and the timing guard: how many layouts dagre ran, how many the memo answered, and how long dagre took. */
export const layoutStats = () => ({ ...stats });
export function clearLayoutMemo(): void {
  memo.clear();
  stats.computed = 0;
  stats.reused = 0;
  stats.lastMs = 0;
  stats.slowestMs = 0;
}

/** FNV-1a over a string: a short, stable name for "these cards, these flows, these sizes". */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * What dagre needs and nothing else: the cards (key and size), the frames (key and children) and the flows (ends and label
 * box). Two scenes with the same signature get the same placement, whatever the live rates in their text say.
 */
function signature(scene: Scene, sizes: readonly CardSize[], labels: readonly { width: number; height: number }[], drawn: readonly CanvasFlow[]): string {
  const cards = scene.cards.map((c, i) => `${c.key}\u0001${sizes[i].width}\u0001${sizes[i].height}`).join("\u0002");
  const frames = scene.frames.map((f) => `${f.key}\u0001${f.cardKeys.join("\u0003")}`).join("\u0002");
  const flows = drawn.map((f, i) => `${f.from}\u0001${f.to}\u0001${labels[i].width}\u0001${labels[i].height}`).join("\u0002");
  return hashOf(`${cards}\u0004${frames}\u0004${flows}`);
}

type Box = { x: number; y: number; width: number; height: number };
type LabelBox = { width: number; height: number };

/**
 * Dagre, once. `merged` gives each pair of cards one edge (the labels of its flows stacked into one box, the flows drawn
 * over the same path with their labels one above the other): the shape dagre's multigraph handling sometimes cannot route
 * (it throws "Not possible to find intersection inside of the rectangle" on some parallel edges that skip a rank).
 */
function placeWith(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[], labels: readonly LabelBox[], merged: boolean): Placement {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  const nodesep = scene.frames.length > 0 ? NODE_SEP + FRAME_HEADER_H / 2 : NODE_SEP;
  g.setGraph({ rankdir: "LR", acyclicer: "greedy", ranker: "network-simplex", nodesep, ranksep: RANK_SEP, edgesep: 10, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  scene.cards.forEach((c, i) => g.setNode(c.key, { width: sizes[i].width, height: sizes[i].height }));
  for (const f of scene.frames) {
    g.setNode(f.key, {});
    for (const k of f.cardKeys) g.setParent(k, f.key);
  }
  // Which dagre edge draws each flow, and how far up its label stands from the first one's.
  const edgeOf: string[] = [];
  const stack: number[] = drawn.map(() => 0);
  if (merged) {
    const groups = new Map<string, number[]>();
    drawn.forEach((f, i) => {
      const list = groups.get(`${f.from}\u0001${f.to}`);
      if (list === undefined) groups.set(`${f.from}\u0001${f.to}`, [i]);
      else list.push(i);
    });
    let n = 0;
    for (const members of groups.values()) {
      const name = String(n++);
      let above = 0;
      for (const i of members) {
        edgeOf[i] = name;
        stack[i] = above;
        above += labels[i].height;
      }
      g.setEdge(drawn[members[0]].from, drawn[members[0]].to, { width: Math.max(...members.map((i) => labels[i].width)), height: above, labelpos: "c" }, name);
    }
  } else {
    drawn.forEach((f, i) => {
      edgeOf[i] = String(i);
      g.setEdge(f.from, f.to, { ...labels[i], labelpos: "c" }, String(i));
    });
  }
  dagre.layout(g);

  const centres = new Map<string, Point>();
  scene.cards.forEach((c) => {
    const p = g.node(c.key);
    centres.set(c.key, { x: p.x, y: p.y });
  });
  const frames = new Map<string, Box>();
  for (const f of scene.frames) {
    const p = g.node(f.key);
    const box = { x: p.x - p.width / 2, y: p.y - p.height / 2, width: p.width, height: p.height };
    frames.set(f.key, box);
  }
  const paths = drawn.map((f, i) => (g.edge(f.from, f.to, edgeOf[i]).points ?? []).map((p: Point) => ({ x: p.x, y: p.y })));
  // An empty graph comes back from dagre with width and height -Infinity.
  const { width, height } = g.graph();
  return { centres, frames, paths, stack, width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

/** Where a straight line from a card's centre towards a point leaves the card. */
function leaves(centre: Point, size: LabelBox, toward: Point): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) return { ...centre };
  const t = Math.min(dx === 0 ? Infinity : size.width / 2 / Math.abs(dx), dy === 0 ? Infinity : size.height / 2 / Math.abs(dy));
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}

/**
 * The last resort when dagre throws twice: the cards in rows of equal cells, each flow a straight line, each frame the box
 * round its cards. Plain, but a picture instead of a crash.
 */
function placeGrid(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[]): Placement {
  const cols = Math.max(1, Math.ceil(Math.sqrt(scene.cards.length)));
  const cellW = Math.max(NODE_MIN_W, ...sizes.map((s) => s.width)) + RANK_SEP;
  const cellH = Math.max(0, ...sizes.map((s) => s.height)) + NODE_SEP + FRAME_HEADER_H;
  const centres = new Map<string, Point>();
  scene.cards.forEach((c, i) => centres.set(c.key, { x: MARGIN + (i % cols) * cellW + cellW / 2, y: MARGIN + FRAME_HEADER_H + Math.floor(i / cols) * cellH + cellH / 2 }));
  const sizeOf = new Map(scene.cards.map((c, i) => [c.key, sizes[i]]));
  const frames = new Map<string, Box>();
  for (const f of scene.frames) {
    const boxes = f.cardKeys.flatMap((k) => (centres.has(k) ? [{ c: centres.get(k)!, s: sizeOf.get(k)! }] : []));
    if (boxes.length === 0) continue;
    const left = Math.min(...boxes.map((b) => b.c.x - b.s.width / 2)) - NODE_SEP / 2;
    const right = Math.max(...boxes.map((b) => b.c.x + b.s.width / 2)) + NODE_SEP / 2;
    const topEdge = Math.min(...boxes.map((b) => b.c.y - b.s.height / 2)) - NODE_SEP / 2;
    const bottom = Math.max(...boxes.map((b) => b.c.y + b.s.height / 2)) + NODE_SEP / 2;
    frames.set(f.key, { x: left, y: topEdge, width: right - left, height: bottom - topEdge });
  }
  const paths = drawn.map((f) => {
    const a = centres.get(f.from)!;
    const b = centres.get(f.to)!;
    return [leaves(a, sizeOf.get(f.from)!, b), leaves(b, sizeOf.get(f.to)!, a)];
  });
  const rows = Math.ceil(scene.cards.length / cols);
  return { centres, frames, paths, stack: drawn.map(() => 0), width: MARGIN * 2 + cols * cellW, height: MARGIN * 2 + FRAME_HEADER_H + rows * cellH };
}

function place(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[], labels: readonly LabelBox[]): Placement {
  for (const merged of [false, true]) {
    try {
      return placeWith(scene, sizes, drawn, labels, merged);
    } catch {
      // Dagre has bugs of its own with some shapes; the next attempt draws the same facts in a simpler shape.
    }
  }
  return placeGrid(scene, sizes, drawn);
}

/**
 * The picture of a scene (ADR-0050 Decision 3, ADR-0055 Decision 7): dagre, left to right (sources left, outputs right),
 * over the cards and the flows between them, an expanded bubble's groups inside their frame. Pure and deterministic: the
 * same scene gives the same positions. A flow with an end that is not a card is left out.
 *
 * Dagre is the cost (Decision 3's worker trigger is 100 ms on a real site), so the placement is remembered: the key is the
 * response's `topologyHash` (when the backend sent one) plus a signature of the cards, flows and sizes, which a poll that
 * only moves rates does not change. Text is never part of the memo: the laid nodes carry the scene's current words.
 */
export function layoutScene(scene: Scene, topologyHash?: string): SiteLayout {
  const own = scene.cards.map(cardSize);
  // The overview's factory cards are peers: one height, so the row reads evenly.
  const tallest = scene.level === "overview" ? Math.max(0, ...own.map((s) => s.height)) : 0;
  const sizes = tallest === 0 ? own : own.map((s) => ({ ...s, height: tallest }));
  const known = new Set(scene.cards.map((c) => c.key));
  const flows = scene.flows.filter((f) => known.has(f.from) && known.has(f.to));
  const labels = flows.map((f) => labelSize(f.labelLines));
  const key = `${topologyHash ?? ""}|${scene.level}|${signature(scene, sizes, labels, flows)}`;
  let placement = memo.get(key);
  if (placement === undefined) {
    const start = performance.now();
    placement = place(scene, sizes, flows, labels);
    stats.lastMs = performance.now() - start;
    stats.slowestMs = Math.max(stats.slowestMs, stats.lastMs);
    stats.computed++;
    memo.set(key, placement);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  } else {
    stats.reused++;
    // Keep the entry young: the oldest goes first.
    memo.delete(key);
    memo.set(key, placement);
  }
  const p = placement;
  const nodes: LaidNode[] = scene.cards.map((card, i) => {
    const s = sizes[i];
    const c = p.centres.get(card.key)!;
    return { key: card.key, x: c.x - s.width / 2, y: c.y - s.height / 2, ...s, card };
  });
  const frames: LaidFrame[] = scene.frames.flatMap((f: Frame) => {
    const b = p.frames.get(f.key);
    return b === undefined ? [] : [{ key: f.key, bubbleKey: f.bubbleKey, title: f.title, ...b }];
  });
  const edges: LaidEdge[] = flows.map((flow, index) => {
    const points = p.paths[index];
    const { width, height } = labels[index];
    const at = points.length > 0 ? labelPlacement(points, width, height) : { x: 0, y: 0 };
    return {
      index,
      flow,
      points,
      label: flow.label,
      labelLines: flow.labelLines,
      labelX: at.x,
      labelY: at.y - p.stack[index],
      labelWidth: width,
      labelHeight: height,
    };
  });
  return { nodes, frames, edges, flows, width: p.width, height: p.height };
}

/** One site's picture, as ADR-0050 drew it: a card per group and a line per connection. */
export function layoutSite(site: PlannerSite, graph: ProductionGraph): SiteLayout {
  return layoutScene(siteScene(site, graph), graph.topologyHash);
}
