// Pure display formatters, shared by views (and later by map layers). They round for
// display only; they never change a value's unit or meaning (ADR-0006).
import type { ProductionRate } from "@satisfactory-dash/shared";

/** An ADR-0004 observedAt (UTC ISO string) in the viewer's local time. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Whole seconds as "45 s", "12 m", "5 h 3 m" or "1 d 2 h 50 m" (floored). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60) % 60;
  const hours = Math.floor(s / 3600) % 24;
  const days = Math.floor(s / 86_400);
  if (days > 0) return `${days} d ${hours} h ${minutes} m`;
  if (hours > 0) return `${hours} h ${minutes} m`;
  return `${minutes} m`;
}

/** Server ticks per second, one decimal. */
export function formatTickRate(ticksPerSecond: number): string {
  return `${ticksPerSecond.toFixed(1)} ticks/s`;
}

// Fixed en-US grouping so values read the same everywhere (and in tests): "3,633.3".
// signDisplay "negative": a value that rounds to zero prints "0", never "-0".
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "negative" });

/** Rounds to the one decimal the formatters display, so labels can match what's shown. */
export function roundForDisplay(value: number): number {
  // Round the magnitude: Intl rounds half away from zero, Math.round(-0.5) is -0.
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** Megawatts, as the contract reports them (never rescaled to GW). */
export function formatMW(megawatts: number): string {
  return `${oneDecimal.format(megawatts)} MW`;
}

/** Megawatt-hours of battery storage. */
export function formatMWh(megawattHours: number): string {
  return `${oneDecimal.format(megawattHours)} MWh`;
}

/** A 0-100 percentage. */
export function formatPercent(percent: number): string {
  return `${oneDecimal.format(percent)}%`;
}

/** A rate's unit from the contract (ADR-0015); formatRate treats null/undefined as unknown. */
export type RateUnit = NonNullable<ProductionRate["unit"]>;

const UNIT_LABEL: Record<RateUnit, string> = { "items/min": "items/min", "m3/min": "m³/min" };

/**
 * A production rate as "5.6 / 60 per min". Without a unit it never guesses "items" or
 * "m³" (ADR-0006: no solid/fluid source yet); every rate label goes through here, so the
 * unit only has to be passed in at the call sites once the contract adds it.
 */
export function formatRate(currentPerMinute: number, maxPerMinute: number, unit?: RateUnit | null): string {
  return `${oneDecimal.format(currentPerMinute)} / ${oneDecimal.format(maxPerMinute)} ${unitLabel(unit)}`;
}

/** The label after a rate: "items/min", "m³/min", or "per min" when the unit is unknown. */
export function unitLabel(unit?: RateUnit | null): string {
  return unit ? UNIT_LABEL[unit] : "per min";
}

/** One rate per minute, e.g. "18.2 items/min" (rounded like formatRate, never rescaled). */
export function formatPerMinute(perMinute: number, unit?: RateUnit | null): string {
  return `${formatAmount(perMinute)} ${unitLabel(unit)}`;
}

/** A bare amount rounded like the rates, e.g. "3,633.3", for "40 → 12 items/min". */
export function formatAmount(value: number): string {
  return oneDecimal.format(value);
}
