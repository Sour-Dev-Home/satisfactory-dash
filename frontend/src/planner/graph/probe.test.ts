import { it } from "vitest";
import { ProductionGraphSchema } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import { layoutSite } from "./layoutSite";
import { fitView } from "./viewport";
it("probe", () => {
  const g = ProductionGraphSchema.parse(productionGraphTwoSites.data);
  for (const s of g.sites) {
    const l = layoutSite(s, g);
    console.log("PROBE", s.name, l.width, l.height, fitView(l.width, l.height, { width: 990, height: 500 }).k, fitView(l.width, l.height, { width: 1440, height: 600 }).k, l.nodes.map((n) => n.width).join(","));
  }
});
