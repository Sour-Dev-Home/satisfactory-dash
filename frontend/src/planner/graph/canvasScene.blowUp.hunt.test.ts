import { describe, expect, it } from "vitest";
import { AUTO_KEY, P, T, designated, treeEdge, treeNode, treeWorld } from "../../test/plannerTree";
import { buildFactoryTree } from "../factoryTree";
import { expandAllKeys, overviewScene } from "./canvasScene";

const { graph, designations } = treeWorld();
const tree = buildFactoryTree(graph, designations);

describe("blow-up edge cases", () => {
  it("a group owned by no factory is never drawn, and its flows do not dangle", () => {
    const orphan = treeNode("orphan", "Desc_IronRod_C", 5, 5, 1);
    const g = { ...graph, nodes: [...graph.nodes, orphan], edges: [...graph.edges, treeEdge("orphan", "n4", "Desc_IronRod_C", 5, "measured")] };
    const scene = overviewScene(g, [], [], buildFactoryTree(g, designations), new Set([AUTO_KEY, designated(T)]));
    const keys = new Set(scene.cards.map((c) => c.key));
    expect(keys.has("orphan")).toBe(false);
    expect(scene.flows.every((f) => keys.has(f.from) && keys.has(f.to))).toBe(true);
  });

  it("expandAllKeys keeps what was open, does not change its input, and is idempotent", () => {
    const start = new Set(["stale-key"]);
    const once = expandAllKeys(graph, [], [], tree, start);
    expect([...start]).toEqual(["stale-key"]);
    expect(once.has("stale-key")).toBe(true);
    expect(once.has(designated(T))).toBe(true);
    expect(once.has(designated(P))).toBe(true);
    expect([...expandAllKeys(graph, [], [], tree, once)].sort()).toEqual([...once].sort());
  });

  it("every group is drawn exactly once whatever is open", () => {
    for (const open of [[], [designated(T)], [designated(T), designated(P)], [AUTO_KEY], [designated(T), designated(P), AUTO_KEY]]) {
      const scene = overviewScene(graph, [], [], tree, new Set(open));
      const all = scene.cards.flatMap((c) => c.nodeKeys);
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
