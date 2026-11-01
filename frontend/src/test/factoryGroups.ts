import { ProductionGraphSchema, type FactoryBuilding, type FactoryResponse, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { factoryMixed, productionGraphFactories } from "@satisfactory-dash/shared/fixtures";

/**
 * ADR-0062 F.2: a factory read and a production graph that name the same machines, built on the shared fixtures, for the
 * Factory page's grouped table. Each group gets one id per machine (`<class>|<node key>|<i>`) and a building for each,
 * with the group's name, class and recipe; the first machine of a group whose product reads below its max is backed up.
 */

const template: FactoryBuilding = factoryMixed.data.buildings[0]!;

function buildingsOf(node: PlannerNode): FactoryBuilding[] {
  const short = node.products.some((p) => p.currentPerMinute < p.maxPerMinute);
  return node.machineIds.map((id, i) => {
    const backedUp = short && i === 0;
    return {
      ...template,
      id,
      name: node.name,
      className: node.className,
      recipe: node.recipe,
      isProducing: !backedUp,
      isBackedUp: backedUp,
      state: backedUp ? "backedUp" : "producing",
      location: { xM: node.at.x + i * 4, yM: node.at.y, zM: 0, rotationDeg: 0 },
      production: node.products.map((p) => {
        const current = p.currentPerMinute / node.count;
        const max = p.maxPerMinute / node.count;
        return { name: p.name, className: p.className, unit: p.unit, currentPerMinute: current, maxPerMinute: max, percent: max > 0 ? (current / max) * 100 : 0 };
      }),
    };
  });
}

/** The graph with one id per machine, and the factory read of those machines plus `extra` (machines no group names). */
export function factoryForGraph(graph: ProductionGraph, extra: readonly FactoryBuilding[] = []): { graph: ProductionGraph; factory: FactoryResponse } {
  const nodes = graph.nodes.map((n) => ({ ...n, machineIds: Array.from({ length: n.count }, (_, i) => `${n.className}|${n.key}|${i}`) }));
  const buildings = [...nodes.flatMap(buildingsOf), ...extra];
  return {
    graph: { ...graph, nodes },
    factory: { ...factoryMixed, data: { ...factoryMixed.data, buildings, backedUpCount: buildings.filter((b) => b.isBackedUp).length } },
  };
}

/** The production-graph response for a graph. */
export const graphResponse = (graph: ProductionGraph) => ({ ...productionGraphFactories, data: graph });

/** The factories fixture: Iron Plate factory (5 groups, one shared with Iron Rod) and Iron Rod factory (2 groups). */
export const factoriesGraph = (): ProductionGraph => ProductionGraphSchema.parse(productionGraphFactories.data);

/** The factories world with the refinery of the mixed factory read, which no group names ("Other machines"). */
export function groupedFactoriesWorld(): { graph: ProductionGraph; factory: FactoryResponse } {
  const refinery = factoryMixed.data.buildings.find((b) => b.className === "Build_OilRefinery_C")!;
  return factoryForGraph(factoriesGraph(), [refinery]);
}

/** The factories world with `count` Iron Plate constructors, past the per-group cap. */
export function manyPlateConstructorsWorld(count: number): { graph: ProductionGraph; factory: FactoryResponse } {
  const graph = factoriesGraph();
  return factoryForGraph({ ...graph, nodes: graph.nodes.map((n) => (n.recipe === "Iron Plate" ? { ...n, count } : n)) });
}
