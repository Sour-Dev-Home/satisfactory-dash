/** The grid's totals across every circuit: what's drawn and what can be generated. */
export type PowerTotals = { consumptionMW: number; capacityMW: number; circuits: number };
export type PowerState = PowerTotals | "pending" | "error";

/** The grid across every circuit, as the backend reported each one (summed, never re-derived). */
export function powerTotals(circuits: readonly { consumptionMW: number; capacityMW: number }[]): PowerTotals {
  return {
    consumptionMW: circuits.reduce((sum, c) => sum + c.consumptionMW, 0),
    capacityMW: circuits.reduce((sum, c) => sum + c.capacityMW, 0),
    circuits: circuits.length,
  };
}

/** Consumption over capacity, 0 to 1 (an overloaded grid fills the bar, never past it). */
export function capacityShare({ consumptionMW, capacityMW }: PowerTotals): number {
  if (!(capacityMW > 0) || !(consumptionMW > 0)) return 0;
  return Math.min(consumptionMW / capacityMW, 1);
}
