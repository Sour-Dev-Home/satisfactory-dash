import { aggregateRateText, shortRateText } from "../plannerText";
import type { CanvasFlow } from "./canvasScene";
import type { FlowQuality } from "./hierarchy";
import { itemIconText } from "./itemIcons";

/** A bubble's diameter and the gap between two (ADR-0060 Decision 1; 40: the owner found 24 too small on the live site,
 *  then 32 still too small, both 2026-10-27). */
export const BUBBLE_D = 40;
export const BUBBLE_GAP = 4;
/** The icon's size inside a bubble: the disc less a thin ring. */
export const BUBBLE_ICON = BUBBLE_D - 4;
/** Below this zoom a bubble is a plain disc: no image, no initials, no rate text (ADR-0060 Decision 7). */
export const BUBBLE_DETAIL_ZOOM = 0.4;

/** How a label draws its bubbles at a zoom: in full (an icon at `iconSize`, initials, rate text) or as plain discs. */
export type BubbleDetail = { full: boolean; iconSize: 32 | 64 };

/** The bubbles' detail at a zoom: full from `BUBBLE_DETAIL_ZOOM`, with the 64 px icon once a 32 px one would be stretched. */
export function bubbleDetail(zoom: number, pixelRatio: number): BubbleDetail {
  return { full: zoom >= BUBBLE_DETAIL_ZOOM, iconSize: zoom * pixelRatio * BUBBLE_ICON > 32 ? 64 : 32 };
}

/** One distinct item a line carries. */
export interface BubbleItem {
  /** `c:<class>`, or `n:<name>` for a classless item (`n:` alone for an unknown one): unique on its line. */
  key: string;
  /** The item class, or null when no part names one. */
  className: string | null;
  /** The game's name for it, or null (an unknown item). */
  name: string | null;
  /** What the bubble shows when there is no icon: initials, or "?". */
  text: string;
  /** The summed rate of the parts carrying it (unknown rates count as 0), for the order. */
  rate: number;
  /** How sure that sum is, by ADR-0053 Decision 3's rule (weakest wins; "at least" when a part has no number). */
  quality: FlowQuality;
}

/** A line's bubbles: its items (one, since `bundleFlows` draws a line per item), and the short rate text drawn under them
 *  (every line has one; "?/min" when unknown). */
export interface BubbleRow {
  items: BubbleItem[];
  rateText: string;
}

const isKnown = (f: CanvasFlow): boolean => f.quality !== "unknown" && f.ratePerMinute !== null && Number.isFinite(f.ratePerMinute);
const rateOf = (f: CanvasFlow): number => (isKnown(f) ? f.ratePerMinute! : 0);

/** The quality of a sum of parts: unknown with no number, "at least" when one is missing, measured only when all are. */
export function summedQuality(parts: readonly CanvasFlow[]): FlowQuality {
  const sure = parts.filter(isKnown);
  if (sure.length === 0) return "unknown";
  if (sure.length < parts.length || parts.some((p) => p.quality === "atLeast")) return "atLeast";
  return parts.every((p) => p.quality === "measured") ? "measured" : "estimated";
}

/**
 * A line's identity across polls (ADR-0060 Decision 2): its ends, carrier, kind, unit and item (ADR-0063 Decision 1),
 * which `bundleFlows` groups by.
 */
export const edgeKeyOf = (flow: Pick<CanvasFlow, "from" | "to" | "carrier" | "flow" | "unit" | "portItem">): string =>
  [flow.from, flow.to, flow.carrier, flow.flow, flow.unit, ...(flow.portItem === undefined ? [] : [flow.portItem])].join("|");

/** An item's key on a line (`BubbleItem.key`): `c:<class>`, or `n:<name>` for a classless one (`n:` for an unknown item). */
export function itemKeyOf(f: Pick<CanvasFlow, "itemClassName" | "itemName">): string {
  const className = f.itemClassName === null || f.itemClassName === "" ? null : f.itemClassName;
  const name = f.itemName === null || f.itemName === "" ? null : f.itemName;
  // Prefixed, so a class "X" and a classless item named "X" stay two items.
  return className !== null ? `c:${className}` : `n:${name ?? ""}`;
}

/** An item's rate in words, for its button and its list row: "about 120 items/min", or "rate unknown". */
export function itemRateText(item: Pick<BubbleItem, "rate" | "quality">, unit: CanvasFlow["unit"]): string {
  return item.quality === "unknown" ? "rate unknown" : aggregateRateText({ quality: item.quality, ratePerMinute: item.rate, unit });
}

/**
 * The distinct items across a line's links (its `parts`, or the link itself), ordered by summed rate, highest first, then
 * by name. Links of no known item share one "?" bubble. The full list stays in the edge's `<title>` and the outline.
 */
export function bubbleItems(flow: CanvasFlow): BubbleItem[] {
  const byKey = new Map<string, { item: BubbleItem; parts: CanvasFlow[] }>();
  for (const p of flow.parts ?? [flow]) {
    const name = p.itemName === null || p.itemName === "" ? null : p.itemName;
    const className = p.itemClassName === null || p.itemClassName === "" ? null : p.itemClassName;
    const key = itemKeyOf(p);
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, { item: { key, className, name, text: itemIconText(name ?? undefined), rate: rateOf(p), quality: "unknown" }, parts: [p] });
    else {
      seen.item.rate += rateOf(p);
      seen.parts.push(p);
    }
  }
  return [...byKey.values()]
    .map(({ item, parts }) => ({ ...item, quality: summedQuality(parts) }))
    .sort((a, b) => b.rate - a.rate || (a.name ?? "￿").localeCompare(b.name ?? "￿"));
}

/**
 * A line's bubble row: its item, and its rate in the canvas's short form
 * (`shortRateText`: "20/min", "~20/min", "?/min"; ADR-0063 amendment, 2026-11-03). "Mixed" and "excess" are not drawn:
 * the line's style says mixed, and both stay in the line's `<title>`, its button and the outline, as ADR-0063 Decision 2
 * rules for end labels.
 */
export function bubbleRow(flow: CanvasFlow): BubbleRow {
  return { items: bubbleItems(flow), rateText: shortRateText(flow) };
}

/** What focus mode holds (ADR-0060 Decision 2): a line by its key, and one of its items by `BubbleItem.key`. */
export type ItemFocus = { edgeKey: string; item: string };

/** One keyboard stop in the bubble layer: a bubble, by its line and its item's key. */
export interface BubbleStop {
  id: string;
  edgeKey: string;
  item: string;
}

/** A stop's id: the line's key and the item's. */
export const stopId = (edgeKey: string, item: string): string => `${edgeKey}#${item}`;

/**
 * The bubble layer's stops in keyboard order (Decision 5): the lines by their source card's place in `order` (the cards'
 * own tab order), then their destination's, and within a line its bubbles left to right.
 */
export function bubbleStops(edges: readonly { flow: CanvasFlow; bubbles: BubbleRow }[], order: readonly string[]): BubbleStop[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  const at = (key: string) => rank.get(key) ?? order.length;
  const lines = [...edges].sort((a, b) => at(a.flow.from) - at(b.flow.from) || at(a.flow.to) - at(b.flow.to));
  return lines.flatMap((e) => {
    const edgeKey = edgeKeyOf(e.flow);
    return e.bubbles.items.map((i) => ({ id: stopId(edgeKey, i.key), edgeKey, item: i.key }));
  });
}

/** A bubble's keyboard name: "<item>, <rate>, from A to B" ("Item unknown" with no name; never an invented one). */
export function bubbleName(item: BubbleItem, unit: CanvasFlow["unit"], from: string, to: string): string {
  return `${item.name ?? "Item unknown"}, ${itemRateText(item, unit)}, from ${from} to ${to}`;
}

/** The width of the bubbles, side by side. */
export function bubblesWidth(row: Pick<BubbleRow, "items">): number {
  const n = row.items.length;
  return n * BUBBLE_D + Math.max(0, n - 1) * BUBBLE_GAP;
}

/** Each bubble's centre x, from the left of the bubbles. */
export function bubbleOffsets(row: Pick<BubbleRow, "items">): number[] {
  return row.items.map((_, i) => i * (BUBBLE_D + BUBBLE_GAP) + BUBBLE_D / 2);
}
