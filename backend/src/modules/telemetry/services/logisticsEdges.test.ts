import { describe, it, expect } from "vitest";
import { PlannerTransportSchema, type PlannerEdge, type TrainRouteRecord } from "@satisfactory-dash/shared";
import { DEPOT_NODE_KEY, buildLogisticsEdges, type LogisticsInput } from "./logisticsEdges.js";

// SYNTHETIC fixtures in the shape of the 2026-10-21 captures (raw-sources/frm-train-gate-2026-10-21.md): platform ids are
// belt end ids, and a station name keeps the trailing space the player typed.

const station = (id: string, name: string, platforms: [string, "load" | "unload", string[]?][]): TrainRouteRecord => ({
  recordType: "station",
  id,
  name,
  platforms: platforms.map(([pid, mode, items]) => ({ id: pid, mode, items: items ?? [] })),
});
const train = (id: string, stops: string[]): TrainRouteRecord => ({ recordType: "train", id, name: id, stops, items: [] });
const belt = (from: string, to: string, item: string | null, o: Partial<PlannerEdge> = {}): PlannerEdge => ({
  from,
  to,
  kind: "belt",
  itemClassName: item,
  itemName: item,
  ratePerMinute: null,
  rate: "unknown",
  mixed: false,
  capacityPerMinute: null,
  conveyorCount: 1,
  ...o,
});

/** Platform ids are node keys `N:<platform id>` unless listed as absent. */
function input(trainRoutes: TrainRouteRecord[] | null, o: Partial<LogisticsInput> = {}): LogisticsInput {
  return { trainRoutes, edges: [], nodeOfPlatform: (id) => `N:${id}`, uploaders: [], itemNames: new Map(), ...o };
}

const AB = [
  station("sA", "Farm Out ", [["pA", "load", ["Desc_OreIron_C"]]]),
  station("sB", "Base In", [["pB", "unload", ["Desc_OreIron_C"]]]),
];

describe("buildLogisticsEdges: trains", () => {
  it("makes one edge from the loading platform to the unloading platform with the item", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["Farm Out ", "Base In"])], { itemNames: new Map([["Desc_OreIron_C", "Iron Ore"]]) }));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0]).toMatchObject({
      from: "N:pA",
      to: "N:pB",
      mode: "train",
      itemClassName: "Desc_OreIron_C",
      itemName: "Iron Ore",
      itemFrom: "inventory",
      carriers: 1,
      routeName: "Farm Out to Base In",
      ratePerMinute: null,
      rate: "unknown",
    });
    expect(PlannerTransportSchema.safeParse(r.transports[0]).success).toBe(true);
    expect(r.notes).toEqual([]);
    expect(r.depotNode).toBeNull();
  });

  it("merges two trains on one route into one edge with carriers 2", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["Farm Out ", "Base In"]), train("t2", ["Base In", "Farm Out "])]));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0].carriers).toBe(2);
  });

  it("counts a train once however many times it runs the route", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["Farm Out ", "Base In", "Farm Out ", "Base In"])]));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0].carriers).toBe(1);
  });

  it("matches a stop name whose trailing space differs on one side", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["Farm Out", "Base In "])]));
    expect(r.transports).toHaveLength(1);
  });

  it("goes only forward in the timetable, and stops at the return to the loading station", () => {
    // A loads, B unloads and loads, C unloads. A -> B, A -> C, B -> C. B -> A: A is a load-only station, so nothing.
    const stations = [
      station("sA", "A", [["pA", "load", ["Desc_X_C"]]]),
      station("sB", "B", [["pB1", "unload", ["Desc_X_C"]], ["pB2", "load", ["Desc_Y_C"]]]),
      station("sC", "C", [["pC1", "unload", ["Desc_X_C", "Desc_Y_C"]]]),
    ];
    const r = buildLogisticsEdges(input([...stations, train("t", ["A", "B", "C"])]));
    const keys = r.transports.map((t) => `${t.from}>${t.to}:${t.itemClassName}`);
    expect(keys).toEqual(["N:pA>N:pB1:Desc_X_C", "N:pA>N:pC1:Desc_X_C", "N:pB2>N:pC1:Desc_Y_C"]);
  });

  it("does not run past the train's own return to the loading station", () => {
    // A, B, A, C: from the first A only B is reached before A comes round again; the second A reaches C, and its wrap
    // back to the first A ends the walk.
    const stations = [
      station("sA", "A", [["pA", "load", ["Desc_X_C"]]]),
      station("sB", "B", [["pB", "unload", ["Desc_X_C"]]]),
      station("sC", "C", [["pC", "unload", ["Desc_X_C"]]]),
    ];
    const r = buildLogisticsEdges(input([...stations, train("t", ["A", "B", "A", "C"])]));
    expect(r.transports.map((t) => t.to).sort()).toEqual(["N:pB", "N:pC"]);
  });

  it("carries only the items both ends name; a mismatch makes no edge", () => {
    const stations = [
      station("sA", "A", [["pA", "load", ["Desc_X_C", "Desc_Y_C"]]]),
      station("sB", "B", [["pB", "unload", ["Desc_Y_C", "Desc_Z_C"]]]),
    ];
    expect(buildLogisticsEdges(input([...stations, train("t", ["A", "B"])])).transports.map((t) => t.itemClassName)).toEqual(["Desc_Y_C"]);
    const apart = [station("sA", "A", [["pA", "load", ["Desc_X_C"]]]), station("sB", "B", [["pB", "unload", ["Desc_Z_C"]]])];
    expect(buildLogisticsEdges(input([...apart, train("t", ["A", "B"])])).transports).toEqual([]);
  });

  it("takes the item from the belt into the loader and from the belt out of the unloader", () => {
    const stations = [station("sA", "A", [["pA", "load"]]), station("sB", "B", [["pB", "unload"]])];
    const loaderOnly = buildLogisticsEdges(input([...stations, train("t", ["A", "B"])], { edges: [belt("M", "N:pA", "Desc_X_C")] }));
    expect(loaderOnly.transports.map((t) => [t.itemClassName, t.itemFrom])).toEqual([["Desc_X_C", "upstream"]]);
    const unloaderOnly = buildLogisticsEdges(input([...stations, train("t", ["A", "B"])], { edges: [belt("N:pB", "F", "Desc_X_C")] }));
    expect(unloaderOnly.transports.map((t) => [t.itemClassName, t.itemFrom])).toEqual([["Desc_X_C", "downstream"]]);
    const both = buildLogisticsEdges(input([...stations, train("t", ["A", "B"])], { edges: [belt("M", "N:pA", "Desc_X_C"), belt("N:pB", "F", "Desc_Y_C")] }));
    expect(both.transports).toEqual([]);
  });

  it("an unloader's excess belt is not downstream demand", () => {
    const stations = [station("sA", "A", [["pA", "load", ["Desc_X_C"]]]), station("sB", "B", [["pB", "unload"]])];
    const r = buildLogisticsEdges(input([...stations, train("t", ["A", "B"])], { edges: [belt("N:pB", "S", "Desc_Y_C", { flow: "excess" })] }));
    expect(r.transports.map((t) => t.itemClassName)).toEqual(["Desc_X_C"]);
  });

  it("an edge with no known item at either end is drawn with a null item", () => {
    const stations = [station("sA", "A", [["pA", "load"]]), station("sB", "B", [["pB", "unload"]])];
    const r = buildLogisticsEdges(input([...stations, train("t", ["A", "B"])]));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0]).toMatchObject({ itemClassName: null, itemName: null, rate: "unknown", ratePerMinute: null });
    expect(r.transports[0]).not.toHaveProperty("itemFrom");
  });

  it("estimates a rate from the downstream supply when one transport serves the item", () => {
    const edges = [belt("N:pB", "F", "Desc_OreIron_C", { ratePerMinute: 120, rate: "measured", flow: "supply", destination: "factory" })];
    const r = buildLogisticsEdges(input([...AB, train("t1", ["Farm Out ", "Base In"])], { edges }));
    expect(r.transports[0]).toMatchObject({ ratePerMinute: 120, rate: "estimated", flow: "supply", destination: "factory" });
  });

  it("gives no rate when two transports bring the same item to the node, or a downstream rate is unknown", () => {
    const stations = [
      station("sA", "A", [["pA", "load", ["Desc_X_C"]]]),
      station("sC", "C", [["pC", "load", ["Desc_X_C"]]]),
      station("sB", "B", [["pB", "unload", ["Desc_X_C"]]]),
    ];
    const known = [belt("N:pB", "F", "Desc_X_C", { ratePerMinute: 60, rate: "measured" })];
    const two = buildLogisticsEdges(input([...stations, train("t1", ["A", "B"]), train("t2", ["C", "B"])], { edges: known }));
    expect(two.transports.map((t) => t.rate)).toEqual(["unknown", "unknown"]);
    const unknownDownstream = buildLogisticsEdges(input([...stations, train("t1", ["A", "B"])], { edges: [belt("N:pB", "F", "Desc_X_C")] }));
    expect(unknownDownstream.transports.map((t) => t.rate)).toEqual(["unknown"]);
  });

  it("a duplicate station name makes no edge through it and one note", () => {
    const stations = [
      station("sA", "A", [["pA", "load", ["Desc_X_C"]]]),
      station("sB1", "Dock ", [["pB1", "unload", ["Desc_X_C"]]]),
      station("sB2", "Dock", [["pB2", "unload", ["Desc_X_C"]]]),
    ];
    const r = buildLogisticsEdges(input([...stations, train("t1", ["A", "Dock"]), train("t2", ["A", "Dock "])]));
    expect(r.transports).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].code).toBe("duplicateStationName");
    expect(r.notes[0].text).toContain('"Dock"');
    expect(r.notes[0].text.length).toBeLessThanOrEqual(300);
  });

  it("a duplicate station is not an origin either, and a good stop beyond it still links", () => {
    const stations = [
      station("sA1", "Twin", [["pA1", "load", ["Desc_X_C"]]]),
      station("sA2", "Twin", [["pA2", "load", ["Desc_X_C"]]]),
      station("sB", "B", [["pB", "unload", ["Desc_X_C"]]]),
      station("sC", "C", [["pC", "load", ["Desc_X_C"]]]),
    ];
    const r = buildLogisticsEdges(input([...stations, train("t", ["Twin", "C", "B"])]));
    expect(r.transports.map((t) => `${t.from}>${t.to}`)).toEqual(["N:pC>N:pB"]);
  });

  it("a timetable stop naming no station makes a note and no edge", () => {
    const r = buildLogisticsEdges(input([...AB, train("t", ["Farm Out ", "Nowhere", "Base In"])]));
    expect(r.transports).toHaveLength(1);
    expect(r.notes.map((n) => n.code)).toEqual(["unknownTimetableStop"]);
  });

  it("long name lists stay inside the note bound", () => {
    const names = Array.from({ length: 30 }, (_, i) => `${"n".repeat(150)}${i}`);
    const stations = names.flatMap((n, i) => [station(`s${i}a`, n, []), station(`s${i}b`, n, [])]);
    const r = buildLogisticsEdges(input([...stations, train("t", names)]));
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].text.length).toBeLessThanOrEqual(300);
    expect(r.notes[0].text).toContain("more");
  });

  it("skips a platform that holds no kept node, and a route that stays within one node", () => {
    const r = buildLogisticsEdges(input([...AB, train("t", ["Farm Out ", "Base In"])], { nodeOfPlatform: (id) => (id === "pA" ? null : "same") }));
    expect(r.transports).toEqual([]);
    const same = buildLogisticsEdges(input([...AB, train("t", ["Farm Out ", "Base In"])], { nodeOfPlatform: () => "same" }));
    expect(same.transports).toEqual([]);
  });

  it("a single-stop or empty timetable makes nothing; a null layer makes no train edge and no note", () => {
    expect(buildLogisticsEdges(input([...AB, train("t", ["Farm Out "]), train("u", [])])).transports).toEqual([]);
    const none = buildLogisticsEdges(input(null));
    expect(none).toEqual({ transports: [], notes: [], depotNode: null });
  });

  it("is byte-identical for shuffled records, edges and platforms", () => {
    const stations = [
      station("sA", "A", [["pA1", "load", ["Desc_X_C"]], ["pA2", "load", ["Desc_Y_C"]]]),
      station("sB", "B", [["pB1", "unload", ["Desc_X_C"]], ["pB2", "unload", ["Desc_Y_C"]]]),
    ];
    const trains = [train("t1", ["A", "B"]), train("t2", ["B", "A"]), train("t3", ["A", "B"])];
    const edges = [belt("N:pB1", "F", "Desc_X_C", { ratePerMinute: 5, rate: "estimated" }), belt("N:pB2", "G", "Desc_Y_C", { ratePerMinute: 7, rate: "estimated" })];
    const a = buildLogisticsEdges(input([...stations, ...trains], { edges }));
    const rev = <T>(l: T[]): T[] => [...l].reverse();
    const shuffled = [...rev(trains), ...rev(stations).map((s) => (s.recordType === "station" ? { ...s, platforms: rev(s.platforms) } : s))];
    const b = buildLogisticsEdges(input(shuffled, { edges: rev(edges) }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.transports).toHaveLength(2);
  });
});

describe("buildLogisticsEdges: the Dimensional Depot", () => {
  const up = (key: string, x = 0, y = 0) => ({ key, at: { x, y } });

  it("gives each uploader one depot edge per item it receives, and the virtual node", () => {
    const edges = [
      belt("M1", "U", "Desc_X_C", { ratePerMinute: 30, rate: "measured" }),
      belt("M2", "U", "Desc_Y_C", { ratePerMinute: 10, rate: "estimated" }),
      belt("M3", "U", "Desc_Y_C", { ratePerMinute: 5, rate: "measured" }),
    ];
    const r = buildLogisticsEdges(input(null, { edges, uploaders: [up("U", 100, 40)], itemNames: new Map([["Desc_X_C", "X item"]]) }));
    expect(r.transports.map((t) => [t.from, t.to, t.mode, t.itemClassName, t.itemName, t.ratePerMinute, t.rate, t.destination])).toEqual([
      ["U", DEPOT_NODE_KEY, "depot", "Desc_X_C", "X item", 30, "measured", "depot"],
      ["U", DEPOT_NODE_KEY, "depot", "Desc_Y_C", "Desc_Y_C", 15, "estimated", "depot"],
    ]);
    expect(r.transports.every((t) => t.carriers === 0 && t.routeName === null && t.flow === "output")).toBe(true);
    expect(r.transports.every((t) => PlannerTransportSchema.safeParse(t).success)).toBe(true);
    expect(r.depotNode).toMatchObject({ key: DEPOT_NODE_KEY, name: "Dimensional Depot", role: "depot", count: 1, at: { x: 100, y: 40 } });
  });

  it("one virtual node for several uploaders, at their centroid", () => {
    const r = buildLogisticsEdges(input(null, { uploaders: [up("U2", 300, 0), up("U1", 100, 0)] }));
    expect(r.depotNode?.at).toEqual({ x: 200, y: 0 });
    expect(r.transports.map((t) => t.from)).toEqual(["U1", "U2"]);
  });

  it("an uploader with an unidentified belt gets one null-item edge with no rate", () => {
    const r = buildLogisticsEdges(input(null, { edges: [belt("M", "U", null, { ratePerMinute: 9 }), belt("M2", "U", "Desc_X_C")], uploaders: [up("U")] }));
    expect(r.transports.map((t) => [t.itemClassName, t.ratePerMinute, t.rate])).toEqual([
      [null, null, "unknown"],
      ["Desc_X_C", null, "unknown"],
    ]);
  });

  it("an uploader nothing feeds still shows an edge to the Depot", () => {
    const r = buildLogisticsEdges(input(null, { uploaders: [up("U")] }));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0].itemClassName).toBeNull();
  });

  it("no uploader, no virtual node", () => {
    expect(buildLogisticsEdges(input([...AB, train("t", ["Farm Out ", "Base In"])])).depotNode).toBeNull();
  });
});
