import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { EMPTY_VIEW, factoryScene, overviewScene } from "./canvasScene";
import { factoryModels } from "./hierarchy";

// Hunt for ADR-0062 PR 2: the overview and factory scenes carry `stalled` the same way the site scene does.
const FIXTURE: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const models = factoryModels(FIXTURE);

describe("stalled in the overview scene", () => {
  it("marks a factory whose product reads 0 and whose machines are all idle, and the flows leaving it", () => {
    const [first, ...rest] = models;
    const stalledFirst = {
      ...first,
      stateCounts: { idle: 9 },
      factory: { ...first.factory, products: [{ ...first.factory.products[0], currentPerMinute: 0 }, ...first.factory.products.slice(1)] },
    };
    const scene = overviewScene(FIXTURE, [stalledFirst, ...rest]);
    expect(scene.cards[0].stalled).toBe("idle");
    expect(scene.cards[0].lines[scene.cards[0].mutedFrom!]).toBe("Idle");
    expect(scene.cards[1].stalled).toBeUndefined();
    expect(scene.flows.length).toBeGreaterThan(0);
    for (const f of scene.flows) expect(f.stalled).toBe(f.from === scene.cards[0].key ? "idle" : undefined);
  });

  it("leaves a running factory unmarked", () => {
    const scene = overviewScene(FIXTURE, models);
    expect(scene.cards.every((c) => c.stalled === undefined)).toBe(true);
    expect(scene.flows.every((f) => f.stalled === undefined)).toBe(true);
  });
});

describe("stalled in the factory scene", () => {
  it("marks a stalled group card and the lines leaving it, not the lines into it", () => {
    const base = factoryScene(FIXTURE, models[0], EMPTY_VIEW);
    const target = base.cards.find((c) => c.kind === "group" && base.flows.some((f) => f.from === c.key));
    expect(target).toBeDefined();
    const key = target!.nodeKeys[0];
    const graph: ProductionGraph = {
      ...FIXTURE,
      nodes: FIXTURE.nodes.map((n) => (n.key === key ? { ...n, stateCounts: { paused: n.count }, products: n.products.map((p) => ({ ...p, currentPerMinute: 0 })) } : n)),
    };
    const scene = factoryScene(graph, factoryModels(graph)[0], EMPTY_VIEW);
    const card = scene.cards.find((c) => c.key === target!.key)!;
    expect(card.stalled).toBe("paused");
    for (const f of scene.flows) {
      const moving = f.quality === "measured" && f.ratePerMinute !== null && f.ratePerMinute > 0;
      expect(f.stalled === "paused").toBe(f.from === card.key && !moving);
    }
  });
});
