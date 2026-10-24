/**
 * Total power produced by one circuit group, in MW: what the in-game power graph shows as "Produced" (issue #620,
 * owner decision option A, 2026-10-24: the dash's "production" is the TOTAL, not FRM's base production).
 *
 * Why a derivation: FRM 1.5.4 reports `PowerProduction = mBaseProduction` (Power.cpp:47), which is the generators'
 * base output only. Grids that follow demand (regulated generators) add to it, so the base figure can sit far below
 * what is really produced (test server: 0 MW base while 4 MW consumed; owner's grid: 3,633 base, 1,314 used).
 * The SML 3.12.0 circuit exposes the total (`PowerProduced`, FGPowerCircuit.h:104 and :426-433), but FRM does not
 * forward it. [NEEDS VERIFICATION] None of these source lines is in docs-vault/raw-sources yet.
 *
 * Rule (inferred, not documented): a circuit cannot consume more than is produced, so `max(base, consumed)` is a
 * lower bound on the total that equals it when the grid follows demand, and equals the base figure when base
 * already exceeds the draw. Fits both observed cases above.
 *
 * Battery caveat [NEEDS VERIFICATION]: with batteries, discharge may count as production in the game's figure, so
 * the rule can be off. No battery heuristic is invented here; capture getPower + getGenerators with and without
 * batteries first (docs-vault/wiki/data-gap-analysis.md).
 *
 * Non-finite or negative inputs count as 0 (the adapter's usual guard), so garbage never yields NaN or a negative.
 */
export function totalPowerProductionMW(baseProductionMW: number, consumedMW: number): number {
  return Math.max(sanitizeMW(baseProductionMW), sanitizeMW(consumedMW));
}

function sanitizeMW(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
