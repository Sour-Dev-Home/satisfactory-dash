import { describe, expect, it } from "vitest";
import type { PlannerNode, PlannerRate, ProductionGraph } from "@satisfactory-dash/shared";
import { attentionItems, outlineSummaryText, sortConnections, stalledOutputs, type OutlineConnection } from "./outlineModel";

const rate = (name: string, current: number, max: number): PlannerRate => ({ className: `Desc_${name}_C`, name, unit: "items/min", currentPerMinute: current, maxPerMinute: max });
const node = (key: string, over: Partial<PlannerNode> = {}): PlannerNode => ({
  key,
  kind: "machines",
  className: "Build_SmelterMk1_C",
  name: `Smelter ${key}`,
  recipe: "Iron Ingot",
  count: 1,
  machineIds: [`m-${key}`],
  stateCounts: { producing: 1 },
  products: [rate("Iron Ingot", 30, 30)],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});
const graphOf = (extra: Partial<ProductionGraph> = {}) => ({ nodes: [], edges: [], transports: [], sites: [], ...extra }) as unknown as ProductionGraph;

const conn = (key: string, over: Partial<OutlineConnection> = {}): OutlineConnection => ({
  key,
  fromKey: key,
  toKey: "z",
  from: key,
  to: "Z",
  item: "Iron Ore",
  itemNote: null,
  rate: "",
  rateSort: 10,
  carrier: "Belt",
  capacity: null,
  flow: "",
  ...over,
});

describe("sortConnections (hunt)", () => {
  it("keeps the given order among equal rates, ascending and descending", () => {
    const rows = [conn("a"), conn("b"), conn("c")];
    expect(sortConnections(rows, { column: "rate", descending: false }).map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(sortConnections(rows, { column: "rate", descending: true }).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("keeps several unknown rates last, in their given order, either way", () => {
    const rows = [conn("u1", { rateSort: null }), conn("k", { rateSort: 5 }), conn("u2", { rateSort: null })];
    expect(sortConnections(rows, { column: "rate", descending: false }).map((r) => r.key)).toEqual(["k", "u1", "u2"]);
    expect(sortConnections(rows, { column: "rate", descending: true }).map((r) => r.key)).toEqual(["k", "u1", "u2"]);
  });

  it("sorts a zero rate before a small one (0 is a number, not unknown)", () => {
    const rows = [conn("small", { rateSort: 1 }), conn("zero", { rateSort: 0 }), conn("unk", { rateSort: null })];
    expect(sortConnections(rows, { column: "rate", descending: false }).map((r) => r.key)).toEqual(["zero", "small", "unk"]);
  });

  it("sorts text numerically and case-blind, and does not mutate its input", () => {
    const rows = [conn("x", { from: "Smelter 10" }), conn("y", { from: "smelter 2" }), conn("z", { from: "Smelter 1" })];
    const before = rows.map((r) => r.key);
    expect(sortConnections(rows, { column: "from", descending: false }).map((r) => r.from)).toEqual(["Smelter 1", "smelter 2", "Smelter 10"]);
    expect(sortConnections(rows, { column: "from", descending: true }).map((r) => r.from)).toEqual(["Smelter 10", "smelter 2", "Smelter 1"]);
    expect(rows.map((r) => r.key)).toEqual(before);
  });

  it("returns a copy when no header is chosen", () => {
    const rows = [conn("b"), conn("a")];
    const out = sortConnections(rows, null);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe("attentionItems (hunt)", () => {
  it("ignores stale groups and products that never could make anything", () => {
    const stale = node("stale", { products: [rate("Iron Ingot", 0, 60)], stateCounts: {}, stale: true } as Partial<PlannerNode>);
    const nomax = node("nomax", { products: [rate("Iron Ingot", 0, 0)] });
    const items = attentionItems([stale, nomax, node("ok")], graphOf(), undefined);
    expect(items.filter((i) => i.kind === "stalled").map((i) => i.nodeKey)).not.toContain("nomax");
    expect(stalledOutputs(nomax)).toEqual([]);
  });

  it("keeps ties in the order the groups were given (stable)", () => {
    const a = node("a", { products: [rate("Iron Ingot", 0, 60)] });
    const b = node("b", { products: [rate("Iron Ingot", 0, 60)] });
    expect(attentionItems([a, b], graphOf(), []).map((i) => i.nodeKey)).toEqual(["a", "b"]);
    expect(attentionItems([b, a], graphOf(), []).map((i) => i.nodeKey)).toEqual(["b", "a"]);
  });

  it("gives every item a unique key, even for two findings about one building", () => {
    const f = { buildingId: "m-a", buildingName: "S", state: "underfed", rootCause: { kind: "deficit", text: "x" }, chain: [], text: "t" };
    const items = attentionItems([node("a")], graphOf(), [f, f] as never);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });

  it("finds a finding's group through an affected machine, and drops a finding about nothing listed", () => {
    const f = { buildingId: "elsewhere", buildingName: "S", state: "underfed", rootCause: { kind: "deficit", text: "x" }, chain: [], text: "t", affected: [{ buildingId: "m-a" }] };
    const gone = { ...f, buildingId: "gone", affected: [] };
    const items = attentionItems([node("a")], graphOf(), [f, gone] as never);
    expect(items.map((i) => i.nodeKey)).toEqual(["a"]);
  });

  it("counts unknown ends from edges and transports together and only for groups in scope", () => {
    const e = (from: string) => ({ from, to: "q", destination: "unknown" });
    const g = graphOf({ edges: [e("a"), e("outside")] as never, transports: [e("a")] as never });
    const items = attentionItems([node("a")], g, []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "unknownEnd", nodeKey: "a" });
    expect(items[0]!.text).toMatch(/^2 flows/);
  });
});

describe("outlineSummaryText (hunt)", () => {
  it("says singular words for one group, one machine and one loop", () => {
    expect(outlineSummaryText([node("a", { loop: true })])).toBe("1 machine in 1 group: 0 stalled, 1 in a loop.");
  });
  it("is well formed for no groups", () => {
    expect(outlineSummaryText([])).toBe("0 machines in 0 groups: 0 stalled, 0 in loops.");
  });
});
