import dagre from "@dagrejs/dagre";
import type { PlannerEdge, PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { siteNodes } from "../plannerText";
import { buildingIconUrl } from "./buildingIcons";
import { edgeLabel, edgeLabelLines, nodeBody, nodeTitle } from "./graphModel";

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

export interface LaidNode {
  key: string;
  /** The top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  /** How many leading `lines` are the recipe (drawn muted). */
  recipeLines: number;
  /** The building's icon, when its class has one; the title then starts `titleX` from the card's left. */
  iconUrl: string | undefined;
  titleX: number;
}

export interface LaidEdge {
  /** Index into `SiteLayout.sourceEdges`. */
  index: number;
  edge: PlannerEdge;
  /** The path, from the source card's side to the destination's. */
  points: { x: number; y: number }[];
  /** The label in one line (the tooltip's words). */
  label: string;
  /** The label as drawn: one or two lines. */
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
  edges: LaidEdge[];
  /** The edges the layout was given (those with both ends in the site), in the order `LaidEdge.index` refers to. */
  sourceEdges: PlannerEdge[];
  width: number;
  height: number;
}

/** A card's size from its text: as wide as its longest line, as tall as its lines. */
export function nodeSize(node: PlannerNode): Pick<LaidNode, "width" | "height" | "title" | "lines" | "recipeLines" | "iconUrl" | "titleX"> {
  const title = nodeTitle(node);
  const { lines, recipeLines } = nodeBody(node);
  const iconUrl = buildingIconUrl(node.className);
  const titleShift = iconUrl === undefined ? 0 : BUILDING_ICON_SIZE + BUILDING_ICON_GAP;
  const text = Math.max(title.length * CHAR_W_TITLE + titleShift, ...lines.map((l) => l.length * CHAR_W_BODY));
  return {
    title,
    lines,
    recipeLines,
    iconUrl,
    titleX: NODE_PAD_X + titleShift,
    width: Math.max(NODE_MIN_W, Math.ceil(text + 2 * NODE_PAD_X)),
    height: Math.ceil(TITLE_H + lines.length * LINE_H + 2 * NODE_PAD_Y),
  };
}

/** The estimated width of an edge label's text. */
export const labelWidth = (text: string) => Math.ceil(text.length * CHAR_W_BODY + LABEL_PAD);

/** A label box's size from its lines: as wide as the longest, as tall as the lines (each `LABEL_LINE_H`) plus padding. */
export const labelSize = (lines: readonly string[]) => ({
  width: Math.max(0, ...lines.map(labelWidth)),
  height: lines.length * LABEL_LINE_H + LABEL_PAD,
});

type Point = { x: number; y: number };

/**
 * Where an edge's label goes: the centre of a `width` x `LABEL_H` box beside the path's middle (by length), pushed off the
 * segment along its normal, on the upper side (the right when the segment is vertical), far enough that the box clears the
 * line by `LABEL_GAP`. So a level edge's label sits just above it and a steep one's beside it. A path with no length puts
 * the label on its point.
 */
export function labelPlacement(points: readonly Point[], width: number, height = LABEL_H): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
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

/**
 * One site's picture (ADR-0050 Decision 3): dagre, left to right (sources left, outputs right), over the site's groups
 * and the connections between them. Pure and deterministic: the same site gives the same positions. A connection with an
 * end outside the site is left out (a site is a connected component, so there are none unless the data is odd).
 */
export function layoutSite(site: PlannerSite, graph: ProductionGraph): SiteLayout {
  const nodes = siteNodes(graph, site);
  const sizes = new Map(nodes.map((n) => [n.key, nodeSize(n)]));
  const sourceEdges = graph.edges.filter((e) => sizes.has(e.from) && sizes.has(e.to));

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", acyclicer: "greedy", ranker: "network-simplex", nodesep: NODE_SEP, ranksep: RANK_SEP, edgesep: 10, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const s = sizes.get(n.key)!;
    g.setNode(n.key, { width: s.width, height: s.height });
  }
  const labels = sourceEdges.map(edgeLabel);
  const lineSets = sourceEdges.map(edgeLabelLines);
  const sizesOfLabels = lineSets.map(labelSize);
  sourceEdges.forEach((e, i) => {
    g.setEdge(e.from, e.to, { ...sizesOfLabels[i], labelpos: "c" }, String(i));
  });
  dagre.layout(g);

  const laidNodes: LaidNode[] = nodes.map((n) => {
    const s = sizes.get(n.key)!;
    const p = g.node(n.key);
    return { key: n.key, x: p.x - s.width / 2, y: p.y - s.height / 2, ...s };
  });
  const laidEdges: LaidEdge[] = sourceEdges.map((edge, index) => {
    const e = g.edge(edge.from, edge.to, String(index));
    const points = e.points ?? [];
    const { width, height } = sizesOfLabels[index];
    const at = points.length > 0 ? labelPlacement(points, width, height) : { x: e.x ?? 0, y: e.y ?? 0 };
    return { index, edge, points, label: labels[index], labelLines: lineSets[index], labelX: at.x, labelY: at.y, labelWidth: width, labelHeight: height };
  });
  // An empty graph comes back from dagre with width and height -Infinity.
  const { width, height } = g.graph();
  return { nodes: laidNodes, edges: laidEdges, sourceEdges, width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}
