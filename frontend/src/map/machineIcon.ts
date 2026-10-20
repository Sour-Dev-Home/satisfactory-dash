import {
  MACHINE_HOUSING,
  MACHINE_WINDOW,
  STATION_VIEWBOX,
  WARNING_TRIANGLE,
  type RectShape,
} from "../ui/stationShapes";

/**
 * The map's machine icon on a 2D canvas (ADR-0041): StationIcon's machine housing in the state's
 * colour with its window as the mark; no recipe, the housing hollow (an outline only); backed up,
 * the warn colour with a warning triangle where the window is. Pure drawing on the context it's
 * given; the buildings layer calls it from Leaflet's canvas renderer.
 */

/**
 * The icon's size follows the zoom (the owner's call, 2026-10-20): ICON_MIN_PX when zoomed far
 * out, growing linearly to ICON_MAX_PX at ZOOM_AT_MAX (the first view's closest zoom) and no
 * further. Sizes are CSS pixels of the 48-unit viewBox.
 */
export const ICON_MIN_PX = 20;
export const ICON_MAX_PX = 40;
export const ZOOM_AT_MIN = -4;
export const ZOOM_AT_MAX = 1;

/** The icon's size at a map zoom, clamped to [ICON_MIN_PX, ICON_MAX_PX]. */
export function iconPx(zoom: number): number {
  const t = (zoom - ZOOM_AT_MIN) / (ZOOM_AT_MAX - ZOOM_AT_MIN);
  return ICON_MIN_PX + (ICON_MAX_PX - ICON_MIN_PX) * Math.min(Math.max(t, 0), 1);
}
/** Leaflet's hit test is a circle: one that covers the housing at that size. */
export const hitRadius = (size: number) => size / 2;

export interface MachineColors {
  /** The housing: the state's colour, or warn when backed up. Absent: hollow, `outline` only. */
  body?: string;
  /** The window or the triangle: the canvas colour. */
  mark: string;
  /** An outline round the housing (the hollow no-recipe form). */
  outline?: string;
}

/**
 * The colour drawn when a token reads empty (not loaded, or renamed): the canvas element's own
 * `color`, inherited from the map (the ink token). Assigning "" to fillStyle is ignored, which
 * would silently paint with whatever colour was drawn last.
 */
export const FALLBACK_COLOR = "currentcolor";
const orFallback = (color: string) => color || FALLBACK_COLOR;
/** The hollow housing's outline: 1 CSS pixel at the smallest size, growing with the icon. */
const OUTLINE_PX = 1;

/** A rounded rectangle's path: roundRect where the browser has it, else four arcs by hand. */
function roundedPath(ctx: CanvasRenderingContext2D, { x, y, width, height, rx }: RectShape) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, rx);
    return;
  }
  ctx.moveTo(x + rx, y);
  ctx.arcTo(x + width, y, x + width, y + height, rx);
  ctx.arcTo(x + width, y + height, x, y + height, rx);
  ctx.arcTo(x, y + height, x, y, rx);
  ctx.arcTo(x, y, x + width, y, rx);
  ctx.closePath();
}

function rect(ctx: CanvasRenderingContext2D, shape: RectShape, fill: string) {
  roundedPath(ctx, shape);
  ctx.fillStyle = orFallback(fill);
  ctx.fill();
}

/**
 * Draws a machine `size` px across, centred on (x, y), in the canvas's pixel space. Only the
 * housing and its window (or the triangle), on purpose: at map size StationIcon's port, light and
 * feet would be specks of a few pixels that blur the state colour, and the issue's icon is the
 * housing with one mark.
 */
export function drawMachine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: MachineColors,
  backedUp: boolean,
) {
  const scale = size / STATION_VIEWBOX;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 1;
  if (colors.body === undefined) {
    // Hollow: the outline tells it apart from a filled state by shape, not colour alone.
    roundedPath(ctx, MACHINE_HOUSING);
    ctx.strokeStyle = orFallback(colors.outline ?? "");
    ctx.lineWidth = (OUTLINE_PX * size) / ICON_MIN_PX / scale;
    ctx.stroke();
    ctx.restore();
    return;
  }
  rect(ctx, MACHINE_HOUSING, colors.body);
  if (backedUp) {
    ctx.beginPath();
    WARNING_TRIANGLE.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = orFallback(colors.mark);
    ctx.fill();
  } else {
    rect(ctx, MACHINE_WINDOW, colors.mark);
  }
  ctx.restore();
}

const RING_WIDTH = 2;
/** The pulse ring grows from just outside the housing to the icon's full size as its radius. */
const ringFrom = (size: number) => size / 2 - 1;
const ringTo = (size: number) => size;
/** How far the ring reaches at an icon size, for the redraw area Leaflet clears around it. */
export const pulseReach = (size: number) => ringTo(size) + RING_WIDTH;
/** Where the ring sits when it's shown still (reduced motion): near the icon, mostly opaque. */
export const STILL_PROGRESS = 0.4;

/** Smooth in and out (cubic), so the ring eases away and back without a jolt. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The backed-up pulse round an icon `size` px across, at `progress` (0 to 1 through one cycle): a
 * ring in the warn colour that grows and fades out.
 */
export function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, progress: number, color: string) {
  const t = easeInOut(Math.min(Math.max(progress, 0), 1));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, ringFrom(size) + (ringTo(size) - ringFrom(size)) * t, 0, Math.PI * 2);
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = orFallback(color);
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/** A CSS time ("1.6s", "1600ms") in milliseconds; 0 for anything else, which means "don't animate". */
export function durationMs(value: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}
