import type { Stage, View } from "./viewport";

/**
 * Where the canvas's floating card (the group panel, or a line's "+k" list) sits, in stage pixels (the canvas's own CSS
 * pixels). Pure: SiteGraph feeds it the clicked card's place on screen and the card's measured height.
 */

/** The floating card's widest: `--spacing-graph-panel` (22rem) in CSS px; overlayPlacement.test.ts keeps the two equal. */
export const OVERLAY_W = 352;
/** Kept clear between the floating card and the canvas's edges. */
export const OVERLAY_MARGIN = 12;
/** Kept clear between the floating card and the card it stands beside. */
export const OVERLAY_GAP = 12;

/** A box on screen, in stage pixels. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Beside the card (wide screens), or across the canvas's bottom (below lg). */
export type OverlaySide = "right" | "left" | "below" | "above" | "bottom";

export interface OverlayPlace {
  x: number;
  y: number;
  width: number;
  /** The height drawn: the content's, up to `maxHeight` (it scrolls inside past that). */
  height: number;
  maxHeight: number;
  side: OverlaySide;
  /** The card is under the floating one: no side had room. SiteGraph then moves the view once. */
  covers: boolean;
}

/** A layout-space box (a laid card, a label) on screen at this view. */
export const screenRect = (view: View, r: { x: number; y: number; width: number; height: number }): ScreenRect => ({
  left: view.x + r.x * view.k,
  top: view.y + r.y * view.k,
  width: r.width * view.k,
  height: r.height * view.k,
});

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

const overlaps = (a: ScreenRect, b: ScreenRect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Wide (from lg): beside `anchor`, its right side first, then its left, then below, then above, always clamped inside the
 * stage; with no anchor, the top-right corner. Narrow: centred on the bottom, at most about half the canvas tall. `height` is
 * the content's measured height (0 when not measured yet: then the most it may take).
 */
export function placeOverlay(anchor: ScreenRect | null, height: number, stage: Stage, wide: boolean): OverlayPlace {
  const m = OVERLAY_MARGIN;
  const room = Math.max(1, stage.width - 2 * m);
  // Capped at every width: below lg a wide canvas (a tablet) gets the card centred, not a banner across it.
  const width = Math.min(OVERLAY_W, room);
  const maxHeight = Math.max(1, wide ? stage.height - 2 * m : Math.floor(stage.height / 2));
  const h = height > 0 ? Math.min(height, maxHeight) : maxHeight;
  const maxX = Math.max(m, stage.width - m - width);
  const maxY = Math.max(m, stage.height - m - h);
  const place = (x: number, y: number, side: OverlaySide): OverlayPlace => {
    const at = { x: clamp(x, m, maxX), y: clamp(y, m, maxY) };
    const covers = anchor !== null && overlaps({ left: at.x, top: at.y, width, height: h }, anchor);
    return { ...at, width, height: h, maxHeight, side, covers };
  };
  if (!wide) return place((stage.width - width) / 2, maxY, "bottom");
  if (anchor === null) return place(maxX, m, "right");
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  if (right + OVERLAY_GAP + width <= stage.width - m) return place(right + OVERLAY_GAP, anchor.top, "right");
  if (anchor.left - OVERLAY_GAP - width >= m) return place(anchor.left - OVERLAY_GAP - width, anchor.top, "left");
  if (bottom + OVERLAY_GAP + h <= stage.height - m) return place(anchor.left, bottom + OVERLAY_GAP, "below");
  if (anchor.top - OVERLAY_GAP - h >= m) return place(anchor.left, anchor.top - OVERLAY_GAP - h, "above");
  // No side has room: the roomier one, clamped (it covers part of the card until the view moves).
  return stage.width - m - right >= anchor.left - m ? place(right + OVERLAY_GAP, anchor.top, "right") : place(anchor.left - OVERLAY_GAP - width, anchor.top, "left");
}

/** The part of the stage the floating card leaves free: left of it on a wide screen, above it below lg. */
export function stageBesideOverlay(place: OverlayPlace, stage: Stage, wide: boolean): Stage {
  return wide
    ? { width: Math.max(1, stage.width - place.width - OVERLAY_GAP - OVERLAY_MARGIN), height: stage.height }
    : { width: stage.width, height: Math.max(1, stage.height - place.height - OVERLAY_GAP - OVERLAY_MARGIN) };
}
