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

/** A transport (train, truck, drone, Depot) keeps today's look until its double line (amendment build PR 4). */
export const TRANSPORT_W = 2;
export const TRANSPORT_MIXED_W = 3;

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
  /** A mixed line's inner stroke width (drawn over it in the canvas colour), or null for none. */
  inner: number | null;
}

/** The stroke of a flow's line: its width from its rate's step, and a mixed line's inner stroke. */
export function lineStroke(flow: Pick<CanvasFlow, "carrier" | "mixed" | "ratePerMinute" | "unit">): LineStroke {
  if (!LINE_CARRIERS.has(flow.carrier)) return { width: flow.mixed ? TRANSPORT_MIXED_W : TRANSPORT_W, inner: null };
  const step = rateStep(flow.ratePerMinute, flow.unit);
  const { width, inner } = (step === null ? undefined : BY_STEP.get(step)) ?? BASE;
  return { width, inner: flow.mixed ? inner : null };
}
