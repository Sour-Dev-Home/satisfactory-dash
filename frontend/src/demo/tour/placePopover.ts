/**
 * Where the tour's popover goes, from `sm` up (ADR-0065 Decision 2). Pure: the highlighted box, the popover's size and
 * the viewport in, its corner and its arrow out, all in CSS px (the overlay's SVG has 1 unit = 1 px). The first side
 * with room wins, in the order below, above, right, left; along that side the popover is centred on the target and kept
 * `POPOVER_MARGIN` inside the viewport. When no side has room (or there is no target) it is centred, with no arrow.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type PopoverSide = "below" | "above" | "right" | "left" | "center";

export interface PopoverPlacement {
  x: number;
  y: number;
  side: PopoverSide;
  /** An SVG path, a triangle from the popover's edge to the target; null when centred. */
  arrow: string | null;
}

/** The least space between the popover and the viewport's edge. */
export const POPOVER_MARGIN = 12;
/** How far the arrow reaches out of the popover; also the gap between the popover and the highlighted box. */
export const ARROW_SIZE = 10;
/** The arrow keeps this far from the popover's corners, clear of its rounded edge. */
const ARROW_INSET = 16;

const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(Math.max(value, min), max));

export function placePopover(target: Box | null, size: Size, viewport: Size): PopoverPlacement {
  const { width: w, height: h } = size;
  const m = POPOVER_MARGIN;
  const centred: PopoverPlacement = {
    x: Math.max(m, (viewport.width - w) / 2),
    y: Math.max(m, (viewport.height - h) / 2),
    side: "center",
    arrow: null,
  };
  if (target === null) return centred;
  // A target wholly off screen (not yet scrolled to) has no side to sit beside: centre rather than place off screen.
  if (
    target.x + target.width <= 0 ||
    target.y + target.height <= 0 ||
    target.x >= viewport.width ||
    target.y >= viewport.height
  ) {
    return centred;
  }

  const gap = ARROW_SIZE;
  const right = target.x + target.width;
  const bottom = target.y + target.height;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const fitsAcross = w + 2 * m <= viewport.width;
  const fitsDown = h + 2 * m <= viewport.height;
  const alongX = () => clamp(cx - w / 2, m, viewport.width - w - m);
  const alongY = () => clamp(cy - h / 2, m, viewport.height - h - m);
  // The arrow's point on the popover's edge, kept off its corners, toward the target's centre.
  const arrowX = (x: number) => clamp(cx, x + ARROW_INSET, x + w - ARROW_INSET);
  const arrowY = (y: number) => clamp(cy, y + ARROW_INSET, y + h - ARROW_INSET);
  const a = ARROW_SIZE;

  if (fitsAcross && bottom + gap + h + m <= viewport.height) {
    const x = alongX();
    const y = bottom + gap;
    const ax = arrowX(x);
    return { x, y, side: "below", arrow: `M${ax - a} ${y}L${ax} ${y - a}L${ax + a} ${y}Z` };
  }
  if (fitsAcross && target.y - gap - h >= m) {
    const x = alongX();
    const y = target.y - gap - h;
    const ax = arrowX(x);
    const edge = y + h;
    return { x, y, side: "above", arrow: `M${ax - a} ${edge}L${ax} ${edge + a}L${ax + a} ${edge}Z` };
  }
  if (fitsDown && right + gap + w + m <= viewport.width) {
    const x = right + gap;
    const y = alongY();
    const ay = arrowY(y);
    return { x, y, side: "right", arrow: `M${x} ${ay - a}L${x - a} ${ay}L${x} ${ay + a}Z` };
  }
  if (fitsDown && target.x - gap - w >= m) {
    const x = target.x - gap - w;
    const y = alongY();
    const ay = arrowY(y);
    const edge = x + w;
    return { x, y, side: "left", arrow: `M${edge} ${ay - a}L${edge + a} ${ay}L${edge} ${ay + a}Z` };
  }
  return centred;
}

/** Whether two boxes share any area. */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function roundedRect({ x, y, width, height }: Box, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return (
    `M${x + r} ${y}H${x + width - r}A${r} ${r} 0 0 1 ${x + width} ${y + r}V${y + height - r}` +
    `A${r} ${r} 0 0 1 ${x + width - r} ${y + height}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + height - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

/**
 * The scrim's clip: the viewport with a rounded hole at each of `holes` (evenodd), or the whole viewport with none. The
 * holes must not overlap (evenodd would fill their overlap again): the caller drops one that would.
 */
export function holePath(viewport: Size, holes: Box | null | readonly Box[], radius: number): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  const list = holes === null ? [] : Array.isArray(holes) ? (holes as readonly Box[]) : [holes as Box];
  return outer + list.map((h) => roundedRect(h, radius)).join("");
}

/** The phone sheet's tallest share of the screen (`--spacing-tour-sheet`, 40% of it): what a sheet at the top can cover. */
export const SHEET_MAX_SHARE = 0.4;

/** Below `sm` the popover is a sheet on the bottom edge, or on the top when the target's centre is in the bottom 40%. */
export function sheetAtTop(target: Box | null, viewport: Size): boolean {
  return target !== null && target.y + target.height / 2 > viewport.height * 0.6;
}

/** The target's box grown by `pad` on every side. */
export function padBox(box: Box, pad: number): Box {
  return { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
}
