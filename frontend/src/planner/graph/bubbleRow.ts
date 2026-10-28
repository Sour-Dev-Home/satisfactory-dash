import { aggregateRateText } from "../plannerText";
import type { CanvasFlow } from "./canvasScene";
import type { FlowQuality } from "./hierarchy";
import { itemIconText } from "./itemIcons";

/** A bubble's diameter and the gap between two (ADR-0060 Decision 1; 40: the owner found 24 too small on the live site,
 *  then 32 still too small, both 2026-10-27). */
export const BUBBLE_D = 40;
export const BUBBLE_GAP = 4;
/** A line shows at most this many bubbles, then a "+k" chip (owner answer 5). */
export const BUBBLE_MAX = 3;
/** The "+k" chip's width and height, in step with the bubble. */
export const CHIP_W = 38;
export const CHIP_H = 30;
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

/** A line's bubbles: the shown items, every item (for the "+k" list), how many more the chip counts, and the rate text. */
export interface BubbleRow {
  items: BubbleItem[];
  all: BubbleItem[];
  more: number;
  rateText: string | null;
}

const isKnown = (f: CanvasFlow): boolean => f.quality !== "unknown" && f.ratePerMinute !== null && Number.isFinite(f.ratePerMinute);
const rateOf = (f: CanvasFlow): number => (isKnown(f) ? f.ratePerMinute! : 0);

/** The quality of a sum of parts: unknown with no number, "at least" when one is missing, measured only when all are. */
function summedQuality(parts: readonly CanvasFlow[]): FlowQuality {
  const sure = parts.filter(isKnown);
  if (sure.length === 0) return "unknown";
  if (sure.length < parts.length || parts.some((p) => p.quality === "atLeast")) return "atLeast";
  return parts.every((p) => p.quality === "measured") ? "measured" : "estimated";
}

/** A line's identity across polls (ADR-0060 Decision 2): its ends, carrier, kind and unit, which `bundleFlows` groups by. */
export const edgeKeyOf = (flow: Pick<CanvasFlow, "from" | "to" | "carrier" | "flow" | "unit">): string => [flow.from, flow.to, flow.carrier, flow.flow, flow.unit].join("|");

/** An item's rate in words, for its button and its list row: "about 120 items/min", or "rate unknown". */
export function itemRateText(item: Pick<BubbleItem, "rate" | "quality">, unit: CanvasFlow["unit"]): string {
  return item.quality === "unknown" ? "rate unknown" : aggregateRateText({ quality: item.quality, ratePerMinute: item.rate, unit });
}

/**
 * The distinct items across a line's links (its `parts`, or the link itself), ordered by summed rate, highest first, then
 * by name. Links of no known item share one "?" bubble. The full list stays in the edge's `<title>` and the Tables view.
 */
export function bubbleItems(flow: CanvasFlow): BubbleItem[] {
  const byKey = new Map<string, { item: BubbleItem; parts: CanvasFlow[] }>();
  for (const p of flow.parts ?? [flow]) {
    const name = p.itemName === null || p.itemName === "" ? null : p.itemName;
    const className = p.itemClassName === null || p.itemClassName === "" ? null : p.itemClassName;
    // Prefixed, so a class "X" and a classless item named "X" stay two items.
    const key = className !== null ? `c:${className}` : `n:${name ?? ""}`;
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

/** A line's bubble row: up to `BUBBLE_MAX` items, a "+k" for the rest, and its rate text (with "mixed" and "excess"). */
export function bubbleRow(flow: CanvasFlow): BubbleRow {
  const all = bubbleItems(flow);
  const items = all.slice(0, BUBBLE_MAX);
  const rate = flow.quality === "unknown" || flow.ratePerMinute === null ? null : aggregateRateText(flow);
  const words = [...(rate === null ? [] : [rate]), ...(flow.mixed ? ["mixed"] : []), ...(flow.flow === "excess" ? ["excess"] : [])];
  return { items, all, more: all.length - items.length, rateText: words.length === 0 ? null : words.join(" · ") };
}

/** What focus mode holds (ADR-0060 Decision 2): a line by its key, and one of its items by `BubbleItem.key`. */
export type ItemFocus = { edgeKey: string; item: string };

/** One keyboard stop in the bubble layer: a bubble (its item's key) or a line's "+k" chip (`item` null). */
export interface BubbleStop {
  id: string;
  edgeKey: string;
  item: string | null;
}

/** A stop's id: the line's key and the item's, or "+" for the chip. */
export const stopId = (edgeKey: string, item: string | null): string => `${edgeKey}#${item ?? "+"}`;

/**
 * The bubble layer's stops in keyboard order (Decision 5): the lines by their source card's place in `order` (the cards'
 * own tab order), then their destination's, and within a line its bubbles left to right, then its chip.
 */
export function bubbleStops(edges: readonly { flow: CanvasFlow; bubbles: BubbleRow }[], order: readonly string[]): BubbleStop[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  const at = (key: string) => rank.get(key) ?? order.length;
  const lines = [...edges].sort((a, b) => at(a.flow.from) - at(b.flow.from) || at(a.flow.to) - at(b.flow.to));
  return lines.flatMap((e) => {
    const edgeKey = edgeKeyOf(e.flow);
    const bubbles = e.bubbles.items.map((i) => ({ id: stopId(edgeKey, i.key), edgeKey, item: i.key }));
    return e.bubbles.more > 0 ? [...bubbles, { id: stopId(edgeKey, null), edgeKey, item: null }] : bubbles;
  });
}

/** A bubble's keyboard name: "<item>, <rate>, from A to B" ("Item unknown" with no name; never an invented one). */
export function bubbleName(item: BubbleItem, unit: CanvasFlow["unit"], from: string, to: string): string {
  return `${item.name ?? "Item unknown"}, ${itemRateText(item, unit)}, from ${from} to ${to}`;
}

/** The "+k" chip's keyboard name. */
export const chipName = (more: number, from: string, to: string): string => `${more} more ${more === 1 ? "item" : "items"} from ${from} to ${to}`;

/** The width of the bubbles and the chip, side by side. */
export function bubblesWidth(row: Pick<BubbleRow, "items" | "more">): number {
  const n = row.items.length;
  return n * BUBBLE_D + Math.max(0, n - 1) * BUBBLE_GAP + (row.more > 0 ? BUBBLE_GAP + CHIP_W : 0);
}

/** Each bubble's centre x, and the chip's, from the left of the bubbles. */
export function bubbleOffsets(row: Pick<BubbleRow, "items" | "more">): { bubbles: number[]; chip: number | null } {
  const bubbles = row.items.map((_, i) => i * (BUBBLE_D + BUBBLE_GAP) + BUBBLE_D / 2);
  const chip = row.more > 0 ? row.items.length * (BUBBLE_D + BUBBLE_GAP) + CHIP_W / 2 : null;
  return { bubbles, chip };
}
