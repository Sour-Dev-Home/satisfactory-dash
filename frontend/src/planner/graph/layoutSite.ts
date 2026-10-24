import dagre from "@dagrejs/dagre";
import type { PlannerEdge, PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { siteNodes } from "../plannerText";
import { edgeLabel, nodeBodyLines, nodeTitle } from "./graphModel";

// Sizes are SVG user units, tied to the canvas's text classes (title `text-sm` 14 px, body and labels `text-xs` 12 px).
export const CHAR_W_TITLE = 8;
export const CHAR_W_BODY = 6.6;
export const NODE_PAD_X = 12;
export const NODE_PAD_Y = 10;
export const TITLE_H = 20;
export const LINE_H = 16;
export const NODE_MIN_W = 120;
export const LABEL_H = 16;
export const LABEL_PAD = 8;

export interface LaidNode {
  key: string;
  /** The top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
}

export interface LaidEdge {
  /** Index into `SiteLayout.sourceEdges`. */
  index: number;
  edge: PlannerEdge;
  /** The path, from the source card's side to the destination's. */
  points: { x: number; y: number }[];
  label: string;
  /** The label's centre. */
  labelX: number;
  labelY: number;
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
export function nodeSize(node: PlannerNode): Pick<LaidNode, "width" | "height" | "title" | "lines"> {
  const title = nodeTitle(node);
  const lines = nodeBodyLines(node);
  const text = Math.max(title.length * CHAR_W_TITLE, ...lines.map((l) => l.length * CHAR_W_BODY));
  return {
    title,
    lines,
    width: Math.max(NODE_MIN_W, Math.ceil(text + 2 * NODE_PAD_X)),
    height: Math.ceil(TITLE_H + lines.length * LINE_H + 2 * NODE_PAD_Y),
  };
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
  g.setGraph({ rankdir: "LR", acyclicer: "greedy", ranker: "network-simplex", nodesep: 28, ranksep: 90, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const s = sizes.get(n.key)!;
    g.setNode(n.key, { width: s.width, height: s.height });
  }
  const labels = sourceEdges.map(edgeLabel);
  sourceEdges.forEach((e, i) => {
    g.setEdge(e.from, e.to, { width: labels[i].length * CHAR_W_BODY + LABEL_PAD, height: LABEL_H, labelpos: "c" }, String(i));
  });
  dagre.layout(g);

  const laidNodes: LaidNode[] = nodes.map((n) => {
    const s = sizes.get(n.key)!;
    const p = g.node(n.key);
    return { key: n.key, x: p.x - s.width / 2, y: p.y - s.height / 2, ...s };
  });
  const laidEdges: LaidEdge[] = sourceEdges.map((edge, index) => {
    const e = g.edge(edge.from, edge.to, String(index));
    return { index, edge, points: e.points ?? [], label: labels[index], labelX: e.x ?? 0, labelY: e.y ?? 0 };
  });
  const { width = 0, height = 0 } = g.graph();
  return { nodes: laidNodes, edges: laidEdges, sourceEdges, width, height };
}
