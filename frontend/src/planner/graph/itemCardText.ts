import { carrierWord } from "../plannerText";
import { BUBBLE_D, bubbleOffsets, bubblesWidth, itemRateText, type BubbleItem } from "./bubbleRow";
import type { CanvasFlow } from "./canvasScene";
import { CHAR_W_BODY, CHAR_W_TITLE, FOCUS_CARD_H, FOCUS_CARD_W, LABEL_PAD, type LaidEdge } from "./layoutSite";

/**
 * The detail card a focused bubble morphs into (ADR-0060 Decision 4): its text, cut to fit by the canvas's character-width
 * estimate (the full words go in its `<title>` and the screen-reader text), and where a line's bubbles sit, which the
 * morph starts from. Only `CanvasFlow` data is shown; nothing is invented for an unknown item.
 */

/** The card's metrics in layout units: its padding, the icon at its top-left, a line of text, and its corner radius. */
export const CARD_PAD = 12;
export const CARD_ICON = 48;
export const CARD_LINE_H = 18;
export const CARD_RX = 8;
/** The close control's square, at the card's top-right. */
export const CARD_CLOSE = 24;

const TITLE_CHARS = Math.floor((FOCUS_CARD_W - 2 * CARD_PAD - CARD_ICON - CARD_PAD) / CHAR_W_TITLE);
const LINE_CHARS = Math.floor((FOCUS_CARD_W - 2 * CARD_PAD) / CHAR_W_BODY);
/** As many lines as fit between the icon row and the "Show the whole path" control at the bottom. */
export const CARD_MAX_LINES = Math.floor((FOCUS_CARD_H - 2 * CARD_PAD - CARD_ICON - CARD_PAD - CARD_LINE_H) / CARD_LINE_H);

/** A line cut to `max` characters with an ellipsis. */
export const fit = (text: string, max: number): string => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);

export interface ItemCardText {
  /** The item's name, or "Item unknown" (never an invented name), cut to fit. */
  title: string;
  /** The facts under it, each cut to fit, at most `CARD_MAX_LINES`. */
  lines: string[];
  /** Every word, uncut: the `<title>` and the screen-reader text. */
  full: string;
}

/** What the card says about an item on a line from `from` to `to`. */
export function itemCardText(item: BubbleItem, flow: CanvasFlow, others: number, from: string, to: string): ItemCardText {
  const name = item.name ?? "Item unknown";
  // As the label words it: plain when measured, "about" when estimated, "at least" when a part has no number.
  const rate = item.quality === "unknown" ? "Rate unknown" : itemRateText(item, flow.unit);
  const transport = flow.carrier === "belt" || flow.carrier === "pipe" ? [] : [`${carrierWord(flow.carrier)}${flow.routeName === undefined ? "" : `, route ${flow.routeName}`}`];
  // An unknown item says so plainly, with the raw class when the server sent one.
  const unknown = item.name === null ? [item.className === null ? "Not reported by the game" : `Class ${item.className}`] : [];
  const shared = others > 0 ? [`${others} other ${others === 1 ? "item" : "items"} here`] : [];
  const facts = [rate, `From ${from}`, `To ${to}`, ...transport, ...unknown, ...shared];
  return { title: fit(name, TITLE_CHARS), lines: facts.slice(0, CARD_MAX_LINES).map((l) => fit(l, LINE_CHARS)), full: [name, ...facts].join(". ") };
}

/** Where a label draws its bubble row: the row's left edge and the bubbles' centre line. */
export function bubbleRowOrigin(edge: Pick<LaidEdge, "labelY" | "labelHeight" | "textX" | "bubbles">): { left: number; cy: number } {
  return { left: edge.textX - bubblesWidth(edge.bubbles) / 2, cy: edge.labelY - edge.labelHeight / 2 + LABEL_PAD / 2 + BUBBLE_D / 2 };
}

/** The centre of an item's bubble on its line, or of the "+k" chip for an item only in the full list. */
export function bubbleCentre(edge: Pick<LaidEdge, "labelX" | "labelY" | "labelHeight" | "textX" | "bubbles">, item: string): { x: number; y: number } {
  const { left, cy } = bubbleRowOrigin(edge);
  const at = bubbleOffsets(edge.bubbles);
  const i = edge.bubbles.items.findIndex((b) => b.key === item);
  if (i >= 0) return { x: left + at.bubbles[i], y: cy };
  return at.chip === null ? { x: edge.labelX, y: cy } : { x: left + at.chip, y: cy };
}
