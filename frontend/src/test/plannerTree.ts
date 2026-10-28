import { ProductionGraphSchema, type PlannerDesignation, type PlannerEdge, type PlannerFactory, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";

/**
 * A small nested world for the factory tree (ADR-0061), built on the shared factories fixture: T "Main base" (no machines
 * of its own) > P "Smelters" (owns n1) > C1 "Plates" (n2) and C2 "Rods" (n3), plus the automatic "Screws" (n4). n1 feeds
 * C1 (measured) and C2 (estimated); C2 feeds Screws, outside P.
 */

const base: ProductionGraph = ProductionGraphSchema.parse(productionGraphFactories.data);
const baseNode: PlannerNode = base.nodes[0]!;
const baseEdge: PlannerEdge = base.edges[0]!;
const baseFactory: PlannerFactory = base.factories![0]!;

export const treeId = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const T = treeId(1);
export const P = treeId(2);
export const C1 = treeId(3);
export const C2 = treeId(4);
export const AUTO_KEY = "factory|auto";

export function treeNode(key: string, className: string, current: number, max: number, count = 2): PlannerNode {
  const { shares: _shares, factoryKey: _factoryKey, ...rest } = baseNode;
  return {
    ...rest,
    key,
    count,
    stateCounts: { operating: count },
    products: [{ className, name: className, unit: "items/min", currentPerMinute: current, maxPerMinute: max }],
  };
}

export function treeEdge(from: string, to: string, item: string, rate: number | null, quality: PlannerEdge["rate"]): PlannerEdge {
  return { ...baseEdge, from, to, itemClassName: item, itemName: item, ratePerMinute: rate, rate: quality, mixed: false, kind: "belt", flow: "supply" };
}

export function treeFactory(key: string, name: string, nodes: readonly PlannerNode[], designationId: string | null, parent: string | null): PlannerFactory {
  return {
    ...baseFactory,
    key,
    name,
    designationId,
    parentDesignationId: parent,
    nodeKeys: nodes.map((n) => n.key),
    siteKeys: [...new Set(nodes.map((n) => n.siteKey))],
    machineCount: nodes.reduce((s, n) => s + n.count, 0),
    sharedNodeCount: 0,
    sideProducts: [],
    products: nodes.flatMap((n) => n.products),
  };
}

export function treeDesignation(id: string, name: string, parentId: string | null, members = 1): PlannerDesignation {
  return {
    id,
    name,
    mode: "core",
    members: Array.from({ length: members }, (_, i) => ({ id: `${id}-m${i}`, c: "Build_SmelterMk1_C", x: 0, y: 0 })),
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    revision: 1,
    parentId,
  };
}

export const designated = (id: string): string => `factory|designation|${id}`;

export function treeWorld(): { graph: ProductionGraph; designations: PlannerDesignation[] } {
  const n1 = treeNode("n1", "Desc_IronIngot_C", 60, 60);
  const n2 = treeNode("n2", "Desc_IronPlate_C", 30, 40);
  const n3 = treeNode("n3", "Desc_IronRod_C", 10, 10, 1);
  const n4 = treeNode("n4", "Desc_IronScrew_C", 20, 40, 3);
  const graph: ProductionGraph = {
    ...base,
    nodes: [n1, n2, n3, n4],
    edges: [
      treeEdge("n1", "n2", "Desc_IronIngot_C", 30, "measured"),
      treeEdge("n1", "n3", "Desc_IronIngot_C", 10, "estimated"),
      treeEdge("n3", "n4", "Desc_IronRod_C", 5, "measured"),
    ],
    transports: [],
    factories: [
      treeFactory(designated(P), "Smelters", [n1], P, T),
      treeFactory(designated(C1), "Plates", [n2], C1, P),
      treeFactory(AUTO_KEY, "Screws", [n4], null, null),
      treeFactory(designated(C2), "Rods", [n3], C2, P),
    ],
  };
  const designations = [
    treeDesignation(T, "Main base", null, 0),
    treeDesignation(P, "Smelters", T),
    treeDesignation(C1, "Plates", P),
    treeDesignation(C2, "Rods", P),
  ];
  return { graph, designations };
}

/** The production-graph response for the world. */
export const treeGraphResponse = (graph: ProductionGraph) => ({ ...productionGraphFactories, data: graph });
