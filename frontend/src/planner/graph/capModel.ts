import type { StalledKind } from "../plannerText";
import type { FlowQuality } from "./hierarchy";
import { rateStep, type RateStep } from "./rateStep";

/**
 * Destination caps (ADR-0062 Decision 1), as data: where a card's flows end that the picture draws no line to (the Depot,
 * the Sink, power, a station, folded storage, an unknown end), one cap per destination kind. Pure; `DestinationCaps.tsx`
 * draws them, `capText` (plannerText.ts) words them. The speed step is `rateStep`, the lines' own, so a line and its cap
 * always agree.
 */

type PerMinuteUnit = "items/min" | "m3/min";

/** One unit's summed rate of a cap's flows, by ADR-0053 Decision 3's rule (weakest quality wins, "at least" when a part is unknown). */
export interface CapRate {
  unit: PerMinuteUnit;
  ratePerMinute: number | null;
  quality: FlowQuality;
}

export interface DestinationCap {
  /** The destination kind: a key of `CHIP_WORD` (storage, depot, sink, power, export, unknown) or a newer backend's word. */
  destination: string;
  /** How many flows end there (the number badge past 1). */
  count: number;
  /** The summed rate per unit, items first; empty when no flow said its rate. */
  rates: CapRate[];
  /** The card's machines are stalled and no flow was measured moving (ADR-0062 Decision 2): the cap does not move. */
  stalled?: StalledKind | undefined;
}

/** A card shows at most this many cap slots: past it, the first `CAPS_MAX - 1` kinds and a "+k" cap that opens the detail. */
export const CAPS_MAX = 4;

export type CapSlot = { kind: "cap"; cap: DestinationCap } | { kind: "more"; more: DestinationCap[] };

/** The slots a card draws: every cap up to `CAPS_MAX`, else the first `CAPS_MAX - 1` and one "+k" for the rest. */
export function capSlots(caps: readonly DestinationCap[]): CapSlot[] {
  if (caps.length <= CAPS_MAX) return caps.map((cap) => ({ kind: "cap", cap }));
  return [...caps.slice(0, CAPS_MAX - 1).map((cap): CapSlot => ({ kind: "cap", cap })), { kind: "more", more: caps.slice(CAPS_MAX - 1) }];
}

/** How sure a cap's rate is, for its stub: unknown (dotted, still) when no unit has a number, measured only when all are. */
export type CapQuality = "measured" | "estimated" | "unknown";

const hasNumber = (r: CapRate): boolean => r.quality !== "unknown" && r.ratePerMinute !== null && Number.isFinite(r.ratePerMinute);

export function capQuality(cap: Pick<DestinationCap, "rates">): CapQuality {
  if (!cap.rates.some(hasNumber)) return "unknown";
  return cap.rates.every((r) => r.quality === "measured" && hasNumber(r)) ? "measured" : "estimated";
}

const STEP_RANK: ReadonlyMap<RateStep, number> = new Map([
  ["slow", 0],
  ["mid", 1],
  ["fast", 2],
]);

/**
 * The step a cap's dashes travel at, or null when it stays still: a stalled cap, an unknown rate, or a rate with no step (0,
 * missing). Each unit's step is its own (`rateStep` never compares units); a cap of items and fluid moves at the faster.
 */
export function capStep(cap: Pick<DestinationCap, "rates" | "stalled">): RateStep | null {
  if (cap.stalled !== undefined || capQuality(cap) === "unknown") return null;
  let best: RateStep | null = null;
  for (const r of cap.rates) {
    const step = hasNumber(r) ? rateStep(r.ratePerMinute, r.unit) : null;
    if (step !== null && (best === null || STEP_RANK.get(step)! > STEP_RANK.get(best)!)) best = step;
  }
  return best;
}

/** Whether every flow of the cap is a fluid (its stub then wears the pipe colour, as a pipe line does). */
export const capFluid = (cap: Pick<DestinationCap, "rates">): boolean => cap.rates.length > 0 && cap.rates.every((r) => r.unit === "m3/min");

/** Whether the game measured the cap's flows moving: a stalled card's cap is not stalled then (as `withStalledFlows` does for lines). */
export const capMoving = (cap: Pick<DestinationCap, "rates">): boolean => capQuality(cap) === "measured" && cap.rates.some((r) => (r.ratePerMinute ?? 0) > 0);

/** Flows summed per unit (items first) by ADR-0053 Decision 3's rule, as `aggregateFlows` sums a line. */
export function sumCapRates(parts: readonly { ratePerMinute: number | null; rate: "measured" | "estimated" | "unknown"; unit: PerMinuteUnit }[]): CapRate[] {
  const out: CapRate[] = [];
  for (const unit of ["items/min", "m3/min"] as const) {
    const list = parts.filter((p) => p.unit === unit);
    if (list.length === 0) continue;
    const known = list.filter((p) => p.ratePerMinute !== null && Number.isFinite(p.ratePerMinute) && p.rate !== "unknown");
    const sum = known.reduce((total, p) => total + (p.ratePerMinute ?? 0), 0);
    const quality: FlowQuality =
      known.length === 0 ? "unknown" : known.length < list.length ? "atLeast" : list.every((p) => p.rate === "measured") ? "measured" : "estimated";
    out.push({ unit, ratePerMinute: known.length === 0 ? null : sum, quality });
  }
  return out;
}

/** A card's caps from its flows' ends, with the card's stalled state applied (a measured moving cap is never stalled). */
export function withCapStalled(caps: readonly DestinationCap[], stalled: StalledKind | undefined): DestinationCap[] {
  return caps.map((cap) => (stalled === undefined || capMoving(cap) ? cap : { ...cap, stalled }));
}
