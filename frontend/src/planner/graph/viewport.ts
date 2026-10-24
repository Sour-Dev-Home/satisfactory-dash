/** The graph's pan and zoom, in stage units (the SVG's viewBox), and the maths that moves it. All pure. */

/** The SVG's viewBox: the drawing is scaled to fit it, so the maths never needs the element's pixel size. */
export const STAGE_W = 1000;
export const STAGE_H = 600;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
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

export const zoomCentre = (view: View, factor: number) => zoomAt(view, factor, STAGE_W / 2, STAGE_H / 2);

export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x + dx, y: view.y + dy });

/** The view that shows a whole drawing of the given size, centred, never enlarged past 1:1. */
export function fitView(width: number, height: number): View {
  if (width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampK(Math.min(1, STAGE_W / width, STAGE_H / height));
  return { k, x: (STAGE_W - width * k) / 2, y: (STAGE_H - height * k) / 2 };
}

/** What a key does to the view, or null when it is none of the graph's keys. */
export function keyView(view: View, key: string, fit: View): View | null {
  switch (key) {
    case "+":
    case "=":
      return zoomCentre(view, ZOOM_STEP);
    case "-":
    case "_":
      return zoomCentre(view, 1 / ZOOM_STEP);
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

/** A pointer position (client pixels) as a stage point, allowing for the bars `preserveAspectRatio="meet"` leaves. */
export function toStage(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number) {
  if (rect.width <= 0 || rect.height <= 0) return { x: clientX, y: clientY, scale: 1 };
  const scale = Math.min(rect.width / STAGE_W, rect.height / STAGE_H);
  const offX = (rect.width - STAGE_W * scale) / 2;
  const offY = (rect.height - STAGE_H * scale) / 2;
  return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale, scale };
}

/** The view moved the least that brings a layout rectangle fully into the stage (with a margin); unchanged if it is in. */
export function revealRect(view: View, r: { x: number; y: number; width: number; height: number }, margin = 24): View {
  const left = view.x + r.x * view.k;
  const right = left + r.width * view.k;
  const top = view.y + r.y * view.k;
  const bottom = top + r.height * view.k;
  let dx = 0;
  let dy = 0;
  if (left < margin) dx = margin - left;
  else if (right > STAGE_W - margin) dx = STAGE_W - margin - right;
  if (top < margin) dy = margin - top;
  else if (bottom > STAGE_H - margin) dy = STAGE_H - margin - bottom;
  return dx === 0 && dy === 0 ? view : panBy(view, dx, dy);
}
