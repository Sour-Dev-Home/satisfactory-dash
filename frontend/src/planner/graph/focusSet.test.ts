import { describe, expect, it } from "vitest";
import { edgeKeyOf } from "./bubbleRow";
import { focusSet } from "./focusSet";
import type { LaidEdge } from "./layoutSite";

const flow = (from: string, to: string) => ({ from, to, carrier: "belt", flow: "solid", unit: "items" }) as unknown as LaidEdge["flow"];
const line = (from: string, to: string, parts: number[]) => ({ flow: flow(from, to), parts });

// ADR-0063 Decision 3: one pure rule for what is lit and what dims.
describe("focusSet", () => {
  const ab = line("a", "b", [0]);
  const bc = line("b", "c", [1, 2]);

  it("lights everything with no focus and no filter", () => {
    const lights = focusSet(null, null);
    expect(lights.dims).toBe(false);
    expect(lights.card("anything")).toBe(true);
    expect(lights.edge(bc)).toBe(true);
  });

  it("lights the focused line and its two cards only (hop-1), found by key", () => {
    const lights = focusSet({ edgeKey: edgeKeyOf(ab.flow), from: "a", to: "b" }, null);
    expect(lights.dims).toBe(true);
    expect(["a", "b", "c"].map(lights.card)).toEqual([true, true, false]);
    expect(lights.edge(ab)).toBe(true);
    // The other line shares card b, but focus is the line, not its cards' lines.
    expect(lights.edge(bc)).toBe(false);
  });

  it("puts item focus before the item filter", () => {
    const reach = { nodes: new Set(["b", "c"]), edges: new Set([1]) };
    const lights = focusSet({ edgeKey: edgeKeyOf(ab.flow), from: "a", to: "b" }, reach);
    expect(lights.card("c")).toBe(false);
    expect(lights.edge(bc)).toBe(false);
  });

  // ADR-0063 build PR 5: states 2, 4 and 5, and their order.
  it("state 2: lights what a card feeds and needs, and wins over the item filter", () => {
    const cardReach = { nodes: new Set(["a", "b"]), edges: new Set([0]) };
    const lights = focusSet(null, { nodes: new Set(["c"]), edges: new Set([1]) }, { cardReach });
    expect(lights.state).toBe(2);
    expect(["a", "b", "c"].map(lights.card)).toEqual([true, true, false]);
    expect(lights.edge(ab)).toBe(true);
    expect(lights.edge(bc)).toBe(false);
  });

  it("state 4: lights the selected card, its neighbours and only the lines to them; the filter wins over it", () => {
    const selected = { key: "b", neighbours: new Set(["a", "c"]) };
    const lights = focusSet(null, null, { selected });
    expect(lights.state).toBe(4);
    expect(["a", "b", "c", "d"].map(lights.card)).toEqual([true, true, true, false]);
    expect(lights.edge(ab)).toBe(true);
    expect(lights.edge(bc)).toBe(true);
    // A line between two neighbours is not the selected card's.
    expect(lights.edge(line("a", "c", [5]))).toBe(false);
    expect(focusSet(null, { nodes: new Set(["a"]), edges: new Set() }, { selected }).state).toBe(3);
  });

  it("state 5: dims the cards outside the home site and their lines, and emphasises the product cards", () => {
    const lights = focusSet(null, null, { context: { outside: new Set(["a"]), products: new Set(["c"]) } });
    expect(lights.state).toBe(5);
    expect(lights.dims).toBe(true);
    expect(lights.card("a")).toBe(false);
    expect(lights.edge(ab)).toBe(false);
    expect(lights.edge(bc)).toBe(true);
    expect(lights.emphasised("c")).toBe(true);
    expect(lights.emphasised("b")).toBe(false);
    // A selected card wins over the context.
    expect(focusSet(null, null, { selected: { key: "b", neighbours: new Set() }, context: { outside: new Set(["a"]), products: new Set() } }).state).toBe(4);
  });

  it("state 5 with nothing outside dims nothing but still emphasises; with neither, everything is plain", () => {
    const only = focusSet(null, null, { context: { outside: new Set(), products: new Set(["c"]) } });
    expect(only.dims).toBe(false);
    expect(only.emphasised("c")).toBe(true);
    expect(focusSet(null, null, { context: { outside: new Set(), products: new Set() } }).state).toBe(6);
  });

  it("lights the filter's reach: its cards, and a line any of whose links is on the walk", () => {
    const lights = focusSet(null, { nodes: new Set(["b", "c"]), edges: new Set([2]) });
    expect(lights.dims).toBe(true);
    expect(["a", "b", "c"].map(lights.card)).toEqual([false, true, true]);
    expect(lights.edge(bc)).toBe(true);
    expect(lights.edge(ab)).toBe(false);
  });
});
