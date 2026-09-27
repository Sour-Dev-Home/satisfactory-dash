/** Game units (the centimetre, docs-vault/raw-sources/world-coordinates.md) to the whole-metre
 *  integers the map contract uses (ADR-0038 M1, packages/shared/src/map.ts's WholeMetreSchema). */
export function toWholeMetres(gameUnits: number): number {
  return Math.round(gameUnits / 100);
}

/** The M1 contract's WholeMetreSchema bound: finite and within ±1,000,000 m. A mapper (architect
 *  follow-up on #367) uses this to drop a bad item rather than reject a whole layer — the agent's
 *  own conform-don't-reject rule, docs-vault/wiki/runbooks/agent-app.md. */
export const MAX_WHOLE_METRES = 1_000_000;
export function inWholeMetreBounds(wholeMetres: number): boolean {
  return Number.isFinite(wholeMetres) && Math.abs(wholeMetres) <= MAX_WHOLE_METRES;
}
