import { describe, expect, it } from "vitest";
import * as demoWorld from "../../demo/world";
import { EMPTY_VIEW, factoryScene } from "./canvasScene";
import { factoryContextOf } from "./focusSet";
import { reachFromCard } from "./graphModel";
import { factoryModels } from "./hierarchy";
import { layoutScene } from "./layoutSite";

// ADR-0063 build PR 5: the inputs of the focus states 2 and 5.

describe("reachFromCard", () => {
  const edges = [
    { from: "ore", to: "smelt" },
    { from: "smelt", to: "rods" },
    { from: "rods", to: "screws" },
    { from: "screws", to: "rods" }, // a return
    { from: "plates", to: "frames" },
    { from: "smelt", to: "plates" },
  ];

  it("lights the card, what it feeds and what it needs, over all items", () => {
    const r = reachFromCard("rods", edges, new Set([3]));
    expect([...r.nodes].sort()).toEqual(["ore", "rods", "screws", "smelt"]);
    // Upstream lines and downstream lines; not the sibling branch smelt -> plates.
    expect([...r.edges].sort()).toEqual([0, 1, 2]);
  });

  it("does not walk across a return flow, so a loop does not light the whole factory", () => {
    const r = reachFromCard("screws", edges, new Set([3]));
    expect(r.nodes.has("frames")).toBe(false);
    expect(r.edges.has(3)).toBe(false);
  });
});

describe("factoryContextOf (state 5)", () => {
  it("finds the demo factory's groups outside its home site and the groups that make its product", () => {
    const g = demoWorld.productionGraph(demoWorld.DEMO_EPOCH).data;
    const model = factoryModels(g).find((m) => m.factory.name === "Reinforced Iron Plate factory")!;
    const layout = layoutScene(factoryScene(g, model, EMPTY_VIEW), g.topologyHash);
    const ctx = factoryContextOf(g, model, layout.nodes);
    const titles = (keys: Set<string>) => layout.nodes.filter((n) => keys.has(n.key)).map((n) => n.title);
    // The ore farm's miners and platform stand 300 m away (the train): outside the iron works.
    expect(ctx.outside.size).toBeGreaterThan(0);
    for (const t of titles(ctx.outside)) expect(t).toMatch(/Miner|Freight Platform/);
    // Its product is Reinforced Iron Plate: the assembler groups that make it.
    expect(titles(ctx.products).length).toBeGreaterThan(0);
    for (const t of titles(ctx.products)) expect(t).toMatch(/Assembler/);
  });
});
