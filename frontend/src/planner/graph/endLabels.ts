import { shortRateText } from "../plannerText";
import { segmentHitsRect } from "./edgeShapes";
import type { FlowQuality } from "./hierarchy";
import { LABEL_LINE_H, labelWidth, type LaidEdge, type LaidNode } from "./layoutSite";
import { TRANSPORT_W } from "./lineWidth";
import { END_LABEL_ROW_GAP, PORT_D } from "./ports";

// ADR-0063 Decision 2: a label beside each port, outside the card, the item's name on a row above the line and its rate
// on a row below. The layout keeps a band beside each card side for them (so no track, card or other label enters it),
// and after routing `endLabelFit` checks each label; a line draws its two end labels only when both fit, else its middle
// bubble (owner pick 4). Pure.

/** A port label's name is cut at this many characters ("…"); the full name is in its `<title>`. */
export const END_LABEL_NAME_CHARS = 16;
/** The gap between a port's disc and its label, and between the label and the band's far edge. */
export const END_LABEL_GAP = 4;
/**
 * The rate row's room in the band, in characters. The band is part of the layout, which a poll that only moves rates must
 * not redo (the memo), so it is sized from the item's name and this fixed allowance, never from the live rate. A rate wider
 * than it fails the fit, and its line draws its middle bubble.
 */
export const RATE_ROW_CHARS = 13;
/**
 * Each row's centre, above and below the line: half the widest line, the row gap, half a row. A function, not a constant:
 * this module and layoutSite.ts import each other, so a value from there read while this module loads can be undefined
 * (it made every label's y NaN in the app, though not in the unit tests, which load the two the other way round).
 */
export const rowOffset = (): number => TRANSPORT_W / 2 + END_LABEL_ROW_GAP + LABEL_LINE_H / 2;

export interface EndLabelWords {
  /** As drawn: the item's name cut at `END_LABEL_NAME_CHARS`, or "+N items" for a fold. */
  name: string;
  /** For the `<title>`: the whole name, or the fold's items. */
  fullName: string;
  /** The rate in the canvas's short form (`shortRateText`, ADR-0063 amendment): "20/min", "~20/min", "?/min"; "" for a fold of mixed units. */
  rate: string;
}

type PortWordsInput = {
  item: string;
  items: readonly { name: string | null }[];
  rate: number;
  quality: FlowQuality;
  unit: "items/min" | "m3/min" | null;
};

export function endLabelWords(p: PortWordsInput): EndLabelWords {
  const rate = p.unit === null ? "" : shortRateText({ quality: p.quality, ratePerMinute: p.quality === "unknown" ? null : p.rate, unit: p.unit });
  if (p.item === "+") return { name: `+${p.items.length} items`, fullName: p.items.map((i) => i.name ?? "Item unknown").join(", "), rate };
  const full = p.items[0]?.name ?? "Item unknown";
  const name = full.length > END_LABEL_NAME_CHARS ? `${full.slice(0, END_LABEL_NAME_CHARS - 1)}…` : full;
  return { name, fullName: full, rate };
}

/** The label's drawn width: its wider row. */
export const endLabelWidth = (w: Pick<EndLabelWords, "name" | "rate">): number => Math.max(labelWidth(w.name), w.rate === "" ? 0 : labelWidth(w.rate));

/** The room one port's label needs in its band: the name, or the rate allowance, whichever is wider. */
export const bandLabelWidth = (w: Pick<EndLabelWords, "name">): number => Math.max(labelWidth(w.name), labelWidth("0".repeat(RATE_ROW_CHARS)));

/** A card side's band: from the card's edge, past half the disc and a gap, its widest label, and a gap. 0 with no ports. */
export const bandWidth = (labelWidths: readonly number[]): number => (labelWidths.length === 0 ? 0 : PORT_D / 2 + END_LABEL_GAP + Math.max(...labelWidths) + END_LABEL_GAP);

type Box = { x: number; y: number; width: number; height: number };

/** A port's label where it is drawn, in the picture's coordinates. */
export interface EndLabel extends EndLabelWords {
  /** The rows' anchor: the label's edge next to the disc (`start` right of a right port, `end` left of a left one). */
  x: number;
  anchor: "start" | "end";
  nameY: number;
  rateY: number;
  /** Its whole box, both rows and the line between them. */
  box: Box;
}

/** Where a port's label goes: outside the card, beside its disc, the name above the line and the rate below. */
export function placeEndLabel(at: { x: number; y: number }, side: "l" | "r", words: EndLabelWords): EndLabel {
  const width = endLabelWidth(words);
  const right = side === "r";
  const x = at.x + (right ? 1 : -1) * (PORT_D / 2 + END_LABEL_GAP);
  return {
    ...words,
    x,
    anchor: right ? "start" : "end",
    nameY: at.y - rowOffset(),
    rateY: at.y + rowOffset(),
    box: { x: right ? x : x - width, y: at.y - rowOffset() - LABEL_LINE_H / 2, width, height: 2 * rowOffset() + LABEL_LINE_H },
  };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The first leg of a line at one end: the horizontal run from that end's point to the next. */
function firstLeg(points: readonly { x: number; y: number }[], which: "src" | "tgt"): { x0: number; x1: number } | null {
  if (points.length < 2) return null;
  const [a, b] = which === "src" ? [points[0], points[1]] : [points[points.length - 1], points[points.length - 2]];
  if (Math.abs(a.y - b.y) > 0.01) return null;
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) };
}

/**
 * The fallback rule (Decision 2, owner pick 4), after routing. A port's label fits when, for every line on the port, the
 * label lies over that line's first leg (the run from the port to its first turn), and its box meets no card, no other
 * port's disc, no line's reserved middle box, no other port's label and no line that is not on this port. A line draws
 * its two end labels only when both its ports' labels fit; otherwise its middle bubble. A port whose label does not fit
 * draws none, so all its lines draw their bubbles; other ports are not affected.
 */
export function endLabelFit(
  nodes: readonly Pick<LaidNode, "key" | "x" | "y" | "width" | "height" | "ports">[],
  edges: readonly Pick<LaidEdge, "index" | "points" | "srcPort" | "tgtPort" | "labelX" | "labelY" | "labelWidth" | "labelHeight">[],
  words: ReadonlyMap<string, EndLabelWords>,
): { labels: Map<string, EndLabel>; lines: Set<number> } {
  const discs: { id: string; box: Box }[] = [];
  const candidates = new Map<string, EndLabel>();
  for (const n of nodes) {
    for (const p of n.ports ?? []) {
      const at = { x: n.x + p.x, y: n.y + p.y };
      discs.push({ id: p.id, box: { x: at.x - PORT_D / 2, y: at.y - PORT_D / 2, width: PORT_D, height: PORT_D } });
      const w = words.get(p.id);
      if (w !== undefined) candidates.set(p.id, placeEndLabel(at, p.side, w));
    }
  }
  const middles = edges.map((e) => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight }));
  const onPort = new Map<string, { edge: number; which: "src" | "tgt" }[]>();
  edges.forEach((e, k) => {
    if (e.srcPort !== undefined) onPort.set(e.srcPort, [...(onPort.get(e.srcPort) ?? []), { edge: k, which: "src" }]);
    if (e.tgtPort !== undefined) onPort.set(e.tgtPort, [...(onPort.get(e.tgtPort) ?? []), { edge: k, which: "tgt" }]);
  });
  const fits = (id: string, label: EndLabel): boolean => {
    const mine = onPort.get(id) ?? [];
    const own = new Set(mine.map((m) => m.edge));
    for (const { edge, which } of mine) {
      const leg = firstLeg(edges[edge].points, which);
      if (leg === null || label.box.x < leg.x0 - 0.01 || label.box.x + label.box.width > leg.x1 + 0.01) return false;
    }
    if (nodes.some((n) => overlaps(label.box, n))) return false;
    if (discs.some((d) => d.id !== id && overlaps(label.box, d.box))) return false;
    if (middles.some((m) => overlaps(label.box, m))) return false;
    for (const [other, l] of candidates) if (other !== id && overlaps(label.box, l.box)) return false;
    return !edges.some((e, k) => !own.has(k) && e.points.some((p, i) => i > 0 && segmentHitsRect(e.points[i - 1], p, label.box)));
  };
  const labels = new Map<string, EndLabel>();
  for (const [id, label] of candidates) if (fits(id, label)) labels.set(id, label);
  const lines = new Set<number>();
  for (const e of edges) if (e.srcPort !== undefined && e.tgtPort !== undefined && labels.has(e.srcPort) && labels.has(e.tgtPort)) lines.add(e.index);
  return { labels, lines };
}
