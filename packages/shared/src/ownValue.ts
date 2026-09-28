/**
 * A lookup table's own value for `key`, or `undefined`: never an inherited member. `table[key]` with a key from data
 * returns `Object.prototype.toString` for "toString" (and so on), which passes a truthiness or closed-set check (#361,
 * #367). Callers keep their own fallback: `ownValue(STATE_COLOR, state) ?? "muted"`.
 * The lint rule safe-lookup/no-table-index (scripts/lint/safe-lookup.mjs, #368) points here.
 */
export function ownValue<T extends object>(table: T, key: PropertyKey): T[keyof T] | undefined {
  return Object.hasOwn(table, key) ? (table as Record<PropertyKey, T[keyof T]>)[key] : undefined;
}
