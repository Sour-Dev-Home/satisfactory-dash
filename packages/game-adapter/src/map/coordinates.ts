/** Game units (the centimetre, docs-vault/raw-sources/world-coordinates.md) to the whole-metre
 *  integers the map contract uses (ADR-0038 M1, packages/shared/src/map.ts's WholeMetreSchema). */
export function toWholeMetres(gameUnits: number): number {
  return Math.round(gameUnits / 100);
}
