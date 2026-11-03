/**
 * The hover and keyboard highlight of the Planner canvas (ADR-0063 amendment, 2026-11-03). Pointing at a line (its stroke
 * or its bubbles), or at a card, or the keyboard on a card's button or a line's bubble, highlights that line and its two
 * cards, or the card with every line it has and their far cards. Everything else dims, and the highlighted lines' rate
 * labels fade in.
 *
 * It never re-renders or repaints the canvas: the pointer's target lives in a small store (`pointerStore`) that only
 * `HighlightLayer` reads, and that layer, its own composited `<svg>` over the canvas and the march layer, draws the dim (a
 * canvas-coloured cover with holes for what is lit) and the lit lines' rates. So a pointer moving over the picture costs a
 * render of that layer when what it is over changes, and nothing when it does not.
 */

import { BUBBLE_D } from "./bubbleRow";
import { LABEL_LINE_H, LABEL_PAD, type LaidEdge } from "./layoutSite";

/** Where a line's rate text sits: centred under its bubbles, in the row its label box keeps for it. The canvas's
 *  `EdgeLabel` and `HighlightLayer` both use it, so the lit rate lies exactly on the canvas's own (hidden) one. */
export function rateAnchor(e: Pick<LaidEdge, "labelY" | "labelHeight" | "textX">): { x: number; y: number } {
  const top = e.labelY - e.labelHeight / 2 + LABEL_PAD / 2;
  return { x: e.textX, y: top + BUBBLE_D + LABEL_LINE_H / 2 };
}

/** What is highlighted: one line, by its `LaidEdge.index`, or one card, by its key. */
export type HighlightTarget = { kind: "edge"; index: number } | { kind: "card"; key: string };

/** The highlighted lines (by index) and cards (by key). */
export interface Highlight {
  edges: ReadonlySet<number>;
  cards: ReadonlySet<string>;
}

/** How a highlight looks: `dim` covers what is not lit; `labels` only shows the lit lines' rates (item focus or the item
 *  filter own the dimming then). */
export type HighlightMode = "dim" | "labels";

type EdgeEnds = { index: number; flow: { from: string; to: string } };

export const sameTarget = (a: HighlightTarget | null, b: HighlightTarget | null): boolean =>
  a === b || (a !== null && b !== null && (a.kind === "edge" ? b.kind === "edge" && a.index === b.index : b.kind === "card" && a.key === b.key));

/** A target's identity as a string, for React keys: a new target's rates fade in afresh. */
export const targetId = (t: HighlightTarget): string => (t.kind === "edge" ? `e:${t.index}` : `c:${t.key}`);

/**
 * The lines and cards a target lights: a line and its two cards; a card, every line from or to it, and their other cards
 * (hop-1, as item focus). Null when the target is not in the picture (a poll took it away).
 */
export function highlightOf(target: HighlightTarget | null, edges: readonly EdgeEnds[], cards: ReadonlySet<string>): Highlight | null {
  if (target === null) return null;
  if (target.kind === "edge") {
    const e = edges.find((x) => x.index === target.index);
    return e === undefined ? null : { edges: new Set([e.index]), cards: new Set([e.flow.from, e.flow.to]) };
  }
  if (!cards.has(target.key)) return null;
  const lit = new Set<number>();
  const near = new Set([target.key]);
  for (const e of edges) {
    if (e.flow.from !== target.key && e.flow.to !== target.key) continue;
    lit.add(e.index);
    near.add(e.flow.from);
    near.add(e.flow.to);
  }
  return { edges: lit, cards: near };
}

/** What the pointer is over: the line or label it is on (`data-hl-edge`), else the card (`data-hl-node`), else nothing. */
export function targetAt(el: Element | null): HighlightTarget | null {
  const hit = el?.closest("[data-hl-edge], [data-hl-node]") ?? null;
  if (hit === null) return null;
  const edge = hit.getAttribute("data-hl-edge");
  if (edge !== null) {
    const index = Number(edge);
    return edge !== "" && Number.isInteger(index) ? { kind: "edge", index } : null;
  }
  const key = hit.getAttribute("data-hl-node");
  return key === null ? null : { kind: "card", key };
}

/** Where the canvas hides its rates at rest (`[data-rate]` in `index.css` uses the same query): a mouse or trackpad is the
 *  primary pointer. */
export const RATES_HIDE_QUERY = "(hover: hover) and (pointer: fine)";
export const ratesHideAtRest = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(RATES_HIDE_QUERY).matches;

/** The pointer's target, outside React state: `set` tells only the subscribers (the highlight layer), and only on a change. */
export interface PointerStore {
  get: () => HighlightTarget | null;
  set: (target: HighlightTarget | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function pointerStore(): PointerStore {
  let current: HighlightTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (target) => {
      if (sameTarget(target, current)) return;
      current = target;
      for (const l of [...listeners]) l();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
