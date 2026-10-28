import type { CanvasFlow } from "./canvasScene";
import { rateStep, type RateStep } from "./rateStep";

/**
 * Width means rate (ADR-0062 amendment Decision 4): a belt or pipe line's stroke is one of three widths, from `rateStep` on
 * its rate and unit (a bundle's summed rate, the number its label reads). A line with no step (unknown, 0, a stalled line
 * reading 0) keeps today's base width, the slow one. Canvas units, set as the SVG `stroke-width` attribute.
 */
export const LINE_W_SLOW = 2;
export const LINE_W_MID = 3;
export const LINE_W_FAST = 4;
export const LINE_W_BASE = LINE_W_SLOW;

/**
 * A mixed line keeps its warn colour and gets a thin inner stroke in the canvas colour instead of extra width, so width only
 * ever means rate. Each step's inner stroke leaves a warn rail of at least 0.75 units on each side (0.75, 1, 1.25).
 */
export const MIXED_INNER_W_SLOW = 0.5;
export const MIXED_INNER_W_MID = 1;
export const MIXED_INNER_W_FAST = 1.5;

/**
 * A transport (train, truck, drone, Depot) draws a double line (amendment Decision 6, owner answer 3): a stroke `TRANSPORT_W`
 * wide in the line's colour with a `TRANSPORT_GAP` stroke in the canvas colour over it, which leaves two rails of
 * `TRANSPORT_RAIL_W`. One geometry for every transport, mixed or not, whatever its rate: the double line says "a vehicle
 * carries this", not how much (its rate is in the label and the `<title>`). The gap is more than twice a rail and twice a
 * fast mixed belt's core (1.5), and the footprint is wider than any belt's (4), so a transport never reads as a mixed belt or
 * as a width step: a mixed belt is a warn line with a thin core, a transport two thin rails with a wide gap.
 */
export const TRANSPORT_RAIL_W = 1.25;
export const TRANSPORT_GAP = 3;
export const TRANSPORT_W = 2 * TRANSPORT_RAIL_W + TRANSPORT_GAP;

/** Each step's width and its mixed inner stroke; no step is the slow (base) pair. */
const BY_STEP: ReadonlyMap<RateStep, { width: number; inner: number }> = new Map([
  ["slow", { width: LINE_W_SLOW, inner: MIXED_INNER_W_SLOW }],
  ["mid", { width: LINE_W_MID, inner: MIXED_INNER_W_MID }],
  ["fast", { width: LINE_W_FAST, inner: MIXED_INNER_W_FAST }],
]);
const BASE = { width: LINE_W_BASE, inner: MIXED_INNER_W_SLOW };
/** The carriers whose width is their rate; any other carrier is a transport mode (a game-server string). */
const LINE_CARRIERS: ReadonlySet<string> = new Set(["belt", "pipe"]);

export interface LineStroke {
  /** The line's stroke width. */
  width: number;
  /** A mixed line's inner stroke width, or a transport's gap (drawn over it in the canvas colour), or null for none. */
  inner: number | null;
  /** A transport's double line: the inner stroke is the gap between two rails, dashed exactly as the line. */
  double: boolean;
}

/** The stroke of a flow's line: its width from its rate's step, a mixed line's inner stroke, or a transport's double line. */
export function lineStroke(flow: Pick<CanvasFlow, "carrier" | "mixed" | "ratePerMinute" | "unit">): LineStroke {
  if (!LINE_CARRIERS.has(flow.carrier)) return { width: TRANSPORT_W, inner: TRANSPORT_GAP, double: true };
  const step = rateStep(flow.ratePerMinute, flow.unit);
  const { width, inner } = (step === null ? undefined : BY_STEP.get(step)) ?? BASE;
  return { width, inner: flow.mixed ? inner : null, double: false };
}
