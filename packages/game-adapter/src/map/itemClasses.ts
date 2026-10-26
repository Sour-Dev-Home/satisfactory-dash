import { TRAIN_ROUTES_MAX_ITEM_CLASSES } from "@satisfactory-dash/shared";

/** The contract's string bound (`boundedString` and item classes, 200 characters). */
export const MAX_STRING = 200;

export const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const byId = (a: { id: string }, b: { id: string }) => compareText(a.id, b.id);

/** Distinct item classes across inventories, sorted and capped. Classes the contract cannot hold are skipped. Amounts are
 *  ignored on purpose: a world layer's hash must be stable between reads (ADR-0055 Decision 1). */
export function itemClasses(inventories: ReadonlyArray<ReadonlyArray<{ ClassName?: string | undefined }>>): string[] {
  const set = new Set<string>();
  for (const inventory of inventories) {
    for (const entry of inventory) {
      const cls = entry.ClassName;
      if (cls !== undefined && cls.length > 0 && cls.length <= MAX_STRING) set.add(cls);
    }
  }
  return [...set].sort(compareText).slice(0, TRAIN_ROUTES_MAX_ITEM_CLASSES);
}
