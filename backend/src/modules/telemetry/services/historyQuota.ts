import type { ItemSampleRow, PowerSampleRow } from "../repositories/historyRepository.js";

/**
 * #515 (ADR-0045 M11): per-sample caps on what one server writes to durable history, set from real factories rather
 * than from the input schema (which allows 1,000 circuits and 20,000 buildings with 16 rates each, so a forged snapshot
 * could write about 2,600 rows a second). Only history is capped: the live views, the power chart's memory and the
 * alert engine's board still see the whole reading.
 *
 * Measured (docs-vault/raw-sources/captured-responses): the owner's tier-6 save, 338 factory buildings, has ONE power
 * circuit (every frm-getPower capture of 2026-09-22) and makes 49 distinct items (frm-getProdStats-2026-09-27-full.json),
 * all of them in the item catalog.
 */

/**
 * Circuits recorded per power sample. A real factory has one grid plus one per power switch or isolated sub-grid:
 * the measured save has 1. 64 is that with a wide margin for a megabase that splits its grid, and bounds power
 * history at 64 rows per sample: at most one sample every 2.5 s (agentIngest's `powerDue`, half the 5 s agent cadence),
 * so about 26 rows a second instead of 400 at the schema's 1,000 circuits.
 */
export const MAX_POWER_SAMPLE_CIRCUITS = 64;

/**
 * Items NOT in the item catalog recorded per item sample. Catalog items are always recorded: the catalog holds every
 * item the game has (195 class names, itemForms.generated.json), so they are bounded by it, and the measured save's 49
 * items are all in it. An unknown class name is a modded item, one newer than the catalog, or a made-up one; a mod
 * adds a few dozen at most, so 64 keeps a modded factory whole while a forged snapshot can no longer invent thousands.
 * An item sample is then at most 195 + 64 rows, at most every 15 s (half the 30 s factory cadence).
 */
export const MAX_UNCATALOGED_ITEMS_PER_SAMPLE = 64;

export interface Capped<T> {
  kept: T[];
  dropped: number;
}

/**
 * One power sample's rows, at most `max` circuits. Over the cap the LOWEST circuit ids are kept, in their original
 * order, so the same circuits are recorded sample after sample (a stable series) whatever order a snapshot lists them.
 */
export function capPowerSample(rows: PowerSampleRow[], max = MAX_POWER_SAMPLE_CIRCUITS): Capped<PowerSampleRow> {
  const circuits = new Set(rows.map((row) => row.circuit));
  if (circuits.size <= max) return { kept: rows, dropped: 0 };
  const allowed = new Set([...circuits].sort((a, b) => a - b).slice(0, max));
  const kept = rows.filter((row) => allowed.has(row.circuit));
  return { kept, dropped: rows.length - kept.length };
}

/**
 * One item sample's rows: every catalog item, plus at most `max` items the catalog does not know. Over the cap the
 * unknown items that sort first by class name are kept (stable from sample to sample), in their original order.
 */
export function capItemSample(
  rows: ItemSampleRow[],
  isCataloged: (className: string) => boolean,
  max = MAX_UNCATALOGED_ITEMS_PER_SAMPLE,
): Capped<ItemSampleRow> {
  const unknown = new Set<string>();
  for (const row of rows) if (!isCataloged(row.item)) unknown.add(row.item);
  if (unknown.size <= max) return { kept: rows, dropped: 0 };
  const allowed = new Set([...unknown].sort().slice(0, max));
  const kept = rows.filter((row) => isCataloged(row.item) || allowed.has(row.item));
  return { kept, dropped: rows.length - kept.length };
}
