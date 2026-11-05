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

  it("lights the filter's reach: its cards, and a line any of whose links is on the walk", () => {
    const lights = focusSet(null, { nodes: new Set(["b", "c"]), edges: new Set([2]) });
    expect(lights.dims).toBe(true);
    expect(["a", "b", "c"].map(lights.card)).toEqual([false, true, true]);
    expect(lights.edge(bc)).toBe(true);
    expect(lights.edge(ab)).toBe(false);
  });
});
