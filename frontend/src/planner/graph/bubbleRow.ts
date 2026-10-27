import { aggregateRateText } from "../plannerText";
import type { CanvasFlow } from "./canvasScene";
import { itemIconText } from "./itemIcons";

/** A bubble's diameter and the gap between two (ADR-0060 Decision 1). */
export const BUBBLE_D = 24;
export const BUBBLE_GAP = 4;
/** A line shows at most this many bubbles, then a "+k" chip (owner answer 5). */
export const BUBBLE_MAX = 3;
/** The "+k" chip's width and height. */
export const CHIP_W = 22;
export const CHIP_H = 18;
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
  /** The item class, or null when no part names one. */
  className: string | null;
  /** The game's name for it, or null (an unknown item). */
  name: string | null;
  /** What the bubble shows when there is no icon: initials, or "?". */
  text: string;
  /** The summed rate of the parts carrying it (unknown rates count as 0), for the order. */
  rate: number;
}

/** A line's bubbles: the shown items, how many more the chip counts, and the short rate text under the row. */
export interface BubbleRow {
  items: BubbleItem[];
  more: number;
  rateText: string | null;
}

const rateOf = (f: CanvasFlow): number => (f.quality === "unknown" || f.ratePerMinute === null || !Number.isFinite(f.ratePerMinute) ? 0 : f.ratePerMinute);

/**
 * The distinct items across a line's links (its `parts`, or the link itself), ordered by summed rate, highest first, then
 * by name. Links of no known item share one "?" bubble. The full list stays in the edge's `<title>` and the Tables view.
 */
export function bubbleItems(flow: CanvasFlow): BubbleItem[] {
  const byKey = new Map<string, BubbleItem>();
  for (const p of flow.parts ?? [flow]) {
    const name = p.itemName === null || p.itemName === "" ? null : p.itemName;
    const className = p.itemClassName === null || p.itemClassName === "" ? null : p.itemClassName;
    const key = className ?? name ?? "";
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, { className, name, text: itemIconText(name ?? undefined), rate: rateOf(p) });
    else seen.rate += rateOf(p);
  }
  return [...byKey.values()].sort((a, b) => b.rate - a.rate || (a.name ?? "￿").localeCompare(b.name ?? "￿"));
}

/** A line's bubble row: up to `BUBBLE_MAX` items, a "+k" for the rest, and its rate text (with "mixed" and "excess"). */
export function bubbleRow(flow: CanvasFlow): BubbleRow {
  const all = bubbleItems(flow);
  const items = all.slice(0, BUBBLE_MAX);
  const rate = flow.quality === "unknown" || flow.ratePerMinute === null ? null : aggregateRateText(flow);
  const words = [...(rate === null ? [] : [rate]), ...(flow.mixed ? ["mixed"] : []), ...(flow.flow === "excess" ? ["excess"] : [])];
  return { items, more: all.length - items.length, rateText: words.length === 0 ? null : words.join(" · ") };
}

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
