/**
 * The graph's pan and zoom, in stage units, and the maths that moves it. All pure: the stage is the SVG's viewBox, which
 * the component sets to the element's measured size, so one stage unit is one CSS pixel and `text-sm` stays 14 px at k = 1.
 */

export interface Stage {
  width: number;
  height: number;
}

/** The stage before the element is measured (and in jsdom, which has no ResizeObserver). */
export const FALLBACK_STAGE: Stage = { width: 1000, height: 600 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** The smallest scale a fit goes to: below it the text (14 px body, 16 px titles) is under ~8 px, so the drawing is panned instead. */
export const MIN_FIT_ZOOM = 0.6;
/** Space kept around the drawing by a fit and by the canvas height, in stage units. */
export const FIT_PAD = 16;
export const ZOOM_STEP = 1.25;
export const PAN_STEP = 60;

export interface View {
  /** Translation, then scale: a layout point (px, py) is drawn at (x + k*px, y + k*py). */
  x: number;
  y: number;
  k: number;
}

const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Scale the view by `factor` keeping the stage point (cx, cy) where it is. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clampK(view.k * factor);
  const real = k / view.k;
  return { k, x: cx - (cx - view.x) * real, y: cy - (cy - view.y) * real };
}

export const zoomCentre = (view: View, factor: number, stage: Stage) => zoomAt(view, factor, stage.width / 2, stage.height / 2);

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

/** The scale at which a drawing fits `avail` x `availH`: never above 1:1, never below the readable floor. */
const fitScale = (width: number, height: number, availW: number, availH: number) =>
  Math.max(MIN_FIT_ZOOM, Math.min(1, availW / width, availH / height));

/**
 * The view that shows a drawing of the given size: scaled down only as needed, never below MIN_FIT_ZOOM and never above
 * 1:1. An axis that fits is centred; one that does not (only possible at the floor) is anchored at the left or top of the
 * drawing, since the flow starts at the extractors and reads left to right.
 */
export function fitView(width: number, height: number, stage: Stage): View {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  const availW = Math.max(1, stage.width - 2 * FIT_PAD);
  const availH = Math.max(1, stage.height - 2 * FIT_PAD);
  const k = fitScale(width, height, availW, availH);
  const place = (size: number, avail: number, total: number) => (size <= avail ? (total - size) / 2 : FIT_PAD);
  return { k, x: place(width * k, availW, stage.width), y: place(height * k, availH, stage.height) };
}

/** The canvas height that suits a drawing at this stage width (the CSS min and max heights clamp it). */
export function canvasHeight(width: number, height: number, stageWidth: number): number {
  if (width <= 0 || height <= 0) return FALLBACK_STAGE.height;
  const k = fitScale(width, height, Math.max(1, stageWidth - 2 * FIT_PAD), Infinity);
  return Math.ceil(height * k + 2 * FIT_PAD);
}

/** What a key does to the view, or null when it is none of the graph's keys. */
export function keyView(view: View, key: string, fit: View, stage: Stage): View | null {
  switch (key) {
    case "+":
    case "=":
      return zoomCentre(view, ZOOM_STEP, stage);
    case "-":
    case "_":
      return zoomCentre(view, 1 / ZOOM_STEP, stage);
    case "0":
      return fit;
    case "ArrowLeft":
      return panBy(view, PAN_STEP, 0);
    case "ArrowRight":
      return panBy(view, -PAN_STEP, 0);
    case "ArrowUp":
      return panBy(view, 0, PAN_STEP);
    case "ArrowDown":
      return panBy(view, 0, -PAN_STEP);
    default:
      return null;
  }
}

/** A pointer position (client pixels) as a stage point, allowing for any bars `preserveAspectRatio="meet"` leaves. */
export function toStage(rect: { left: number; top: number; width: number; height: number }, stage: Stage, clientX: number, clientY: number) {
  if (rect.width <= 0 || rect.height <= 0) return { x: clientX, y: clientY, scale: 1 };
  const scale = Math.min(rect.width / stage.width, rect.height / stage.height);
  const offX = (rect.width - stage.width * scale) / 2;
  const offY = (rect.height - stage.height * scale) / 2;
  return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale, scale };
}

/** Which edges of the stage a drawing runs past. */
export interface Clipped {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** Less than this many stage units past an edge is rounding, not a clipped drawing. */
const CLIP_SLACK = 1;

/** Where the drawing (its layout size at this view) is cut off by the stage: the edges a fade and the hint stand for. */
export function clippedEdges(view: View, layout: { width: number; height: number }, stage: Stage): Clipped {
  if (layout.width <= 0 || layout.height <= 0) return { left: false, right: false, top: false, bottom: false };
  return {
    left: view.x < -CLIP_SLACK,
    right: view.x + layout.width * view.k > stage.width + CLIP_SLACK,
    top: view.y < -CLIP_SLACK,
    bottom: view.y + layout.height * view.k > stage.height + CLIP_SLACK,
  };
}

export const isClipped = (c: Clipped) => c.left || c.right || c.top || c.bottom;

/** The part of the stage left of a drawer of `panelWidth` px that overlays its right side (a drawer wider than the stage leaves none). */
export const stageBesidePanel = (stage: Stage, panelWidth: number): Stage => ({ width: Math.max(1, stage.width - panelWidth), height: stage.height });

/** The view moved the least that brings a layout rectangle fully into the stage (with a margin); unchanged if it is in. */
export function revealRect(view: View, r: { x: number; y: number; width: number; height: number }, stage: Stage, margin = 24): View {
  const left = view.x + r.x * view.k;
  const right = left + r.width * view.k;
  const top = view.y + r.y * view.k;
  const bottom = top + r.height * view.k;
  let dx = 0;
  let dy = 0;
  if (left < margin) dx = margin - left;
  else if (right > stage.width - margin) dx = stage.width - margin - right;
  if (top < margin) dy = margin - top;
  else if (bottom > stage.height - margin) dy = stage.height - margin - bottom;
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}
