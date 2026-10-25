import { describe, it, expect } from "vitest";
import { PlannerTransportSchema, BottleneckNoteSchema, type PlannerEdge, type TrainRouteRecord } from "@satisfactory-dash/shared";
import { buildLogisticsEdges, type LogisticsInput } from "./logisticsEdges.js";

const station = (id: string, name: string, platforms: [string, string, string[]?][]): TrainRouteRecord => ({
  recordType: "station",
  id,
  name,
  platforms: platforms.map(([pid, mode, items]) => ({ id: pid, mode, items: items ?? [] })),
});
const train = (id: string, stops: string[]): TrainRouteRecord => ({ recordType: "train", id, name: id, stops, items: [] });
const belt = (from: string, to: string, item: string | null, o: Partial<PlannerEdge> = {}): PlannerEdge => ({
  from, to, kind: "belt", itemClassName: item, itemName: item, ratePerMinute: null, rate: "unknown", mixed: false,
  capacityPerMinute: null, conveyorCount: 1, ...o,
});
const input = (trainRoutes: TrainRouteRecord[] | null, o: Partial<LogisticsInput> = {}): LogisticsInput => ({
  trainRoutes, edges: [], nodeOfPlatform: (id) => `N:${id}`, uploaders: [], itemNames: new Map(), ...o,
});

describe("buildLogisticsEdges hunt: determinism", () => {
  it("itemFrom does not depend on the platform order of a station", () => {
    // p1 and p2 both sit on node N:L; p1 lists the item in its inventory, p2 only sees it arrive on a belt.
    const edges = [belt("N:up", "N:L", "X")];
    const mk = (order: number[]) => {
      const plats: [string, string, string[]?][] = [["p1", "load", ["X"]], ["p2", "load"]];
      return [
        station("sA", "A", order.map((i) => plats[i])),
        station("sB", "B", [["pB", "unload", ["X"]]]),
        train("t", ["A", "B"]),
      ];
    };
    const node = (id: string) => (id === "p1" || id === "p2" ? "N:L" : `N:${id}`);
    const a = buildLogisticsEdges(input(mk([0, 1]), { edges, nodeOfPlatform: node }));
    const b = buildLogisticsEdges(input(mk([1, 0]), { edges, nodeOfPlatform: node }));
    expect(JSON.stringify(b.transports)).toBe(JSON.stringify(a.transports));
  });

  it("reordering the records and edges gives the same output", () => {
    const recs = [
      station("s1", "A", [["p1", "load", ["X", "Y"]]]),
      station("s2", "B", [["p2", "unload", ["X", "Y"]]]),
      station("s3", "C", [["p3", "unload"]]),
      train("t1", ["A", "B", "C"]),
      train("t2", ["C", "A", "B"]),
    ];
    const edges = [belt("N:p2", "N:d", "X", { ratePerMinute: 30.1, rate: "measured" }), belt("N:p2", "N:e", "X", { ratePerMinute: 10.2, rate: "measured" }), belt("N:p2", "N:f", "Y", { ratePerMinute: 5, rate: "measured" })];
    const a = buildLogisticsEdges(input(recs, { edges }));
    const b = buildLogisticsEdges(input([...recs].reverse(), { edges: [...edges].reverse() }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("buildLogisticsEdges hunt: timetable", () => {
  const AB = [station("sA", "A", [["pA", "load", ["X"]]]), station("sB", "B", [["pB", "unload", ["X"]]])];
  it("one-stop, empty and all-unknown timetables draw nothing and do not throw", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["A"]), train("t2", []), train("t3", ["Z", "Q"])]));
    expect(r.transports).toEqual([]);
  });
  it("a station repeated in a timetable still gives one edge and one carrier", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["A", "B", "A", "B"])]));
    expect(r.transports).toHaveLength(1);
    expect(r.transports[0].carriers).toBe(1);
  });
  it("carriers counts distinct trains, not stop pairs", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["A", "B"]), train("t2", ["B", "A", "B"])]));
    expect(r.transports[0].carriers).toBe(2);
  });
  it("a null stop between two real ones does not stop the walk", () => {
    const r = buildLogisticsEdges(input([...AB, train("t1", ["A", "Nope", "B"])]));
    expect(r.transports).toHaveLength(1);
    expect(r.notes.map((n) => n.code)).toContain("unknownTimetableStop");
  });
  it("a duplicated name resolves to nobody even with different trailing space", () => {
    const r = buildLogisticsEdges(input([...AB, station("sB2", "B ", [["pB2", "unload", ["X"]]]), train("t1", ["A", "B"])]));
    expect(r.transports).toEqual([]);
    expect(r.notes.map((n) => n.code)).toContain("duplicateStationName");
  });
  it("the same-named stop at both ends (round trip A, A) draws nothing", () => {
    const r = buildLogisticsEdges(input([station("sA", "A", [["p1", "load"], ["p2", "unload"]]), train("t", ["A", "A"])]));
    expect(r.transports).toEqual([]);
  });
});

describe("buildLogisticsEdges hunt: contract bounds", () => {
  it("long names and many problem stops give schema-valid transports and notes", () => {
    const long = "n".repeat(200);
    const stations: TrainRouteRecord[] = [
      station("sA", long, [["pA", "load", ["C".repeat(200)]]]),
      station("sB", long.slice(1) + "z", [["pB", "unload", ["C".repeat(200)]]]),
    ];
    const bad = Array.from({ length: 30 }, (_, i) => `${"u".repeat(190)}${i}`);
    const r = buildLogisticsEdges(input([...stations, train("t", [long, long.slice(1) + "z", ...bad])]));
    expect(r.transports.length).toBe(1);
    for (const t of r.transports) expect(() => PlannerTransportSchema.parse(t)).not.toThrow();
    for (const n of r.notes) expect(() => BottleneckNoteSchema.parse(n)).not.toThrow();
  });
  it("an empty station name does not produce a schema-invalid note", () => {
    const r = buildLogisticsEdges(input([train("t", ["", " "])]));
    for (const n of r.notes) expect(() => BottleneckNoteSchema.parse(n)).not.toThrow();
  });
});

describe("buildLogisticsEdges hunt: depot and rates", () => {
  it("a negative-zero centroid is normalised and the depot edge is valid", () => {
    const r = buildLogisticsEdges(input(null, { uploaders: [{ key: "u1", at: { x: -0.2, y: 0 } }] }));
    expect(Object.is(r.depotNode?.at.x, -0)).toBe(false);
    expect(r.transports).toHaveLength(1);
    expect(() => PlannerTransportSchema.parse(r.transports[0])).not.toThrow();
  });
  it("a depot edge with a mix of known and unknown belt rates is unknown", () => {
    const r = buildLogisticsEdges(input(null, {
      uploaders: [{ key: "u1", at: { x: 0, y: 0 } }],
      edges: [belt("a", "u1", "X", { ratePerMinute: 10, rate: "measured" }), belt("b", "u1", "X")],
    }));
    expect(r.transports[0]).toMatchObject({ ratePerMinute: null, rate: "unknown" });
  });
  it("a train edge is rated only when it is the sole arrival of the item", () => {
    const recs = [
      station("s1", "A", [["p1", "load", ["X"]]]),
      station("s2", "B", [["p2", "unload", ["X"]]]),
      station("s3", "C", [["p3", "load", ["X"]]]),
      train("t1", ["A", "B"]),
      train("t2", ["C", "B"]),
    ];
    const edges = [belt("N:p2", "N:d", "X", { ratePerMinute: 40, rate: "measured", destination: "factory" })];
    const r = buildLogisticsEdges(input(recs, { edges }));
    expect(r.transports).toHaveLength(2);
    for (const t of r.transports) expect(t.rate).toBe("unknown");
  });
});

describe("buildLogisticsEdges hunt: performance", () => {
  it("many trains x stops x platforms finishes quickly", () => {
    const S = 60;
    const recs: TrainRouteRecord[] = [];
    for (let s = 0; s < S; s++) {
      recs.push(station(`s${s}`, `St${s}`, Array.from({ length: 4 }, (_, p) => [`p${s}_${p}`, p % 2 ? "unload" : "load", ["X", "Y", "Z"]] as [string, string, string[]])));
    }
    for (let t = 0; t < 150; t++) recs.push(train(`t${t}`, Array.from({ length: 25 }, (_, i) => `St${(t * 7 + i * 3) % S}`)));
    const edges: PlannerEdge[] = [];
    for (let i = 0; i < 5000; i++) edges.push(belt(`N:p${i % S}_${i % 4}`, `N:q${i}`, "X", { destination: "factory" }));
    const t0 = performance.now();
    const r = buildLogisticsEdges(input(recs, { edges }));
    const ms = performance.now() - t0;
    expect(r.transports.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
  }, 60_000);
});
