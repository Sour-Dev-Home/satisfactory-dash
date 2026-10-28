import type { CanvasFlow } from "./canvasScene";
import { rateStep, type RateStep } from "./rateStep";
import { isInView, type Stage, type View } from "./viewport";

/**
 * Marching dashes (ADR-0062 amendment Decision 1, build PR 3): a belt or pipe line with a measured or estimated rate that is
 * not stalled marches at its rate's step, by a CSS class (`animate-flow-*` in index.css); no per-edge JS, no inline styles.
 * Only lines in view march, at most `MARCH_MAX` of them, so the cost is bounded by the view, not the factory's size. They are
 * drawn in SiteGraph's `MarchLayer`, an `<svg>` of their own over the canvas, so their per-frame repaint is the layer's (the
 * marching strokes) and not the whole canvas's; `marchHoles` keeps them from showing over the labels and cards.
 */

/**
 * At most this many lines march at once (owner answer 2, "Lines in view, capped"). Chosen before the box run from what a
 * repainted canvas costs; the e2e measurement on the 200+ edge factory records the frame times to confirm it (see the
 * amendment's "Values chosen in build PR 3").
 */
export const MARCH_MAX = 60;

/** The view the march set is chosen for settles this long after the last pan or zoom, so a drag recomputes nothing per frame. */
export const MARCH_SETTLE_MS = 150;

/**
 * A measured line's pulses: short dashes over the solid line, drawn only while marching. Its cycle (3 + 10) is the estimated
 * dash's (8 + 5) and `--flow-dash-cycle` in index.css, so every marching line moves the same distance per cycle.
 */
export const PULSE_DASH = "3 10";
/** A pulse is half its line's width (a mixed line's inner width), but never thinner than this, so a slow line's beads show. */
export const PULSE_MIN_W = 1.25;

/** The carriers whose lines march; a transport's glyph moves instead (build PR 4's double line). */
const MARCH_CARRIERS: ReadonlySet<string> = new Set(["belt", "pipe"]);
/** Fastest first: under the cap the fastest lines keep their motion. */
const STEP_RANK: ReadonlyMap<RateStep, number> = new Map([
  ["fast", 0],
  ["mid", 1],
  ["slow", 2],
]);

/**
 * The step a line marches at, or null when it stays still: a transport, an unknown rate (static and dotted), a stalled line
 * (static, its stop bar in marks mode; still in words mode too, since motion would claim a flow), or a rate with no step
 * (0, missing). An "at least" rate is `rate: "estimated"` here, so it marches at its step.
 */
export function marchStep(flow: Pick<CanvasFlow, "carrier" | "rate" | "ratePerMinute" | "unit" | "stalled">): RateStep | null {
  if (!MARCH_CARRIERS.has(flow.carrier) || flow.rate === "unknown" || flow.stalled !== undefined) return null;
  return rateStep(flow.ratePerMinute, flow.unit);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A route's bounds in layout units (empty for no points). */
export function routeBox(points: readonly { x: number; y: number }[]): Box {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A line that could march: its edge index, its step and its route's bounds. */
export interface MarchCandidate {
  index: number;
  step: RateStep;
  box: Box;
}

/**
 * The lines that could march, in the cap's order: fastest step first, then the layout's edge order (stable across polls that
 * keep the layout). Per layout, not per view, so a pan only tests boxes.
 */
export function marchCandidates(edges: readonly { index: number; flow: CanvasFlow; points: readonly { x: number; y: number }[] }[]): MarchCandidate[] {
  const out: MarchCandidate[] = [];
  for (const e of edges) {
    const step = marchStep(e.flow);
    if (step === null || e.points.length < 2) continue;
    out.push({ index: e.index, step, box: routeBox(e.points) });
  }
  return out.sort((a, b) => STEP_RANK.get(a.step)! - STEP_RANK.get(b.step)! || a.index - b.index);
}

/**
 * The lines that march at this view: each candidate whose route's bounds meet the stage, in the candidates' order, until
 * `cap`. A line past the cap or out of view stays static. Its step, by edge index.
 */
export function marchingLines(candidates: readonly MarchCandidate[], view: View, stage: Stage, cap = MARCH_MAX): Map<number, RateStep> {
  const out = new Map<number, RateStep>();
  for (const c of candidates) {
    if (out.size >= cap) break;
    if (isInView(view, stage, c.box)) out.set(c.index, c.step);
  }
  return out;
}

/** A bubble's or a fold's card has a pile behind it: a second card this far right and down (SiteGraph's `CardView`). */
export const CARD_STACK_OFFSET = 5;
/** A card's corner (an open group's is 10; a line never meets a corner, so one radius serves the mask). */
const CARD_RX = 8;

/** Something the canvas draws over its lines, as a box with a corner radius: a hole in the march layer's mask. */
export interface MarchHole extends Box {
  rx: number;
}

/**
 * What the canvas draws over its lines (SiteGraph's labels layer and cards), which the march layer must not draw over: every
 * line's label pill, every card, and the pile behind a bubble's or a fold's card. The march layer is its own `<svg>` over the
 * whole canvas, so without these holes a marching line would show through a label or a card it runs under. Per layout.
 */
export function marchHoles(
  nodes: readonly { x: number; y: number; width: number; height: number; card: { kind: string } }[],
  edges: readonly { labelX: number; labelY: number; labelWidth: number; labelHeight: number }[],
): MarchHole[] {
  const out: MarchHole[] = [];
  for (const e of edges) {
    out.push({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight, rx: Math.min(e.labelHeight, e.labelWidth) / 2 });
  }
  for (const n of nodes) {
    out.push({ x: n.x, y: n.y, width: n.width, height: n.height, rx: CARD_RX });
    if (n.card.kind === "bubble" || n.card.kind === "fold") {
      out.push({ x: n.x + CARD_STACK_OFFSET, y: n.y + CARD_STACK_OFFSET, width: n.width, height: n.height, rx: CARD_RX });
    }
  }
  return out;
}
