import { describe, expect, it } from "vitest";
import type { ConveyorEdge } from "@satisfactory-dash/shared";
import { conveyorInView, conveyorLengthText, conveyorsSummary, endText, placeConveyors, type BuildingPlace } from "./conveyors";

const edge = (over: Partial<ConveyorEdge> & Pick<ConveyorEdge, "id">): ConveyorEdge => ({
  kind: "belt",
  from: null,
  fromKind: null,
  to: null,
  toKind: null,
  capacityPerMinute: 60,
  tier: "Conveyor Belt Mk.1",
  at: { x: 0, y: 0 },
  ...over,
});
const places = (entries: [string, BuildingPlace][]) => new Map(entries);
const NONE = places([]);

describe("placeConveyors", () => {
  it("ends a belt at the start of the conveyor joined to it (that conveyor's end 0 names this one)", () => {
    const a = edge({ id: "A", to: "B", toKind: "conveyor", at: { x: 0, y: 0 } });
    const b = edge({ id: "B", from: "A", fromKind: "conveyor", at: { x: 30, y: 40 } });
    const [placedA] = placeConveyors([a, b], NONE);
    expect(placedA.from).toEqual([0, 0]);
    expect(placedA.to).toEqual([30, 40]);
    expect(placedA.lengthM).toBe(50);
  });

  it("ends a belt at a building the factory placed", () => {
    const a = edge({ id: "A", to: "M", toKind: "machine", at: { x: 0, y: 0 } });
    const [placedA] = placeConveyors([a], places([["M", { x: 6, y: 8, name: "Constructor" }]]));
    expect(placedA.to).toEqual([6, 8]);
    expect(placedA.lengthM).toBe(10);
  });

  it("ends a belt at a splitter by the nearest conveyor leaving that splitter", () => {
    const into = edge({ id: "A", to: "S", toKind: "splitter", at: { x: 0, y: 0 } });
    const far = edge({ id: "B", from: "S", fromKind: "splitter", at: { x: 100, y: 0 } });
    const near = edge({ id: "C", from: "S", fromKind: "splitter", at: { x: 20, y: 0 } });
    const [placedA] = placeConveyors([into, far, near], NONE);
    expect(placedA.to).toEqual([20, 0]);
  });

  it("never ends a conveyor at a conveyor whose end 0 is joined elsewhere (a pipe joined end to end)", () => {
    const a = edge({ id: "A", kind: "pipe", to: "B", toKind: "conveyor", capacityPerMinute: null, at: { x: 0, y: 0 } });
    // B's end 1 meets A's end 1; B's `at` is B's far end, so drawing A to it would be wrong.
    const b = edge({ id: "B", kind: "pipe", from: "X", fromKind: "junction", to: "A", toKind: "conveyor", capacityPerMinute: null, at: { x: 90, y: 0 } });
    const [placedA] = placeConveyors([a, b], NONE);
    expect(placedA.to).toBeNull();
    expect(placedA.lengthM).toBeNull();
  });

  it("leaves an open end, or an end nothing places, unplaced", () => {
    const open = edge({ id: "A" });
    const lost = edge({ id: "B", to: "M", toKind: "machine" });
    expect(placeConveyors([open, lost], NONE).map((p) => p.to)).toEqual([null, null]);
  });

  it("draws a lift where it stands (it runs straight up or down), with no length", () => {
    const lift = edge({ id: "L", kind: "lift", to: "M", toKind: "machine", at: { x: 5, y: 5 } });
    const [placed] = placeConveyors([lift], places([["M", { x: 50, y: 50, name: "Assembler" }]]));
    expect(placed.from).toEqual([5, 5]);
    expect(placed.to).toBeNull();
    expect(placed.lengthM).toBeNull();
  });

  it("keys every item by id and index, so a repeated id never collides", () => {
    const a = edge({ id: "A" });
    expect(placeConveyors([a, a], NONE).map((p) => p.key)).toEqual(["A:0", "A:1"]);
  });

  it("ignores a building id that only looks like an own property of a plain object", () => {
    const a = edge({ id: "A", to: "constructor", toKind: "other" });
    expect(placeConveyors([a], NONE)[0].to).toBeNull();
  });
});

describe("conveyorsSummary", () => {
  it("says none were reported for an empty layer", () => {
    expect(conveyorsSummary([])).toBe("No belts, lifts or pipes reported yet.");
  });

  it("counts each kind and sums the belt and the pipe, drawn straight", () => {
    const list = placeConveyors(
      [
        edge({ id: "A", to: "B", toKind: "conveyor", at: { x: 0, y: 0 } }),
        edge({ id: "B", from: "A", fromKind: "conveyor", to: "M", toKind: "machine", at: { x: 3, y: 4 } }),
        edge({ id: "P", kind: "pipe", to: "M", toKind: "machine", capacityPerMinute: null, at: { x: 0, y: 1_000 } }),
        edge({ id: "L", kind: "lift", at: { x: 1, y: 1 } }),
      ],
      places([["M", { x: 0, y: 4, name: "Refinery" }]]),
    );
    expect(conveyorsSummary(list)).toBe(
      "2 belts, 1 pipe, 1 lift on the map, 8 m of belt and 996 m of pipe in all, drawn straight between their ends.",
    );
  });

  it("says 'shown' when the layer was cut, and counts the ones drawn as a dot", () => {
    const list = placeConveyors([edge({ id: "A" }), edge({ id: "B", kind: "pipe", capacityPerMinute: null })], NONE);
    expect(conveyorsSummary(list, { truncated: true })).toBe(
      "1 belt, 1 pipe, 0 lifts on the map, 0 m of belt and 0 m of pipe shown, drawn straight between their ends. 2 with an end the map can't place are drawn as a dot.",
    );
    expect(conveyorsSummary(list.slice(0, 1))).toMatch(/1 with an end the map can't place is drawn as a dot\.$/);
  });
});

describe("endText", () => {
  const buildings = places([["M", { x: 0, y: 0, name: "Smelter" }]]);
  const kinds = new Map([["P", "pipe" as const]]);
  it("names an open end, a placed building, a conveyor in the layer, and otherwise the end's kind", () => {
    expect(endText(null, null, buildings, kinds)).toBe("Open end");
    expect(endText("M", "machine", buildings, kinds)).toBe("Smelter");
    expect(endText("P", "conveyor", buildings, kinds)).toBe("Pipe");
    expect(endText("Q", "conveyor", buildings, kinds)).toBe("Conveyor");
    expect(endText("S", "splitter", buildings, kinds)).toBe("Splitter");
    expect(endText("G", "consumer", buildings, kinds)).toBe("Generator or sink");
    expect(endText("J", "junction", buildings, kinds)).toBe("Pipe junction or pump");
    expect(endText("O", "other", buildings, kinds)).toBe("Other building");
  });
});

describe("conveyorLengthText and conveyorInView", () => {
  const [placed, open, lift] = placeConveyors(
    [
      edge({ id: "A", to: "M", toKind: "machine", at: { x: 0, y: 0 } }),
      edge({ id: "B", at: { x: 500, y: 500 } }),
      edge({ id: "L", kind: "lift", at: { x: 7, y: 7 } }),
    ],
    places([["M", { x: 0, y: 1_200, name: "Assembler" }]]),
  );

  it("gives a length, 'Vertical' for a lift, and 'Unknown' when an end isn't placed", () => {
    expect(conveyorLengthText(placed)).toBe("1,200 m");
    expect(conveyorLengthText(lift)).toBe("Vertical");
    expect(conveyorLengthText(open)).toBe("Unknown");
  });

  it("is in view when its segment crosses the view, or its start is in it", () => {
    const view = { minX: -10, maxX: 10, minY: 590, maxY: 610 };
    expect(conveyorInView(view, placed)).toBe(true);
    expect(conveyorInView(view, open)).toBe(false);
    expect(conveyorInView({ minX: 499, maxX: 501, minY: 499, maxY: 501 }, open)).toBe(true);
    expect(conveyorInView(null, lift)).toBe(true);
  });
});

describe("placeConveyors (hunt)", () => {
  it("finds the joined conveyor among several sharing an id (FRM ids can repeat)", () => {
    const a = edge({ id: "A", to: "B", toKind: "conveyor", at: { x: 0, y: 0 } });
    const otherB = edge({ id: "B", from: "Z", fromKind: "conveyor", at: { x: 500, y: 500 } });
    const b = edge({ id: "B", from: "A", fromKind: "conveyor", at: { x: 30, y: 40 } });
    expect(placeConveyors([a, otherB, b], NONE)[0].to).toEqual([30, 40]);
  });

  it("treats ids like __proto__ as plain keys", () => {
    const a = edge({ id: "A", to: "__proto__", toKind: "splitter", at: { x: 0, y: 0 } });
    const b = edge({ id: "B", from: "__proto__", fromKind: "splitter", at: { x: 3, y: 4 } });
    expect(placeConveyors([a, b], NONE)[0].to).toEqual([3, 4]);
    expect(placeConveyors([edge({ id: "C", to: "__proto__", toKind: "machine" })], NONE)[0].to).toBeNull();
  });

  it("a self-join places at its own start and a lift never counts metres", () => {
    const loop = edge({ id: "L", from: "L", fromKind: "conveyor", to: "L", toKind: "conveyor", at: { x: 5, y: 5 } });
    expect(placeConveyors([loop], NONE)[0].lengthM).toBe(0);
    const lift = edge({ id: "T", kind: "lift", to: "M", toKind: "machine" });
    const [p] = placeConveyors([lift], places([["M", { x: 90, y: 0, name: "m" }]]));
    expect(p.lengthM).toBeNull();
    expect(conveyorsSummary([p])).toContain("0 m of belt");
  });
});
