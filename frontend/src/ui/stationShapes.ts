/**
 * Station geometry (ADR-0041 item 5) in the icons' 48 × 48 viewBox, as data: `StationIcon` draws it
 * as SVG, and the map's canvas draws the machine from the same numbers (src/map/machineIcon.ts), so
 * the map and the overview show one machine.
 */
export const STATION_VIEWBOX = 48;

export interface RectShape {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

/** The machine's housing: the body the map colours by the machine's state. */
export const MACHINE_HOUSING: RectShape = { x: 6, y: 12, width: 36, height: 26, rx: 3 };
/** Its window: the dark mark on the housing. */
export const MACHINE_WINDOW: RectShape = { x: 11, y: 17, width: 16, height: 11, rx: 1.5 };
/** Its output port, beside the window. */
export const MACHINE_PORT: RectShape = { x: 30, y: 17, width: 7, height: 16, rx: 1.5 };
/** The port's light (the amber detail). */
export const MACHINE_LIGHT = { cx: 33.5, cy: 21, r: 1.6 };
/** The two feet under the housing. */
export const MACHINE_FEET = "M12 38v4h6v-4M30 38v4h6v-4";

/**
 * The factory (also the logo, #444, which the favicon and app icons are drawn from: src/ui/logoMark.ts):
 * a saw-tooth roof and a stack, two windows and a lit door. Its outline spans x 5-38 and y 8-42.
 */
export const FACTORY_BODY = "M5 42V22l9 6v-6l9 6v-6l9 6V8h6v34z";
export const FACTORY_BOUNDS = { left: 5, top: 8, right: 38, bottom: 42 };
export const FACTORY_WINDOWS: readonly RectShape[] = [
  { x: 10, y: 32, width: 5, height: 4, rx: 1 },
  { x: 19, y: 32, width: 5, height: 4, rx: 1 },
];
export const FACTORY_DOOR: RectShape = { x: 28, y: 32, width: 6, height: 10, rx: 1 };

/** A warning sign on the housing, where the window is, for a backed-up machine. Points as [x, y]. */
export const WARNING_TRIANGLE: readonly (readonly [number, number])[] = [
  [24, 15],
  [34, 33],
  [14, 33],
];

/** The SVG `points` of a polygon. */
export const svgPoints = (points: readonly (readonly [number, number])[]) => points.map(([x, y]) => `${x},${y}`).join(" ");
