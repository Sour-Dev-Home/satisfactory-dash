import {
  MACHINE_HOUSING,
  MACHINE_WINDOW,
  STATION_VIEWBOX,
  WARNING_TRIANGLE,
  type RectShape,
} from "../ui/stationShapes";

/**
 * The map's machine icon on a 2D canvas (ADR-0041): StationIcon's machine housing in the state's
 * colour with its window as the mark, or, backed up, the warn colour with a warning triangle where
 * the window is. Pure drawing on the context it's given; the buildings layer calls it from
 * Leaflet's canvas renderer.
 */

/** The icon's size on the map, in CSS pixels (the 48-unit viewBox scaled down). */
export const ICON_PX = 20;
export const ICON_SCALE = ICON_PX / STATION_VIEWBOX;
/** Leaflet's hit test is a circle: one that covers the housing. */
export const HIT_RADIUS = ICON_PX / 2;

export interface MachineColors {
  /** The housing: the state's colour, or warn when backed up. */
  body: string;
  /** The window or the triangle: the canvas colour. */
  mark: string;
}

function rect(ctx: CanvasRenderingContext2D, shape: RectShape, fill: string) {
  ctx.beginPath();
  ctx.roundRect(shape.x, shape.y, shape.width, shape.height, shape.rx);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draws a machine centred on (x, y), in the canvas's pixel space. */
export function drawMachine(ctx: CanvasRenderingContext2D, x: number, y: number, colors: MachineColors, backedUp: boolean) {
  ctx.save();
  ctx.translate(x - ICON_PX / 2, y - ICON_PX / 2);
  ctx.scale(ICON_SCALE, ICON_SCALE);
  ctx.globalAlpha = 1;
  rect(ctx, MACHINE_HOUSING, colors.body);
  if (backedUp) {
    ctx.beginPath();
    WARNING_TRIANGLE.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = colors.mark;
    ctx.fill();
  } else {
    rect(ctx, MACHINE_WINDOW, colors.mark);
  }
  ctx.restore();
}

/** The pulse ring grows from just outside the housing to this radius, in CSS pixels. */
const RING_FROM = ICON_PX / 2 - 1;
const RING_TO = ICON_PX;
const RING_WIDTH = 2;
/** How far the ring reaches, for the redraw area Leaflet clears around it. */
export const PULSE_REACH = RING_TO + RING_WIDTH;
/** Where the ring sits when it's shown still (reduced motion): near the icon, mostly opaque. */
export const STILL_PROGRESS = 0.4;

/** Smooth in and out (cubic), so the ring eases away and back without a jolt. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The backed-up pulse at `progress` (0 to 1 through one cycle): a ring in the warn colour that
 * grows and fades out.
 */
export function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number, color: string) {
  const t = easeInOut(Math.min(Math.max(progress, 0), 1));
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, RING_FROM + (RING_TO - RING_FROM) * t, 0, Math.PI * 2);
  ctx.globalAlpha = 1 - t;
  ctx.strokeStyle = color;
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
