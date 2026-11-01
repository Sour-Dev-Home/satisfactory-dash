import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { overviewScene } from "./canvasScene";
import { factoryModels } from "./hierarchy";

const graph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;

describe("factory destinations to caps, hunt", () => {
  it("keeps a '__proto__' destination as its own cap, summing a pipe flow as m3/min and an item flow as items/min", () => {
    const edge = graph.edges[3];
    const edges = [
      { ...edge, destination: "__proto__", ratePerMinute: 10, rate: "measured" as const },
      { ...edge, destination: "__proto__", ratePerMinute: 20, rate: "measured" as const },
    ];
    const g = { ...graph, edges };
    const models = factoryModels(g);
    const dest = models.flatMap((m) => m.destinations).filter((d) => d.destination === "__proto__");
    expect(dest.length).toBeGreaterThan(0);
    const units = dest[0].rates!.map((r) => r.unit);
    expect(new Set(units).size).toBe(units.length);
    const caps = overviewScene(g, models).cards.flatMap((c) => c.caps ?? []);
    expect(caps.some((c) => c.destination === "__proto__")).toBe(true);
    expect(Array.isArray(caps[0].rates)).toBe(true);
  });
});
