import { beforeEach, describe, expect, it, vi } from "vitest";
import { P, T, designated, treeWorld } from "../../test/plannerTree";
import { buildFactoryTree } from "../factoryTree";
import { overviewScene } from "./canvasScene";
import { FRAME_HEADER_H, NESTED_FRAME_RISE, clearLayoutMemo, layoutScene, roomForNestedTabs } from "./layoutSite";

// dagre always throws, so the grid fallback draws the blow-ups.
vi.mock("@dagrejs/dagre", async (orig) => {
  const mod = await orig<{ default: { layout: (g: unknown, o?: unknown) => void } }>();
  mod.default.layout = () => {
    throw new Error("forced");
  };
  return mod;
});

beforeEach(() => clearLayoutMemo());

const { graph, designations } = treeWorld();
const tree = buildFactoryTree(graph, designations);
type Box = { x: number; y: number; width: number; height: number };
const inside = (i: Box, o: Box) => i.x >= o.x && i.y >= o.y && i.x + i.width <= o.x + o.width && i.y + i.height <= o.y + o.height;

describe("the grid fallback with nested blow-ups", () => {
  it("nests the inner frame in the outer with room for both tabs, cards inside their frames, nothing above the canvas", () => {
    const scene = overviewScene(graph, [], [], tree, new Set([designated(T), designated(P)]));
    const layout = layoutScene(scene, graph.topologyHash);
    const outer = layout.frames.find((f) => f.key === `frame|${designated(T)}`)!;
    const inner = layout.frames.find((f) => f.key === `frame|${designated(P)}`)!;
    expect(inner.parent).toBe(outer.key);
    expect(inner.y - FRAME_HEADER_H / 2).toBeGreaterThanOrEqual(outer.y + FRAME_HEADER_H / 2);
    expect(inside(inner, outer)).toBe(true);
    const nodes = new Map(layout.nodes.map((n) => [n.key, n]));
    for (const f of scene.frames) for (const k of f.cardKeys) expect(inside(nodes.get(k)!, f.key === inner.key ? inner : outer)).toBe(true);
    for (const f of layout.frames) expect(f.y - FRAME_HEADER_H / 2).toBeGreaterThanOrEqual(0);
  });
});

describe("roomForNestedTabs", () => {
  const frames = (list: [string, string | undefined, Box][]) => ({
    list: list.map(([key, parent]) => ({ key, parent })),
    boxes: new Map(list.map(([k, , b]) => [k, b])),
  });
  it("leaves a roomy parent alone", () => {
    const { list, boxes } = frames([
      ["a", undefined, { x: 0, y: 0, width: 100, height: 100 }],
      ["b", "a", { x: 10, y: NESTED_FRAME_RISE, width: 50, height: 50 }],
    ]);
    roomForNestedTabs(list, boxes);
    expect(boxes.get("a")).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
  it("grows a tight parent upward, keeping its bottom edge", () => {
    const { list, boxes } = frames([
      ["a", undefined, { x: 0, y: 0, width: 100, height: 100 }],
      ["b", "a", { x: 10, y: 5, width: 50, height: 50 }],
    ]);
    roomForNestedTabs(list, boxes);
    const a = boxes.get("a")!;
    expect(a.y).toBe(5 - NESTED_FRAME_RISE);
    expect(a.y + a.height).toBe(100);
  });
  it("ignores a parent that has no box and a frame without one", () => {
    const { list, boxes } = frames([["b", "ghost", { x: 0, y: 0, width: 5, height: 5 }]]);
    roomForNestedTabs(list, boxes);
    expect([...boxes.keys()]).toEqual(["b"]);
  });
});
