import type { ProductionRate, ResourceNode } from "@satisfactory-dash/shared";
import { byString } from "./connectionGraph.js";

/**
 * ADR-0053 Decision 4, step 1 (ADR-0055 build PR 4): an extractor's item from the resource node under it. Pure and
 * deterministic: no I/O, no clock; the same nodes and point give the same answer in any input order.
 */

/** The nearest node counts only within this many metres of the extractor's output-port position (the end-0 point of a
 *  conveyor whose `from` is the extractor). `[NEEDS VERIFICATION]`: the port's offset from the node centre was not
 *  measured on the owner's save (FRM was off when PR 4 was built); 20 m is ADR-0053's estimate. */
export const EXTRACTOR_NODE_RADIUS_M = 20;
/** Ambiguity guard: a node of another (or an unknown) resource within this multiple of the nearest node's distance
 *  makes the extractor's item unknown. Nodes of the same resource never make it ambiguous: the item is the same. */
export const EXTRACTOR_NODE_AMBIGUITY_RATIO = 2;

/** Resource classes that come out as a fluid (m3/min); every other node resource is a solid (items/min). */
const FLUID_RESOURCES: ReadonlySet<string> = new Set(["Desc_LiquidOil_C", "Desc_Water_C", "Desc_NitrogenGas_C"]);
/** Extractors whose item is their class, with no node under them (ADR-0053 Decision 4: "Water extractors by class"). */
const ITEM_BY_EXTRACTOR_CLASS: ReadonlyMap<string, { className: string; name: string }> = new Map([
  ["Build_WaterPump_C", { className: "Desc_Water_C", name: "Water" }],
]);

export interface ResourceItem {
  className: string;
  name: string;
  unit: ProductionRate["unit"];
}

interface Located {
  x: number;
  y: number;
  className: string | null;
  name: string;
}

const unitOf = (className: string): ProductionRate["unit"] => (FLUID_RESOURCES.has(className) ? "m3/min" : "items/min");

/** The item an extractor of this building class always makes, or null when it needs a node. */
export function itemOfExtractorClass(buildClass: string): ResourceItem | null {
  const item = ITEM_BY_EXTRACTOR_CLASS.get(buildClass);
  return item ? { ...item, unit: unitOf(item.className) } : null;
}

/**
 * A lookup from a point to the resource under it: the nearest node within `EXTRACTOR_NODE_RADIUS_M`, unless a node of a
 * different or unknown resource is within `EXTRACTOR_NODE_AMBIGUITY_RATIO` times that distance. Geysers are left out
 * (no conveyor-connected extractor stands on one). A node without `className` (an older layer) still counts against
 * ambiguity but never names an item.
 */
export function resourceLookup(nodes: readonly ResourceNode[]): (x: number, y: number) => ResourceItem | null {
  const located: Located[] = [];
  for (const n of nodes) {
    if (n.nodeType === "geyser" || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    located.push({ x: n.x, y: n.y, className: n.className && n.className.length > 0 ? n.className : null, name: n.type });
  }
  // Input order never matters: ties between equally near nodes are decided by class and name.
  located.sort((a, b) => a.x - b.x || a.y - b.y || byString(a.className ?? "", b.className ?? "") || byString(a.name, b.name));
  return (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || located.length === 0) return null;
    let best: Located | null = null;
    let bestD = Infinity;
    for (const n of located) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        best = n;
        bestD = d;
      }
    }
    if (best === null || bestD > EXTRACTOR_NODE_RADIUS_M || best.className === null) return null;
    const window = EXTRACTOR_NODE_AMBIGUITY_RATIO * bestD;
    for (const n of located) {
      if (n.className === best.className) continue;
      if (Math.hypot(n.x - x, n.y - y) <= window) return null;
    }
    return { className: best.className, name: best.name, unit: unitOf(best.className) };
  };
}
