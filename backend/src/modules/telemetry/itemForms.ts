import { z } from "zod";
import type { ProductionRate } from "@satisfactory-dash/shared";
import type { ItemForm } from "./parseGameDocs.js";
import catalogFile from "./itemForms.generated.json";

/**
 * ADR-0015: whether an item is a solid or a fluid comes from the game's own data
 * (CommunityResources/Docs/en-US.json), not from any API response. The committed catalog
 * (itemForms.generated.json) is produced by `npm run update-item-forms -w backend`, and
 * this file resolves a className against it to the contract's `unit`.
 */
export type ProductionUnit = NonNullable<ProductionRate["unit"]>;

export interface ItemFormCatalog {
  /** Recorded so a reader can tell how old the data is. */
  meta: { gameVersion: string; generatedAt: string; source: string; sourceSha256: string };
  forms: Record<string, ItemForm>;
}

/** The committed catalog, checked once at load. */
export const itemFormCatalog: ItemFormCatalog = z
  .object({
    meta: z.object({
      gameVersion: z.string(),
      generatedAt: z.string(),
      source: z.string(),
      sourceSha256: z.string(),
    }),
    forms: z.record(z.string(), z.enum(["solid", "fluid"])),
  })
  .parse(catalogFile);

const UNIT_BY_FORM: Record<ItemForm, ProductionUnit> = { solid: "items/min", fluid: "m3/min" };

/**
 * className -> the contract's `unit`, or null for an item that isn't in the catalog (a
 * modded item, or one newer than the catalog). Each unknown className is reported through
 * `onUnknown` once per resolver, so create ONE resolver per process (the composition root
 * does) and the gaps are measurable in the logs without flooding them.
 */
export function createUnitResolver(
  onUnknown: (className: string) => void,
  forms: Record<string, ItemForm> = itemFormCatalog.forms,
): (className: string) => ProductionUnit | null {
  const reported = new Set<string>();
  return (className) => {
    // Own keys only: a className like "constructor" or "__proto__" must not resolve.
    const form = Object.hasOwn(forms, className) ? forms[className] : undefined;
    if (form) {
      return UNIT_BY_FORM[form];
    }
    if (!reported.has(className)) {
      reported.add(className);
      onUnknown(className);
    }
    return null;
  };
}
