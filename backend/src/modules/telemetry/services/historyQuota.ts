import type { ItemSampleRow, PowerSampleRow } from "../repositories/historyRepository.js";

/**
 * #515 (ADR-0045 M11): caps on what one server writes to durable history, set from real factories rather than from
 * the input schema (which allows 1,000 circuits and 20,000 buildings with 16 rates each, so a forged snapshot could
 * write about 2,600 rows a second). Only history is capped: the live views, the power chart's memory and the alert
 * engine's board still see the whole reading.
 *
 * Two layers, because the agent picks the identifiers:
 * - per SAMPLE: at most N circuits (or unknown items) in one sample, which bounds the raw rows;
 * - per SERIES and UTC hour: at most N distinct (session, circuit) pairs, and N distinct unknown item names, per
 *   server in any one UTC hour. The rollups are keyed by series and bucketed by UTC minute and hour
 *   (historyRepository.ts), so a mod that sends new circuit ids, a new session name or new made-up items every
 *   sample creates no more rollup rows than an honest factory at the cap would: at most N series per minute bucket
 *   and per hour bucket. An honest server is unaffected: its series repeat, and a session change starts the next
 *   hour with room for the new one at the latest.
 *
 * Measured (docs-vault/raw-sources/captured-responses): the owner's tier-6 save, 338 factory buildings, has ONE power
 * circuit (every frm-getPower capture of 2026-09-22) and makes 49 distinct items (frm-getProdStats-2026-09-27-full.json),
 * all of them in the item catalog.
 */

/**
 * Circuits recorded per power sample, and (session, circuit) series per server per UTC hour. A real factory has one
 * grid plus one per power switch or isolated sub-grid: the measured save has 1. 64 is that with a wide margin for a
 * megabase that splits its grid, and bounds power history at 64 rows per sample: at most one sample every 2.5 s
 * (agentIngest's `powerDue`, half the 5 s agent cadence), so about 26 rows a second instead of 400 at the schema's 1,000
 * circuits, and at most 64 minute-rollup rows a minute and 64 hour-rollup rows an hour.
 */
export const MAX_POWER_SAMPLE_CIRCUITS = 64;

/**
 * Items NOT in the item catalog recorded per item sample, and distinct such names per server per UTC hour. Catalog
 * items are always recorded: the catalog holds every item the game has (195 class names, itemForms.generated.json), so
 * they are bounded by it, and the measured save's 49 items are all in it. An unknown class name is a modded item, one
 * newer than the catalog, or a made-up one; a mod adds a few dozen at most, so 64 keeps a modded factory whole while a
 * forged snapshot can no longer invent thousands. An item sample is then at most 195 + 64 rows, at most every 15 s
 * (half the 30 s factory cadence).
 */
export const MAX_UNCATALOGED_ITEMS_PER_SAMPLE = 64;

const HOUR_MS = 60 * 60_000;

/**
 * The distinct series one server may write in a UTC hour (the rollups' hour bucket). Keys are admitted until `max`;
 * a key already admitted for that hour is always admitted again. The current and the previous hour are kept, so a
 * reading stamped just before the hour turned (the agent's clock tolerance is 60 s) still finds its hour; an older one
 * is refused. A restart starts empty, which at most doubles one hour's series.
 */
export class SeriesQuota {
  private readonly hours = new Map<number, Set<string>>();

  constructor(private readonly max: number) {}

  admit(key: string, atMs: number): boolean {
    const hour = Math.floor(atMs / HOUR_MS);
    let admitted = this.hours.get(hour);
    if (admitted === undefined) {
      const newest = Math.max(-Infinity, ...this.hours.keys());
      if (hour < newest - 1) return false;
      admitted = new Set();
      this.hours.set(hour, admitted);
      for (const kept of this.hours.keys()) if (kept < Math.max(hour, newest) - 1) this.hours.delete(kept);
    }
    if (admitted.has(key)) return true;
    if (admitted.size >= this.max) return false;
    admitted.add(key);
    return true;
  }
}

export interface Capped<T> {
  kept: T[];
  dropped: number;
}

/** The first row per key, in order: a repeated circuit or item at the same time is a wasted insert (the table's key is
 *  unique, so only the first would be stored anyway). */
function firstPerKey<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const first = new Map<string, T>();
  for (const row of rows) if (!first.has(key(row))) first.set(key(row), row);
  return first;
}

/**
 * One power sample's rows: one per circuit, at most `max` circuits, and (with a quota) only circuits whose
 * (session, circuit) series the server may still write this hour. Circuits are considered lowest id first, so the same
 * ones are recorded sample after sample whatever order a snapshot lists them; the kept rows keep their original order.
 */
export function capPowerSample(rows: PowerSampleRow[], quota?: SeriesQuota, max = MAX_POWER_SAMPLE_CIRCUITS): Capped<PowerSampleRow> {
  const first = firstPerKey(rows, (row) => `${row.atMs}:${row.circuit}`);
  const keep = new Set<PowerSampleRow>();
  for (const row of [...first.values()].sort((a, b) => a.circuit - b.circuit || a.atMs - b.atMs)) {
    if (keep.size >= max) break;
    if (quota === undefined || quota.admit(`${row.session}:${row.circuit}`, row.atMs)) keep.add(row);
  }
  const kept = rows.filter((row) => keep.has(row));
  return { kept, dropped: rows.length - kept.length };
}

/**
 * One item sample's rows: one per item; every catalog item, plus at most `max` items the catalog does not know and
 * (with a quota) only unknown names the server may still write this hour. Unknown names are considered in name order
 * (stable from sample to sample); the kept rows keep their original order.
 */
export function capItemSample(
  rows: ItemSampleRow[],
  isCataloged: (className: string) => boolean,
  quota?: SeriesQuota,
  max = MAX_UNCATALOGED_ITEMS_PER_SAMPLE,
): Capped<ItemSampleRow> {
  const first = firstPerKey(rows, (row) => `${row.atMs}:${row.item}`);
  const keep = new Set<ItemSampleRow>();
  const unknown: ItemSampleRow[] = [];
  for (const row of first.values()) {
    if (isCataloged(row.item)) keep.add(row);
    else unknown.push(row);
  }
  let admitted = 0;
  for (const row of unknown.sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.atMs - b.atMs))) {
    if (admitted >= max) break;
    if (quota === undefined || quota.admit(row.item, row.atMs)) {
      keep.add(row);
      admitted++;
    }
  }
  const kept = rows.filter((row) => keep.has(row));
  return { kept, dropped: rows.length - kept.length };
}
