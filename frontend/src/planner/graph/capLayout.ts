import { capText, moreCapsText } from "../plannerText";
import { capFluid, capQuality, capSlots, capStep, type CapQuality, type CapSlot, type DestinationCap } from "./capModel";
import { capSlotAt, type LaidNode } from "./layoutSite";
import { LINE_W_BASE, LINE_W_FAST, LINE_W_MID, LINE_W_SLOW } from "./lineWidth";
import { CAP_MARCH_MAX } from "./marching";
import type { RateStep } from "./rateStep";
import { isInView, type Stage, type View } from "./viewport";

/**
 * The destination caps on a laid-out canvas (ADR-0062 Decision 1): how each stub looks, which caps move at a view and the
 * keyboard's stops. Pure; `DestinationCaps.tsx` draws them.
 */

/** The stub's width by step, the lines' widths (`lineWidth.ts`), so a cap reads its rate as its lines do. */
const CAP_WIDTH: ReadonlyMap<RateStep, number> = new Map([
  ["slow", LINE_W_SLOW],
  ["mid", LINE_W_MID],
  ["fast", LINE_W_FAST],
]);
/** The stub's dash by quality, as a line's (ADR-0050 Decision 2): solid measured, dashed estimated, dotted unknown. */
const CAP_DASH: ReadonlyMap<CapQuality, string | undefined> = new Map([
  ["measured", undefined],
  ["estimated", "8 5"],
  ["unknown", "2 5"],
]);
export const capDash = (quality: CapQuality): string | undefined => CAP_DASH.get(quality);

/** A cap's stub colour, as a line's: a pipe's for fluid only, the unknown line's for no rate, else a belt's. */
export const capStroke = (cap: DestinationCap): string => (capFluid(cap) ? "stroke-info" : capQuality(cap) === "unknown" ? "stroke-line" : "stroke-muted");
/** A cap's stub width from its rate's step (a stalled cap keeps its rate's width, as a stalled line does). */
export const capWidth = (cap: DestinationCap): number => {
  const step = capStep({ rates: cap.rates });
  return step === null ? LINE_W_BASE : (CAP_WIDTH.get(step) ?? LINE_W_BASE);
};

/** A cap's id: its slot and its card (the "+k" cap is a slot too). */
export const capId = (cardKey: string, slot: number): string => `${slot}|${cardKey}`;

/** The words of a slot (its `<title>`; its button adds the card's name). */
export const slotText = (slot: CapSlot): string => (slot.kind === "cap" ? capText(slot.cap) : moreCapsText(slot.more));

/** A cap that can move: where its stub is (layout units), how, and the card's slot. */
export interface CapMarch {
  id: string;
  nodeKey: string;
  slot: number;
  step: RateStep;
  /** Measured: pulses over the canvas's solid stub. Estimated: the dashed stub itself, which the canvas then leaves out. */
  quality: "measured" | "estimated";
  x0: number;
  x1: number;
  y: number;
  width: number;
  stroke: string;
}

const STEP_RANK: ReadonlyMap<RateStep, number> = new Map([
  ["fast", 0],
  ["mid", 1],
  ["slow", 2],
]);

/** The caps that could move, per layout: fastest step first, then the layout's card order and the slot (deterministic). */
export function capCandidates(nodes: readonly Pick<LaidNode, "key" | "x" | "y" | "lines" | "card">[]): CapMarch[] {
  const out: CapMarch[] = [];
  for (const n of nodes) {
    if (n.card.caps === undefined || n.card.machines?.open === true) continue;
    capSlots(n.card.caps).forEach((s, slot) => {
      if (s.kind !== "cap") return;
      const step = capStep(s.cap);
      const quality = capQuality(s.cap);
      if (step === null || quality === "unknown") return;
      const at = capSlotAt(slot, n.lines.length);
      out.push({ id: capId(n.key, slot), nodeKey: n.key, slot, step, quality, x0: n.x + at.x0, x1: n.x + at.x1, y: n.y + at.cy, width: capWidth(s.cap), stroke: capStroke(s.cap) });
    });
  }
  // A stable sort: equal steps keep the card order.
  return out.sort((a, b) => STEP_RANK.get(a.step)! - STEP_RANK.get(b.step)!);
}

/** The caps that move at this view: those whose stub meets the stage, in the candidates' order, up to `cap`. */
export function marchingCaps(candidates: readonly CapMarch[], view: View, stage: Stage, cap = CAP_MARCH_MAX): CapMarch[] {
  const out: CapMarch[] = [];
  for (const c of candidates) {
    if (out.length >= cap) break;
    if (isInView(view, stage, { x: c.x0, y: c.y - c.width / 2, width: c.x1 - c.x0, height: c.width })) out.push(c);
  }
  return out;
}

/** One keyboard stop per drawn cap: its card, its slot, and its button's words. */
export interface CapStop {
  id: string;
  nodeKey: string;
  slot: number;
  name: string;
}

/** Every cap's stop, in the cards' tab order, then left to right. A group opened into its machines draws no caps. */
export function capStops(nodes: readonly Pick<LaidNode, "key" | "card">[]): CapStop[] {
  return nodes.flatMap((n) =>
    n.card.caps === undefined || n.card.machines?.open === true
      ? []
      : capSlots(n.card.caps).map((s, slot) => ({ id: capId(n.key, slot), nodeKey: n.key, slot, name: `${n.card.label} sends ${slotText(s)}` })),
  );
}
