import { beforeEach, expect, it, vi } from "vitest";
import { ProductionGraphResponseSchema, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { EMPTY_VIEW, factoryScene } from "./canvasScene";
import { factoryModels } from "./hierarchy";
import { clearLayoutMemo, layoutScene, layoutStats } from "./layoutSite";

vi.mock("./orthogonalRoute", () => ({
  routeOrthogonal: () => {
    throw new Error("router failure (test)");
  },
}));

beforeEach(clearLayoutMemo);

it("draws dagre's own routes when the orthogonal router throws, and counts the failure", () => {
  const graph: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
  const layout = layoutScene(factoryScene(graph, factoryModels(graph)[0], EMPTY_VIEW), graph.topologyHash);
  expect(layout.edges.length).toBeGreaterThan(0);
  for (const e of layout.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
  expect(layoutStats().routerFailures).toBe(1);
});
