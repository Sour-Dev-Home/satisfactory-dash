/**
 * The speed step of a line or a destination cap (ADR-0062 amendment Decision 2): one function, so a line and its cap always
 * agree. The step reads the rate (items or m³ per minute), never the belt tier, and steps are never compared across units:
 * a fast pipe and a fast belt are each fast for their own unit. Three steps, not a continuous speed, so small differences
 * are not read as meaningful. Each step's dash cycle is a token (`--duration-flow-slow|mid|fast` in index.css).
 */
export type RateStep = "slow" | "mid" | "fast";

/**
 * Belts, in items/min. The thresholds are full belts of two tiers FRM reports (Mk.1 60, Mk.2 120, Mk.3 270, Mk.4 480:
 * `docs-vault/raw-sources/frm-conveyor-gchecks-2026-10-21.md`): under a full Mk.2 is slow, up to a full Mk.4 is mid, a full
 * Mk.4 or more (a bundle, or a faster tier) is fast. Mk.5 and Mk.6 capacities are not in raw-sources [NEEDS VERIFICATION];
 * no threshold depends on them.
 */
export const ITEMS_MID_FROM = 120;
export const ITEMS_FAST_FROM = 480;

/**
 * Pipes, in m³/min: under a full Mk.1 pipe (300) is slow, up to a full Mk.2 (600) is mid, a full Mk.2 or more is fast
 * (the same raw source, G-B2).
 */
export const FLUID_MID_FROM = 300;
export const FLUID_FAST_FROM = 600;

interface Thresholds {
  midFrom: number;
  fastFrom: number;
}

const THRESHOLDS = new Map<string, Thresholds>([
  ["items/min", { midFrom: ITEMS_MID_FROM, fastFrom: ITEMS_FAST_FROM }],
  ["m3/min", { midFrom: FLUID_MID_FROM, fastFrom: FLUID_FAST_FROM }],
]);

/**
 * The step for a rate in its unit: at or above a threshold is the higher step. Null, so the line does not move, for a rate
 * that is missing, 0, negative or not finite, and for a unit with no thresholds (missing or a unit this build doesn't know).
 * A stalled flow does not move whatever its rate; that is the caller's check, not this one.
 */
export function rateStep(ratePerMinute: number | null | undefined, unit: string | null | undefined): RateStep | null {
  if (ratePerMinute === null || ratePerMinute === undefined || !Number.isFinite(ratePerMinute) || ratePerMinute <= 0) return null;
  const at = unit === null || unit === undefined ? undefined : THRESHOLDS.get(unit);
  if (at === undefined) return null;
  if (ratePerMinute >= at.fastFrom) return "fast";
  return ratePerMinute >= at.midFrom ? "mid" : "slow";
}
