import { describe, expect, it } from "vitest";
import type { ProductionGraph } from "@satisfactory-dash/shared";
import { factoriesConnected, partsOf } from "./connectivity";

const node = (key: string, factoryKey?: string, shares?: { factoryKey: string; share: number }[]) => ({ key, factoryKey, shares });
const g = (nodes: ReturnType<typeof node>[], edges: [string, string][], transports: [string, string][] = [], factories?: { key: string; nodeKeys: string[] }[]) =>
  ({
    nodes,
    edges: edges.map(([from, to]) => ({ from, to })),
    transports: transports.map(([from, to]) => ({ from, to })),
    factories,
  }) as unknown as ProductionGraph;

describe("hunt: connectivity", () => {
  const nodes = [node("a", "A"), node("b", "B"), node("c", "C"), node("d", "D")];
  it("a path through an unselected factory does not connect", () => {
    const graph = g(nodes, [["a", "b"], ["b", "c"]]);
    expect(factoriesConnected(graph, ["A", "C"])).toBe(false);
    expect(factoriesConnected(graph, ["A", "B", "C"])).toBe(true);
  });
  it("direction is ignored and transports count", () => {
    const graph = g(nodes, [["b", "a"]], [["d", "c"], ["b", "c"]]);
    expect(factoriesConnected(graph, ["A", "B", "C", "D"])).toBe(true);
  });
  it("an unknown key, or a duplicate, behaves", () => {
    const graph = g(nodes, [["a", "b"]]);
    expect(factoriesConnected(graph, ["A", "Z"])).toBe(false);
    expect(factoriesConnected(graph, ["Z", "A"])).toBe(false);
    expect(factoriesConnected(graph, ["A", "A"])).toBe(true);
    expect(factoriesConnected(graph, [])).toBe(true);
  });
  it("a shared node joins every factory it names, and a missing edge end is ignored", () => {
    const graph = g([node("s", "A", [{ factoryKey: "A", share: 1 }, { factoryKey: "B", share: 1 }]), node("c", "C")], [["s", "ghost"]]);
    expect(factoriesConnected(graph, ["A", "B"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "C"])).toBe(false);
  });
  it("partsOf counts components, ignoring edges leaving the set and self loops", () => {
    const graph = g(nodes, [["a", "b"], ["b", "b"], ["c", "x"]], [["a", "b"]]);
    expect(partsOf(graph, new Set(["a", "b", "c", "d"]))).toBe(3);
    expect(partsOf(graph, new Set())).toBe(0);
  });
});
