import { describe, expect, it } from "vitest";
import { productionGraphStaleEnd } from "@satisfactory-dash/shared/fixtures";
import type { PlannerNode } from "@satisfactory-dash/shared";
import { sceneFor, EMPTY_VIEW } from "./graph/canvasScene";
import { STALE_NODE_NOTE } from "./graph/graphModel";

const mk = (key: string, over: Partial<PlannerNode>): PlannerNode & { factoryKey: string } => ({
  key,
  kind: "other",
  className: "machine",
  name: "machine",
  recipe: null,
  count: 1,
  machineIds: [],
  stateCounts: {},
  products: [],
  ingredients: [],
  at: { x: 1, y: 1 },
  siteKey: "s",
  loop: false,
  treeKey: "t",
  factoryKey: "f",
  ...over,
});

describe("stale nodes mixed with ordinary ones", () => {
  const graph = productionGraphStaleEnd.data;
  const build = (nodes: ReturnType<typeof mk>[]) => ({
    ...graph,
    nodes,
    edges: [],
    transports: [],
    factories: [{ ...graph.factories![0]!, key: "f", nodeKeys: nodes.map((n) => n.key), products: [] }],
  });

  it("a bubble holding a stale and an unknown (non-stale) node is not drawn as stale", () => {
    const g = build([mk("a", { stale: true }), mk("b", { className: "Build_X", name: "X" })]);
    const opened = sceneFor(g, { factory: "f" }, { ...EMPTY_VIEW, flipped: new Set(["t"]) });
    const bubble = opened.cards.find((c) => c.kind === "bubble");
    expect(bubble).toBeDefined();
    expect(bubble?.glyph).not.toBe("stale");
    expect(bubble?.description).not.toContain(STALE_NODE_NOTE);
  });
});
