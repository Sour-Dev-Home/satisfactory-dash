import type { FactoryBuilding } from "@satisfactory-dash/shared";
import type { RateUnit } from "../format";

export interface ItemLabel {
  name: string;
  /** null = unknown: shown as "per min", never guessed (ADR-0015). */
  unit: RateUnit | null;
}

/**
 * Display names and units for history items, which carry only a class name. They come from the
 * live factory (every output and input the machines report), the same source as the table.
 */
export function itemLabels(buildings: FactoryBuilding[]): Map<string, ItemLabel> {
  const labels = new Map<string, ItemLabel>();
  for (const b of buildings) {
    for (const rate of [...b.production, ...(b.ingredients ?? [])]) {
      const known = labels.get(rate.className);
      // The first name wins; a unit fills in wherever any machine reports one.
      if (!known) labels.set(rate.className, { name: rate.name, unit: rate.unit ?? null });
      else if (known.unit === null && rate.unit) known.unit = rate.unit;
    }
  }
  return labels;
}

/**
 * An item that isn't in today's factory: its class name made readable ("Desc_IronPlate_C" →
 * "Iron Plate"), with no unit. Only the spelling changes; nothing is looked up or guessed.
 */
export function labelFor(labels: Map<string, ItemLabel>, className: string): ItemLabel {
  const known = labels.get(className);
  if (known) return known;
  const bare = className.replace(/^Desc_/, "").replace(/_C$/, "").replace(/_/g, " ");
  const name = bare.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return { name: name || className, unit: null };
}
