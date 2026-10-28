import dagre from "@dagrejs/dagre";
import type { PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { bundleFlows, groupCard, siteScene, type Card, type CanvasFlow, type Frame, type Scene } from "./canvasScene";
import { buildingIconUrl } from "./buildingIcons";
import { BUBBLE_D, bubbleRow, bubblesWidth, edgeKeyOf, type BubbleRow } from "./bubbleRow";
import { routeOrthogonal } from "./orthogonalRoute";
import { GLYPH_HALO_RADIUS, GLYPH_SIZE } from "./transportModes";

// Sizes are SVG user units, tied to the canvas's text classes (a factory's name and the "×N" badge `text-base` 16 px
// semibold, body lines and edge labels `text-sm` 14 px). A card is icon-first: the building's icon at the top-left with
// the "×N" count beside it, then its lines (LINE_H each, the baseline of line i at `cardLineY(i)`).
export const CHAR_W_TITLE = 9.2;
export const CHAR_W_BODY = 7.7;
export const NODE_PAD_X = 10;
export const NODE_PAD_Y = 5;
/** The upstream pill (collapse upstream) straddles a card's bottom edge: its height, and the room a card keeps for its upper half. */
export const PILL_H = 24;
export const PILL_RESERVE = PILL_H / 2 + 2;
export const LINE_H = 20;
export const NODE_MIN_W = 100;
/** The building icon on a card: a square at the card's top-left (`ICON_TOP` from its top), and the gap before the count badge. */
export const BUILDING_ICON_SIZE = 40;
export const BUILDING_ICON_GAP = 8;
export const ICON_TOP = 8;
/** The "×N" count badge beside the icon: its height and the padding either side of its text. */
export const COUNT_BADGE_H = 24;
export const COUNT_BADGE_PAD = 8;
/** The gap between the icon row and the first line. */
const LINES_GAP = 4;
/** Where the lines start, and how far a line's baseline sits above its row's bottom. */
const LINES_TOP = ICON_TOP + BUILDING_ICON_SIZE + LINES_GAP;
const BASELINE_UP = 5;
/** The baseline of a card's line `i`. */
export const cardLineY = (i: number): number => LINES_TOP + LINE_H * (i + 1) - BASELINE_UP;
/** The middle of a card's line `i`, where a mark drawn in its row is centred. */
export const cardLineMid = (i: number): number => LINES_TOP + LINE_H * i + LINE_H / 2;
/** The width of the "×N" badge for a count. */
export const countBadgeWidth = (count: number): number => `×${count}`.length * CHAR_W_TITLE + 2 * COUNT_BADGE_PAD;
export const LABEL_H = 18;
/** One line of an edge label (`text-sm` 14 px). */
export const LABEL_LINE_H = 16;
export const LABEL_PAD = 4;
/** The gap between an edge label and the line it names. */
export const LABEL_GAP = 4;
/** Dagre's spacing, tight on purpose: a fit should show the drawing, so the ranks and rows sit close. */
export const RANK_SEP = 40;
export const NODE_SEP = 20;
/** The least room between two vertical tracks in one gap (and between a track and a column): side by side, lines stay
 *  visibly apart (8 read as one thick line on the owner's save, 2026-10-27). A gap with more tracks than fit widens. */
export const TRACK_GAP = 12;
/** The graph's margin, and the height of the tab on an expanded bubble's frame that holds its title and its Collapse button (half of it stands above the frame's top edge). */
export const MARGIN = 16;
export const FRAME_HEADER_H = 22;
/** A transport edge's label clears the glyph on the line's middle by this much more. */
export const GLYPH_CLEARANCE = GLYPH_SIZE / 2;

export interface LaidNode {
  key: string;
  /** The top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  /** The building's icon, when its class has one; the card draws its kind's glyph otherwise. */
  iconUrl: string | undefined;
  card: Card;
}

export interface LaidFrame {
  key: string;
  bubbleKey: string;
  title: string;
  /** A blow-up's (ADR-0061 Decision 5): the card it replaced, its parent frame and its words (see `Frame`). */
  expands?: string | undefined;
  parent?: string | undefined;
  description?: string | undefined;
  x: number;
  y: number;
  width: number;
  /** Including the header strip. */
  height: number;
}

export interface LaidEdge {
  /** Index into `SiteLayout.flows` of the first link the line draws: unique per edge, its React key. */
  index: number;
  /** Every link the line draws, as indexes into `SiteLayout.flows` (one, or a bundle's: see `bundleFlows`). */
  parts: number[];
  /** What the line draws: the link, or the bundle of links between the same two cards (with `parts` of its own). */
  flow: CanvasFlow;
  /** The path, from the source card's side to the destination's. */
  points: { x: number; y: number }[];
  /** The label in one line (the tooltip's words). */
  label: string;
  /** The label in words: one to three lines (the canvas draws `bubbles`; these stay for text views and tests). */
  labelLines: string[];
  /** What the label box draws (ADR-0060 Decision 1): an icon bubble per item (up to three, then "+k"), and the rate text. */
  bubbles: BubbleRow;
  /** The label's centre: just above the middle of the path (see `labelPlacement`). */
  labelX: number;
  labelY: number;
  /** The label box's estimated width and height. */
  labelWidth: number;
  labelHeight: number;
  /** The words' centre: the label's, or right of it by half the glyph's inset when the pill also holds a transport glyph. */
  textX: number;
  /** The middle of the path by length, where a transport's glyph sits, and the path's length. */
  mid: { x: number; y: number };
  length: number;
}

export interface SiteLayout {
  nodes: LaidNode[];
  frames: LaidFrame[];
  edges: LaidEdge[];
  /** The links the layout was given (those with both ends drawn), one per link even when a line draws several, in the
   *  order `LaidEdge.index` and `LaidEdge.parts` refer to. The item filter walks these. */
  flows: CanvasFlow[];
  width: number;
  height: number;
  /** How long dagre and the router took for this placement (remembered with it: a memo hit reports the first run's). */
  placeMs: number;
}

/** Make room for a focused line (ADR-0060 Decision 3): its label box is reserved at this size. */
export interface LayoutFocus {
  edgeKey: string;
  width: number;
  height: number;
}

/** The detail card's size in layout units, which a focused line's label box makes room for (ADR-0060 Decision 3). */
export const FOCUS_CARD_W = 220;
export const FOCUS_CARD_H = 200;
/** Past this, a focused layout is too slow to make room: focus dims only (ADR-0060 Decision 3's guard). */
export const FOCUS_LAYOUT_BUDGET_MS = 100;

type CardSize = Pick<LaidNode, "width" | "height" | "title" | "lines" | "iconUrl">;

/** Whether a line is drawn as a heading (`text-base`, semibold): a factory card's name. */
export const isHeadingLine = (card: Pick<Card, "kind">, i: number): boolean => card.kind === "factory" && i === 0;

/** A card's size: as wide as its icon row or its longest line, as tall as the icon row and its lines. A group opened into
 *  its machines is the frame round their grid (`machineFrameSize`). */
export function cardSize(card: Card): CardSize {
  const iconUrl = card.className === undefined ? undefined : buildingIconUrl(card.className);
  const reserve = card.upstream === undefined ? 0 : PILL_RESERVE;
  if (card.machines?.open === true) {
    const frame = machineFrameSize(machineSlots(card.machines), card.title.length);
    return { title: card.title, lines: card.lines, iconUrl, width: frame.width, height: frame.height + reserve };
  }
  const row = BUILDING_ICON_SIZE + (card.count === undefined ? 0 : BUILDING_ICON_GAP + countBadgeWidth(card.count));
  const text = Math.max(row, ...card.lines.map((l, i) => l.length * (isHeadingLine(card, i) ? CHAR_W_TITLE : CHAR_W_BODY)));
  // A card that can open into its machines (or blow up, ADR-0061 Decision 5) keeps room for its Expand pill (at the bottom
  // right) beside the upstream one.
  const expandable = card.machines !== undefined || card.blowUp !== undefined;
  return {
    title: card.title,
    lines: card.lines,
    iconUrl,
    width: Math.max(expandable ? EXPANDABLE_MIN_W : NODE_MIN_W, Math.ceil(text + 2 * NODE_PAD_X)),
    // A card with an upstream (or Expand) pill makes room below its text for the pill's upper half.
    height: Math.ceil(LINES_TOP + card.lines.length * LINE_H + NODE_PAD_Y + (reserve > 0 || expandable ? PILL_RESERVE : 0)),
  };
}

// ---- a group opened into its machines --------------------------------------------------------------------------------

/** The Collapse pill in a frame's header (an opened bubble's, an opened group's), and the Expand pill on a group card. */
export const COLLAPSE_W = 76;
export const EXPAND_W = 68;
/** The invisible target round a pill: its height grown to the touch size (`--spacing-touch`), centred on the pill. */
export const PILL_HIT = 44;
/**
 * How far a nested frame's top edge stands below its parent's (ADR-0061 Decision 5). Both Collapse pills sit at their own
 * frame's right edge, and the parent's inset is only dagre's padding, so they line up: a full touch target apart, their
 * hit rects only meet, and the title tabs keep `PILL_HIT - FRAME_HEADER_H` between them.
 */
export const NESTED_FRAME_RISE = PILL_HIT;
/** A group card that can open is at least this wide: its upstream pill, the Expand pill and the gaps round them. */
export const EXPANDABLE_MIN_W = 8 + 48 + 8 + EXPAND_W + 8;
/** One machine's card in an opened group: three `text-sm` lines (its name, its state, its output or fuel). */
export const MACHINE_CARD_W = 192;
export const MACHINE_LINES = 3;
export const MACHINE_CARD_H = 2 * NODE_PAD_Y + MACHINE_LINES * LINE_H;
export const MACHINE_GAP = 8;
/** The opened group's header strip, inside its frame: the title on the left, Collapse on the right. */
export const MACHINE_HEADER_H = FRAME_HEADER_H + 2 * NODE_PAD_Y;
/** The characters a machine card's line holds before it is cut (the full words are in its button and tooltip). */
export const MACHINE_LINE_CHARS = Math.floor((MACHINE_CARD_W - 2 * NODE_PAD_X) / CHAR_W_BODY);

/** The baseline of a machine card's line `i`. */
export const machineLineY = (i: number): number => NODE_PAD_Y + LINE_H * (i + 1) - BASELINE_UP;
/** How many cards an opened group draws: one per shown machine, and the "+k more" card when there are more. */
export const machineSlots = (m: { ids: readonly string[]; more: number }): number => m.ids.length + (m.more > 0 ? 1 : 0);
/** The grid's columns: near square, so a frame of eight is three by three, of 49 seven by seven. */
export const machineColumns = (n: number): number => Math.max(1, Math.ceil(Math.sqrt(n)));

/** The top-left of machine card `i` in its frame, relative to the frame's corner. */
export function machineSlot(i: number, n: number): Point {
  const cols = machineColumns(n);
  return { x: NODE_PAD_X + (i % cols) * (MACHINE_CARD_W + MACHINE_GAP), y: MACHINE_HEADER_H + Math.floor(i / cols) * (MACHINE_CARD_H + MACHINE_GAP) };
}

/** The frame round `n` machine cards: the grid with padding, under the header, and at least as wide as the title and Collapse. */
export function machineFrameSize(n: number, titleChars: number): { width: number; height: number } {
  const cols = machineColumns(n);
  const rows = Math.max(1, Math.ceil(n / cols));
  const grid = cols * MACHINE_CARD_W + (cols - 1) * MACHINE_GAP;
  return {
    width: Math.ceil(Math.max(grid + 2 * NODE_PAD_X, titleChars * CHAR_W_BODY + COLLAPSE_W + 3 * NODE_PAD_X)),
    height: MACHINE_HEADER_H + rows * MACHINE_CARD_H + (rows - 1) * MACHINE_GAP + NODE_PAD_X,
  };
}

/** A group's card size, from the group alone. */
export function nodeSize(node: PlannerNode): CardSize {
  return cardSize(groupCard(node));
}

/** The estimated width of an edge label's text. */
export const labelWidth = (text: string) => Math.ceil(text.length * CHAR_W_BODY + LABEL_PAD);

/** A label box's size from its lines: as wide as the longest, as tall as the lines (each `LABEL_LINE_H`) plus padding. */
export const labelSize = (lines: readonly string[]) => ({
  width: Math.max(0, ...lines.map(labelWidth)),
  height: lines.length * LABEL_LINE_H + LABEL_PAD,
});

/** The box dagre reserves for a line's bubble row (ADR-0060 Decision 1): as wide as the bubbles or the rate text, as tall
 *  as a bubble plus the text's line. */
export const bubbleRowSize = (row: BubbleRow) => ({
  width: Math.max(bubblesWidth(row) + LABEL_PAD, row.rateText === null ? 0 : labelWidth(row.rateText)),
  height: BUBBLE_D + (row.rateText === null ? 0 : LABEL_LINE_H) + LABEL_PAD,
});

type Point = { x: number; y: number };

const lengthOf = (points: readonly Point[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
};

/** Where along its path (0 to 1, by length) an edge's `mid` stands when no label holds a glyph (a plain belt or pipe). */
export const GLYPH_AT = 0.3;
/** The room a transport's glyph takes at the left of its label pill: the glyph's halo (wider than its 24-unit box) and the
 *  gap before the bubbles, so the glyph at rest never touches them. */
export const GLYPH_INSET = 2 * GLYPH_HALO_RADIUS + LABEL_PAD;
/** A line's label pill as a box (the size it is drawn at, centred where the layout put it). */
export const labelBox = (e: Pick<LaidEdge, "labelX" | "labelY" | "labelWidth" | "labelHeight">) => ({
  x: e.labelX - e.labelWidth / 2,
  y: e.labelY - e.labelHeight / 2,
  width: e.labelWidth,
  height: e.labelHeight,
});
/** Where a transport's glyph stands at rest: inside its pill, at the left, its halo `LABEL_PAD / 2` from the pill's edge. */
export const glyphRestCentre = (labelX: number, labelY: number, pillWidth: number): Point => ({ x: labelX - pillWidth / 2 + LABEL_PAD / 2 + GLYPH_HALO_RADIUS, y: labelY });

/** The point `fraction` of the way along a path by length, halfway by default (the first point of a path with no length, the origin of an empty one). */
export function pathMidpoint(points: readonly Point[], fraction = 0.5): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let rest = lengthOf(points) * Math.min(1, Math.max(0, fraction));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0 || rest > len) {
      rest -= len;
      continue;
    }
    const t = rest / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return { ...points[points.length - 1] };
}

/**
 * Where an edge's label goes: the centre of a `width` x `LABEL_H` box beside the path's middle (by length), pushed off the
 * segment along its normal, on the upper side (the right when the segment is vertical), far enough that the box clears the
 * line by `LABEL_GAP` (and by `extra` more, for the glyph on a transport's middle). So a level edge's label sits just above
 * it and a steep one's beside it. A path with no length puts the label on its point.
 */
export function labelPlacement(points: readonly Point[], width: number, height = LABEL_H, extra = 0): Point {
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
    const d = Math.abs(nx) * (width / 2) + Math.abs(ny) * (height / 2) + LABEL_GAP + extra;
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
  /** Each flow's label centre in the box dagre reserved for it (clear of cards and other labels), or null when the placement
   *  has no such box (the grid fallback), so the label goes beside the path's middle as before. */
  labelAt: (Point | null)[];
  width: number;
  height: number;
  /** How long placing took, kept with the placement so a memo hit still knows whether it was too slow (ADR-0060 D3). */
  ms: number;
}

/** What the placers return; `layoutScene` adds how long they took. */
type Placed = Omit<Placement, "ms">;

const MEMO_LIMIT = 12;
const memo = new Map<string, Placement>();
const stats = { computed: 0, reused: 0, lastMs: 0, slowestMs: 0, routerFailures: 0 };

/** For tests and the timing guard: how many layouts dagre ran, how many the memo answered, and how long dagre took. */
export const layoutStats = () => ({ ...stats });
export function clearLayoutMemo(): void {
  memo.clear();
  stats.computed = 0;
  stats.reused = 0;
  stats.lastMs = 0;
  stats.slowestMs = 0;
  stats.routerFailures = 0;
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
  // A blow-up's frame names its parent frame: the same cards nested otherwise are another placement.
  const frames = scene.frames.map((f) => `${f.key}\u0001${f.parent ?? ""}\u0001${f.cardKeys.join("\u0003")}`).join("\u0002");
  const flows = drawn.map((f, i) => `${f.from}\u0001${f.to}\u0001${labels[i].width}\u0001${labels[i].height}\u0001${isTransport(f) ? "t" : "b"}`).join("\u0002");
  return hashOf(`${cards}\u0004${frames}\u0004${flows}`);
}

export const isTransport = (flow: Pick<CanvasFlow, "carrier">): boolean => flow.carrier !== "belt" && flow.carrier !== "pipe";

type Box = { x: number; y: number; width: number; height: number };
type LabelBox = { width: number; height: number };

/**
 * The flows that close a loop, by a depth-first search that starts from the sources (cards no flow enters), then from any
 * card not yet reached, in scene order: a flow into a card still on the search's path is a return. Starting inside a loop
 * instead (dagre's own search starts from the first card listed) reversed a forward flow and left the return pointing on.
 */
export function returnFlows(cardKeys: readonly string[], flows: readonly { from: string; to: string }[]): Set<number> {
  const out = new Map<string, number[]>();
  const entered = new Set<string>();
  flows.forEach((f, i) => {
    out.set(f.from, [...(out.get(f.from) ?? []), i]);
    if (f.from !== f.to) entered.add(f.to);
  });
  const returns = new Set<number>();
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (start: string) => {
    // Iterative, so a long chain cannot overflow the stack: each frame is a card and its next outgoing flow.
    const frames: { key: string; next: number }[] = [{ key: start, next: 0 }];
    onPath.add(start);
    while (frames.length > 0) {
      const top = frames[frames.length - 1];
      const leaving = out.get(top.key) ?? [];
      if (top.next >= leaving.length) {
        frames.pop();
        onPath.delete(top.key);
        done.add(top.key);
        continue;
      }
      const i = leaving[top.next++];
      const to = flows[i].to;
      if (onPath.has(to)) returns.add(i);
      else if (!done.has(to)) {
        onPath.add(to);
        frames.push({ key: to, next: 0 });
      }
    }
  };
  for (const k of cardKeys) if (!entered.has(k) && !done.has(k)) visit(k);
  for (const k of cardKeys) if (!done.has(k)) visit(k);
  return returns;
}

/**
 * Dagre, once, then our router. `merged` gives each pair of cards one edge (the labels of its flows stacked into one box,
 * the flows drawn over the same path with their labels one above the other): the fallback for shapes dagre's multigraph
 * handling cannot route (it throws "Not possible to find intersection inside of the rectangle" on some parallel edges that
 * skip a rank).
 */
function placeWith(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[], labels: readonly LabelBox[], merged: boolean): Placed {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  const nodesep = scene.frames.length > 0 ? NODE_SEP + FRAME_HEADER_H / 2 : NODE_SEP;
  // Loops are broken here (`returnFlows`), so dagre gets a graph without cycles. `tight-tree` gave the fewest crossings
  // under the orthogonal router (ADR-0059).
  // A frame inside a frame grows its parent upward to clear its tab and pill (`roomForNestedTabs`): the margin keeps that inside.
  const nested = scene.frames.some((f) => f.parent !== undefined);
  g.setGraph({ rankdir: "LR", ranker: "tight-tree", nodesep, ranksep: RANK_SEP, edgesep: 10, marginx: MARGIN, marginy: nested ? MARGIN + NESTED_FRAME_RISE : MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  scene.cards.forEach((c, i) => g.setNode(c.key, { width: sizes[i].width, height: sizes[i].height }));
  for (const f of scene.frames) {
    g.setNode(f.key, {});
    for (const k of f.cardKeys) g.setParent(k, f.key);
  }
  // A blow-up inside a blow-up (ADR-0061 Decision 5) is a compound node inside a compound node.
  const frameKeys = new Set(scene.frames.map((f) => f.key));
  for (const f of scene.frames) if (f.parent !== undefined && frameKeys.has(f.parent)) g.setParent(f.key, f.parent);
  // Each flow as dagre sees it: a return flow reversed, so its route comes back target to source and is flipped below.
  const returns = returnFlows(
    scene.cards.map((c) => c.key),
    drawn,
  );
  const ends = (i: number): [string, string] => (returns.has(i) ? [drawn[i].to, drawn[i].from] : [drawn[i].from, drawn[i].to]);
  // Which dagre edge draws each flow, and how far up its label stands from the first one's.
  const edgeOf: string[] = [];
  const stack: number[] = drawn.map(() => 0);
  if (merged) {
    const groups = new Map<string, number[]>();
    drawn.forEach((_, i) => {
      const pair = ends(i).join("\u0001");
      const list = groups.get(pair);
      if (list === undefined) groups.set(pair, [i]);
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
      const [v, w] = ends(members[0]);
      g.setEdge(v, w, { width: Math.max(...members.map((i) => labels[i].width)), height: above, labelpos: "c" }, name);
    }
  } else {
    drawn.forEach((_, i) => {
      edgeOf[i] = String(i);
      const [v, w] = ends(i);
      g.setEdge(v, w, { ...labels[i], labelpos: "c" }, String(i));
    });
  }
  dagre.layout(g);
  const edgeAt = (i: number) => {
    const [v, w] = ends(i);
    return g.edge(v, w, edgeOf[i]) as { points?: Point[]; x?: number; y?: number; height?: number };
  };

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
  roomForNestedTabs(scene.frames, frames);
  // Every route source to target, a return flow's turned back round.
  const paths = drawn.map((_, i) => {
    const route = (edgeAt(i).points ?? []).map((p: Point) => ({ x: p.x, y: p.y }));
    return returns.has(i) ? route.reverse() : route;
  });
  // The label box dagre made room for: its centre, and for merged flows each label's row in it, top down. Placing a label
  // anywhere else (the path's middle) put it on cards, other labels and other lines.
  const labelAt = drawn.map((_, i): Point | null => {
    const d = edgeAt(i);
    if (d.x === undefined || d.y === undefined || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
    return { x: d.x, y: d.y - (d.height ?? labels[i].height) / 2 + stack[i] + labels[i].height / 2 };
  });
  // An empty graph comes back from dagre with width and height -Infinity.
  const { width, height } = g.graph();
  const placed: Placed = { centres, frames, paths, stack, labelAt, width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
  try {
    return routed(scene, sizes, drawn, labels, placed, (i) => {
      const d = edgeAt(i);
      const inner = paths[i].slice(1, -1);
      const k = d.x === undefined || d.y === undefined ? -1 : inner.findIndex((p: Point) => Math.abs(p.x - d.x!) < 0.5 && Math.abs(p.y - d.y!) < 0.5);
      return k < 0 ? undefined : k;
    });
  } catch {
    // Our router failing on a shape: dagre's own routes still draw every flow (corners left sharp).
    stats.routerFailures++;
    return placed;
  }
}

/**
 * A blow-up inside a blow-up (ADR-0061 Decision 5): dagre leaves less room between a compound node's border and a nested
 * one's than the nested frame's tab needs (half of it stands above its top edge), so the tabs would overlap, and the two
 * Collapse pills, one above the other at the right edge, would share their touch targets. Each frame that holds another
 * grows upward until its top is `NESTED_FRAME_RISE` above the inner one's, innermost first so the growth reaches the top.
 * Frames are listed before the blow-ups inside them.
 */
export function roomForNestedTabs(list: readonly Pick<Frame, "key" | "parent">[], boxes: Map<string, Box>): void {
  for (const f of [...list].reverse()) {
    const parent = f.parent === undefined ? undefined : boxes.get(f.parent);
    const inner = boxes.get(f.key);
    if (parent === undefined || inner === undefined) continue;
    const top = inner.y - NESTED_FRAME_RISE;
    if (parent.y <= top) continue;
    boxes.set(f.parent!, { ...parent, y: top, height: parent.height + (parent.y - top) });
  }
}

/**
 * ADR-0059: dagre's placement redrawn by our orthogonal router. Every leg changes height only in the empty gap between two
 * columns, on a track of its own, so no line crosses a card; cards move only where a gap had to widen for its tracks.
 */
function routed(
  scene: Scene,
  sizes: readonly CardSize[],
  drawn: readonly CanvasFlow[],
  labels: readonly LabelBox[],
  placed: Placed,
  labelWaypoint: (flow: number) => number | undefined,
): Placed {
  const cards = scene.cards.map((c, i) => {
    const centre = placed.centres.get(c.key)!;
    return { key: c.key, x: centre.x - sizes[i].width / 2, y: centre.y - sizes[i].height / 2, width: sizes[i].width, height: sizes[i].height };
  });
  const frameKeys = scene.frames.filter((f) => placed.frames.has(f.key)).map((f) => f.key);
  const out = routeOrthogonal(
    {
      cards,
      edges: drawn.map((f, i) => {
        const waypoints = placed.paths[i].slice(1, -1);
        const label = labelWaypoint(i);
        // Each edge runs through its own label: in the merged form the flows of a pair share one dagre route, whose label
        // point is the middle of their stacked labels, so every line ran across the middle label (2026-10-27). Its own
        // row's centre instead; in the separate form that is the same point.
        const at = placed.labelAt[i];
        if (label !== undefined && at !== null) waypoints[label] = { x: waypoints[label].x, y: at.y };
        return { from: f.from, to: f.to, waypoints, label };
      }),
      labels: drawn.map((_, i) => {
        const at = placed.labelAt[i];
        return at === null ? undefined : { x: at.x - labels[i].width / 2, y: at.y - labels[i].height / 2, width: labels[i].width, height: labels[i].height };
      }),
      frames: frameKeys.map((k) => placed.frames.get(k)!),
    },
    { straighten: true, track: TRACK_GAP },
  );
  const centres = new Map(out.cards.map((c) => [c.key, { x: c.x + c.width / 2, y: c.y + c.height / 2 }]));
  const frames = new Map(frameKeys.map((k, i) => [k, out.frames[i]]));
  const labelAt = out.labels.map((b, i) => (b === undefined ? placed.labelAt[i] : { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  return { ...placed, centres, frames, paths: out.paths, labelAt, width: placed.width + out.widened };
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
function placeGrid(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[]): Placed {
  const cols = Math.max(1, Math.ceil(Math.sqrt(scene.cards.length)));
  const cellW = Math.max(NODE_MIN_W, ...sizes.map((s) => s.width)) + RANK_SEP;
  const cellH = Math.max(0, ...sizes.map((s) => s.height)) + NODE_SEP + FRAME_HEADER_H;
  // Room above the first row for a frame's tab, or for a parent frame grown above a nested one (`roomForNestedTabs`).
  const head = scene.frames.some((f) => f.parent !== undefined) ? NESTED_FRAME_RISE : FRAME_HEADER_H;
  const centres = new Map<string, Point>();
  scene.cards.forEach((c, i) => centres.set(c.key, { x: MARGIN + (i % cols) * cellW + cellW / 2, y: MARGIN + head + Math.floor(i / cols) * cellH + cellH / 2 }));
  const sizeOf = new Map(scene.cards.map((c, i) => [c.key, sizes[i]]));
  const frames = new Map<string, Box>();
  // Innermost first (a frame is listed before the blow-ups inside it), so a frame's box holds its nested frames' boxes.
  for (const f of [...scene.frames].reverse()) {
    const boxes = [
      ...f.cardKeys.flatMap((k) => (centres.has(k) ? [{ x: centres.get(k)!.x - sizeOf.get(k)!.width / 2, y: centres.get(k)!.y - sizeOf.get(k)!.height / 2, ...sizeOf.get(k)! }] : [])),
      ...scene.frames.flatMap((inner) => (inner.parent === f.key && frames.has(inner.key) ? [frames.get(inner.key)!] : [])),
    ];
    if (boxes.length === 0) continue;
    const left = Math.min(...boxes.map((b) => b.x)) - NODE_SEP / 2;
    const right = Math.max(...boxes.map((b) => b.x + b.width)) + NODE_SEP / 2;
    const topEdge = Math.min(...boxes.map((b) => b.y)) - NODE_SEP / 2;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + NODE_SEP / 2;
    frames.set(f.key, { x: left, y: topEdge, width: right - left, height: bottom - topEdge });
    // Grown now, before its parent is boxed round it.
    roomForNestedTabs(scene.frames.filter((inner) => inner.parent === f.key), frames);
  }
  const paths = drawn.map((f) => {
    const a = centres.get(f.from)!;
    const b = centres.get(f.to)!;
    return [leaves(a, sizeOf.get(f.from)!, b), leaves(b, sizeOf.get(f.to)!, a)];
  });
  const rows = Math.ceil(scene.cards.length / cols);
  return { centres, frames, paths, stack: drawn.map(() => 0), labelAt: drawn.map(() => null), width: MARGIN * 2 + cols * cellW, height: MARGIN * 2 + head + rows * cellH };
}

function place(scene: Scene, sizes: readonly CardSize[], drawn: readonly CanvasFlow[], labels: readonly LabelBox[]): Placed {
  // Separate first: each flow gets its own label box and, from the router, its own track (ADR-0059 measured this form).
  // Merged (one dagre edge per pair of cards, labels stacked in its box) is the fallback for shapes dagre cannot route.
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
 *
 * With `focus` (ADR-0060 Decision 3, make room), the focused line's label box is reserved at the detail card's size, so
 * dagre and the router move the rest aside; the pill itself is still drawn at its own size, centred in that box. The box
 * size is in the memo key, so the focused layout is remembered too and closing returns to the overview's at no cost.
 */
export function layoutScene(scene: Scene, topologyHash?: string, focus?: LayoutFocus): SiteLayout {
  const own = scene.cards.map(cardSize);
  // The overview's factory cards are peers: one height, so the row reads evenly (a blown-up factory's groups keep theirs).
  const peer = (i: number) => scene.cards[i].kind === "factory";
  const tallest = scene.level === "overview" ? Math.max(0, ...own.filter((_, i) => peer(i)).map((s) => s.height)) : 0;
  const sizes = tallest === 0 ? own : own.map((s, i) => (peer(i) ? { ...s, height: tallest } : s));
  const known = new Set(scene.cards.map((c) => c.key));
  const flows = scene.flows.filter((f) => known.has(f.from) && known.has(f.to));
  // Links between the same two cards on the same carrier are one line with one label (2026-10-27); `parts` keeps each.
  const bundles = bundleFlows(flows);
  const drawn = bundles.map((b) => b.flow);
  // Each label is a bubble row; a transport's also holds its mode's glyph, at the pill's left: dagre reserves room for both.
  const rows = drawn.map(bubbleRow);
  const pills = drawn.map((f, k) => {
    const s = bubbleRowSize(rows[k]);
    return isTransport(f) ? { ...s, width: s.width + GLYPH_INSET } : s;
  });
  const labels =
    focus === undefined ? pills : drawn.map((f, k) => (edgeKeyOf(f) === focus.edgeKey ? { width: Math.max(pills[k].width, focus.width), height: Math.max(pills[k].height, focus.height) } : pills[k]));
  const key = `${topologyHash ?? ""}|${scene.level}|${signature(scene, sizes, labels, drawn)}`;
  let placement = memo.get(key);
  if (placement === undefined) {
    const start = performance.now();
    const placed = place(scene, sizes, drawn, labels);
    stats.lastMs = performance.now() - start;
    placement = { ...placed, ms: stats.lastMs };
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
    if (b === undefined) return [];
    const blown = f.expands === undefined ? {} : { expands: f.expands, parent: f.parent, description: f.description };
    return [{ key: f.key, bubbleKey: f.bubbleKey, title: f.title, ...blown, ...b }];
  });
  // A transport's glyph stands in its own label pill, at the left, so no label can cover it and parallel transports (one
  // path, stacked labels) each keep theirs; a moving glyph travels the path instead (SiteGraph's Edge).
  const edges: LaidEdge[] = drawn.map((flow, k) => {
    const points = p.paths[k];
    // The pill is drawn at its own size, centred in the box reserved for it (larger only for a focused line).
    const { width, height } = pills[k];
    const own = p.labelAt[k];
    const beside = own === null && points.length > 0 ? labelPlacement(points, labels[k].width, labels[k].height) : { x: 0, y: 0 };
    const labelX = own?.x ?? beside.x;
    const labelY = own?.y ?? beside.y - p.stack[k];
    const transport = isTransport(flow);
    return {
      index: bundles[k].members[0],
      parts: bundles[k].members,
      flow,
      points,
      label: flow.label,
      labelLines: flow.labelLines,
      bubbles: rows[k],
      labelX,
      labelY,
      labelWidth: width,
      labelHeight: height,
      textX: transport ? labelX + GLYPH_INSET / 2 : labelX,
      mid: transport ? glyphRestCentre(labelX, labelY, width) : pathMidpoint(points, GLYPH_AT),
      length: lengthOf(points),
    };
  });
  return { nodes, frames, edges, flows, width: p.width, height: p.height, placeMs: p.ms };
}

/** One site's picture, as ADR-0050 drew it: a card per group and a line per connection. */
export function layoutSite(site: PlannerSite, graph: ProductionGraph): SiteLayout {
  return layoutScene(siteScene(site, graph), graph.topologyHash);
}
