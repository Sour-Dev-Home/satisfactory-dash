import { describe, it, expect } from "vitest";
import { BottlenecksSchema, type ConveyorEdge, type FactoryBuilding } from "@satisfactory-dash/shared";
import { findBottlenecks, type BottleneckEdges } from "./bottleneckFinder.js";

// ---- fixture helpers ----

type Unit = "items/min" | "m3/min";
const rate = (className: string, max: number, cur = 0, unit: Unit = "items/min") => ({
  name: className,
  className,
  currentPerMinute: cur,
  maxPerMinute: max,
  percent: max === 0 ? 0 : (cur / max) * 100,
  unit,
});

interface MachineOptions {
  state?: string;
  /** [className, max per minute] */
  ing?: [string, number][];
  out?: [string, number][];
  unit?: Unit;
  name?: string;
  current?: number;
}

function machine(id: string, o: MachineOptions = {}): FactoryBuilding {
  const unit = o.unit ?? "items/min";
  return {
    id,
    name: o.name ?? `Machine ${id}`,
    className: "Build_Constructor_C",
    recipe: "Recipe",
    isProducing: true,
    isPaused: false,
    isBackedUp: o.state === "backedUp",
    production: (o.out ?? []).map(([c, m]) => rate(c, m, o.current ?? 0, unit)),
    ingredients: (o.ing ?? []).map(([c, m]) => rate(c, m, 0, unit)),
    state: o.state ?? "producing",
  };
}

const TIER = new Map<number, string>([[60, "Conveyor Belt Mk.1"], [120, "Conveyor Belt Mk.2"], [270, "Conveyor Belt Mk.3"], [780, "Conveyor Belt Mk.5"]]);

interface EdgeOptions {
  cap?: number | null;
  kind?: "belt" | "lift" | "pipe";
  fromKind?: ConveyorEdge["fromKind"];
  toKind?: ConveyorEdge["toKind"];
  tier?: string;
}

/** `from`/`to` are building or node ids; null = open end. Kinds default to machine, or splitter for an id starting "S". */
function edge(id: string, from: string | null, to: string | null, o: EdgeOptions = {}): ConveyorEdge {
  const kindOf = (n: string | null): ConveyorEdge["fromKind"] => (n === null ? null : n.startsWith("S") ? "splitter" : n.startsWith("J") ? "junction" : "machine");
  const cap = o.cap === undefined ? 780 : o.cap;
  const kind = o.kind ?? "belt";
  return {
    id,
    kind,
    from,
    fromKind: o.fromKind === undefined ? kindOf(from) : o.fromKind,
    to,
    toKind: o.toKind === undefined ? kindOf(to) : o.toKind,
    capacityPerMinute: cap,
    tier: o.tier ?? (kind === "pipe" ? "Pipeline Mk.1" : (TIER.get(cap as number) ?? "Conveyor Belt")),
    at: { x: 10, y: 20 },
  };
}

const PLATE = "Desc_IronPlate_C";
const WIRE = "Desc_Wire_C";
const ORE = "Desc_OreIron_C";

const run = (b: FactoryBuilding[], e: BottleneckEdges, limit?: number) => {
  const result = findBottlenecks(b, e, limit === undefined ? {} : { limit });
  // Every result must satisfy the contract.
  BottlenecksSchema.parse(result);
  return result;
};

/** A healthy plate producer P wired to an underfed consumer M through belt(s); the base of several cases. */
const producer = (max = 120, state = "producing") => machine("P", { out: [[PLATE, max]], state, current: max });

describe("item level (no connection data)", () => {
  it("noProducer: nothing in the factory makes the item", () => {
    const r = run([machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].rootCause.kind).toBe("noProducer");
    expect(r.findings[0].rootCause.itemClassName).toBe(PLATE);
    expect(r.findings[0].text).toContain("nothing in the factory makes");
  });

  it("deficit: the producers make less than the consumers want", () => {
    const r = run([producer(30), machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    const root = r.findings[0].rootCause;
    expect(root.kind).toBe("deficit");
    expect(root.supplyMaxPerMinute).toBe(30);
    expect(root.demandMaxPerMinute).toBe(60);
    // #592: one more P closes the 30/min gap.
    expect(r.findings[0].fix).toEqual({ producerName: "Machine P", recipe: "Recipe", perMachinePerMinute: 30, machines: 1, unit: "items/min" });
    expect(r.findings[0].text).toContain("at full speed");
  });

  it("fix (#592): the most common producer, scaled to 100% clock, its median rate, and the gap rounded up", () => {
    const smelter = (id: string, max: number, clock?: number) => ({
      ...machine(id, { out: [[PLATE, max]], current: max, name: "Smelter" }),
      recipe: "Iron Ingot",
      ...(clock === undefined ? {} : { clockSpeedPercent: clock }),
    });
    const r = run(
      [
        smelter("S1", 30),
        smelter("S2", 15, 50), // 30/min at 100%
        smelter("S3", 45, 150), // 30/min at 100%
        { ...machine("F", { out: [[PLATE, 40]], current: 40, name: "Foundry" }), recipe: "Alt" },
        machine("M", { state: "underfed", ing: [[PLATE, 200]] }),
      ],
      "unsupported",
    );
    // Supply 130, demand 200: 70 short, 30 each, so 3 more.
    expect(r.findings[0].fix).toMatchObject({ producerName: "Smelter", recipe: "Iron Ingot", perMachinePerMinute: 30, machines: 3 });
  });

  it("findings carry the representative's recipe and rounded position (#592)", () => {
    const m = { ...machine("M", { state: "underfed", ing: [[PLATE, 60]] }), location: { xM: 10.6, yM: -20.4, zM: 0, rotationDeg: 0 } };
    const f = run([m], "unsupported").findings[0];
    expect(f).toMatchObject({ recipe: "Recipe", at: { x: 11, y: -20 }, affectedCount: 1 });
    expect(f.affected).toEqual([{ buildingId: "M", buildingName: "Machine M", recipe: "Recipe", at: { x: 11, y: -20 } }]);
    expect(f.fix).toBeUndefined(); // noProducer: nothing to add more of
  });

  it("upstream: a producer that is unpowered is the terminal", () => {
    const r = run([producer(120, "unpowered"), machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    const f = r.findings[0];
    expect(f.chain.map((s) => s.kind)).toEqual(["upstream", "unpowered"]);
    expect(f.rootCause).toMatchObject({ kind: "unpowered", buildingId: "P" });
  });

  it.each(["paused", "idle"])("upstream: a %s producer is a terminal", (state) => {
    const r = run([producer(120, state), machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    expect(r.findings[0].rootCause.kind).toBe(state);
  });

  it("upstream recurses through an underfed producer to its own root cause", () => {
    const r = run(
      [
        machine("P", { state: "underfed", ing: [[ORE, 60]], out: [[PLATE, 120]] }),
        // M loses the most output, so it is the shared cause's representative and its own chain is the one shown.
        machine("M", { state: "underfed", ing: [[PLATE, 60]], out: [["Big_C", 1000]] }),
      ],
      "unsupported",
    );
    const m = r.findings.find((f) => f.buildingId === "M");
    expect(m?.affected?.map((a) => a.buildingId)).toEqual(["M", "P"]);
    expect(m?.chain.map((s) => s.kind)).toEqual(["upstream", "noProducer"]);
    expect(m?.rootCause).toMatchObject({ kind: "noProducer", itemClassName: ORE });
  });

  it("logistics without cappedBy: supply is enough and the producer is healthy", () => {
    const r = run([producer(120), machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    expect(r.findings[0].rootCause.kind).toBe("logistics");
    expect(r.findings[0].rootCause.cappedBy).toBeUndefined();
  });

  it("a backed-up producer counts as healthy (logistics, not upstream)", () => {
    const r = run([producer(120, "backedUp"), machine("M", { state: "underfed", ing: [[PLATE, 60]] })], "unsupported");
    const m = r.findings.find((f) => f.buildingId === "M");
    expect(m?.rootCause.kind).toBe("logistics");
  });

  it("loop: an item cycle ends the walk with a loop step", () => {
    const r = run(
      [
        machine("A", { state: "underfed", ing: [["B_C", 60]], out: [["A_C", 60]] }),
        machine("B", { state: "underfed", ing: [["A_C", 60]], out: [["B_C", 60]] }),
      ],
      "unsupported",
    );
    const a = r.findings.find((f) => f.buildingId === "A");
    expect(a?.chain.map((s) => s.kind)).toEqual(["upstream", "upstream", "loop"]);
    expect(a?.rootCause.kind).toBe("loop");
  });

  it("caps the chain at 8 steps", () => {
    const n = 12;
    const ms = Array.from({ length: n }, (_, i) =>
      machine(`M${String(i).padStart(2, "0")}`, { state: "underfed", ing: [[`I${i + 1}`, 10]], out: [[`I${i}`, 10]] }),
    );
    const r = run(ms, "unsupported", 50);
    const first = r.findings.find((f) => f.buildingId === "M00");
    expect(first?.chain).toHaveLength(8);
  });

  it("downstream: noConsumer, surplus, downstream and logistics", () => {
    const out = (id: string, state: string, x: string) => machine(id, { state, out: [[x, 60]], current: 60 });
    const r = run(
      [
        out("N", "backedUp", "NoOne_C"),
        out("S", "backedUp", PLATE),
        machine("C1", { ing: [[PLATE, 20]] }),
        // a backed-up machine whose only consumer is paused
        out("D", "backedUp", WIRE),
        machine("C2", { state: "paused", ing: [[WIRE, 200]] }),
        // supply equals demand and the consumer is healthy
        out("L", "backedUp", ORE),
        machine("C3", { ing: [[ORE, 60]] }),
      ],
      "unsupported",
    );
    const kinds = Object.fromEntries(r.findings.map((f) => [f.buildingId, f.rootCause.kind]));
    expect(kinds).toMatchObject({ N: "noConsumer", S: "surplus", D: "paused", L: "logistics" });
    expect(r.findings.find((f) => f.buildingId === "D")?.chain.map((s) => s.kind)).toEqual(["downstream", "paused"]);
    expect(r.findings.every((f) => f.state === "backedUp")).toBe(true);
  });
});

describe("belt level", () => {
  const M = machine("M", { state: "underfed", ing: [[PLATE, 90]] });

  it("noProducer when nothing makes the item and no source is upstream", () => {
    const r = run([M], [edge("e1", "S1", "M")]);
    expect(r.beltData).toBe("present");
    expect(r.findings[0].rootCause.kind).toBe("noProducer");
  });

  it("notConnected: the item is made, but nothing upstream of the machine makes it", () => {
    const q = machine("Q", { ing: [[PLATE, 10]] });
    const r = run([producer(), q, M], [edge("e1", "P", "Q"), edge("e2", "S1", "M")]);
    expect(r.findings[0].rootCause.kind).toBe("notConnected");
    expect(r.findings[0].text).toContain("no belt or pipe connects");
  });

  it("an unread source upstream (an extractor) makes the item supplied, not noProducer or notConnected", () => {
    const r = run([M], [edge("e1", "X1", "M", { fromKind: "extractor" })]);
    expect(r.findings[0].rootCause.kind).toBe("logistics");
    expect(r.findings[0].rootCause.cappedBy).toBeUndefined();
  });

  it("deficit is local: the producers that reach the machine make less than their consumers want", () => {
    const r = run([producer(30), M], [edge("e1", "P", "M")]);
    expect(r.findings[0].rootCause).toMatchObject({ kind: "deficit", supplyMaxPerMinute: 30, demandMaxPerMinute: 90 });
  });

  it("a far-away producer does not hide a local deficit (geography)", () => {
    const far = machine("F", { out: [[PLATE, 1000]], current: 1000 });
    const q = machine("Q", { ing: [[PLATE, 10]] });
    const r = run([producer(30), far, q, M], [edge("e1", "P", "M"), edge("e2", "F", "Q")]);
    expect(r.findings[0].rootCause.kind).toBe("deficit");
  });

  it("upstream through an unpowered producer that reaches the machine", () => {
    const r = run([producer(120, "unpowered"), M], [edge("e1", "P", "M")]);
    expect(r.findings[0].chain.map((s) => s.kind)).toEqual(["upstream", "unpowered"]);
  });

  it("logistics with cappedBy: a Mk.1 belt behind a splitter", () => {
    const q = machine("Q", { ing: [[PLATE, 30]] });
    const r = run(
      [producer(120), q, M],
      [edge("e1", "P", "S1"), edge("e2", "S1", "M", { cap: 60 }), edge("e3", "S1", "Q")],
    );
    const root = r.findings[0].rootCause;
    expect(root.kind).toBe("logistics");
    expect(root.cappedBy).toMatchObject({ conveyorId: "e2", tier: "Conveyor Belt Mk.1", capacityPerMinute: 60, fromId: "S1", toId: "M" });
    expect(root.supplyMaxPerMinute).toBe(60);
    expect(root.demandMaxPerMinute).toBe(90);
    expect(r.findings[0].text).toContain("Conveyor Belt Mk.1");
    expect(r.findings[0].text).toContain("near (10, 20)");
  });

  it("the cut names the lowest-capacity conveyor on the path", () => {
    const r = run(
      [producer(120), M],
      [edge("e1", "P", "S1", { cap: 120 }), edge("e2", "S1", "S2", { cap: 270 }), edge("e3", "S2", "M", { cap: 60 })],
    );
    expect(r.findings[0].rootCause.cappedBy?.conveyorId).toBe("e3");
  });

  it("shared manifold: one Mk.2 belt caps the many consumers behind it", () => {
    const consumers = Array.from({ length: 12 }, (_, i) => machine(`C${String(i).padStart(2, "0")}`, { state: "underfed", ing: [[WIRE, 30]] }));
    const maker = machine("P", { out: [[WIRE, 600]], current: 600 });
    const edges = [
      edge("a0", "P", "S1", { cap: 120 }),
      ...consumers.map((c, i) => edge(`b${String(i).padStart(2, "0")}`, "S1", c.id)),
    ];
    const r = run([maker, ...consumers], edges, 50);
    // One shared cause, one finding (#592) that lists all 12.
    expect(r.findings).toHaveLength(1);
    const [f] = r.findings;
    expect(f.rootCause.kind).toBe("logistics");
    expect(f.rootCause.cappedBy).toMatchObject({ conveyorId: "a0", capacityPerMinute: 120 });
    expect(f.text).toContain("affects 12 machines");
    expect(f.affectedCount).toBe(12);
    expect(f.affected?.map((a) => a.buildingId)).toContain(f.buildingId);
    expect(new Set(f.affected?.map((a) => a.buildingId)).size).toBe(12);
  });

  it("a shared cut outranks one unlocated logistics case", () => {
    const wires = Array.from({ length: 3 }, (_, i) => machine(`C${i}`, { state: "underfed", ing: [[WIRE, 30]] }));
    const maker = machine("P", { out: [[WIRE, 600]], current: 600 });
    // Z is unlocated (plenty of belt) and has a bigger loss, but is alone.
    const z = machine("Z", { state: "underfed", ing: [[PLATE, 10]], out: [["Out_C", 1000]], current: 0 });
    const plate = machine("PP", { out: [[PLATE, 500]], current: 500 });
    const edges = [
      edge("a0", "P", "S1", { cap: 60 }),
      ...wires.map((c) => edge(`b${c.id}`, "S1", c.id)),
      edge("z1", "PP", "Z"),
    ];
    const r = run([maker, plate, z, ...wires], edges);
    expect(r.findings.map((f) => f.affectedCount)).toEqual([3, 1]);
    expect(r.findings[0].affected?.map((a) => a.buildingId).sort()).toEqual(["C0", "C1", "C2"]);
    expect(r.findings[1].buildingId).toBe("Z");
  });

  it("a pipe loop: pipes are arcs both ways, so flow reaches a machine whatever the end order", () => {
    const w = "Desc_Water_C";
    const pump = machine("P", { out: [[w, 300]], current: 300, unit: "m3/min" });
    const m = machine("M", { state: "underfed", ing: [[w, 450]], unit: "m3/min" });
    const pipe = (id: string, from: string, to: string, cap: number) =>
      edge(id, from, to, { kind: "pipe", cap, tier: cap === 300 ? "Pipeline Mk.1" : "Pipeline Mk.2" });
    const r = run(
      [pump, m],
      [
        pipe("p1", "J1", "P", 600), // reversed on purpose
        pipe("p2", "J1", "J2", 600),
        pipe("p3", "J2", "J3", 600),
        pipe("p4", "J3", "J1", 600), // closes the loop
        pipe("p5", "M", "J3", 300), // reversed on purpose
        // a belt cannot carry water, even with a huge capacity
        edge("b1", "P", "M", { cap: 780 }),
      ],
    );
    const root = r.findings[0].rootCause;
    // Supply (300) is below the 450 wanted: deficit comes first and the pipes are not blamed.
    expect(root.kind).toBe("deficit");
    expect(root.unit).toBe("m3/min");

    const pump2 = machine("P", { out: [[w, 900]], current: 900, unit: "m3/min" });
    const r2 = run(
      [pump2, m],
      [pipe("p1", "J1", "P", 600), pipe("p2", "J1", "J2", 600), pipe("p3", "J2", "J3", 600), pipe("p4", "J3", "J1", 600), pipe("p5", "M", "J3", 300), edge("b1", "P", "M", { cap: 780 })],
    );
    const cap = r2.findings[0].rootCause.cappedBy;
    expect(cap).toMatchObject({ conveyorId: "p5", kind: "pipe", capacityPerMinute: 300 });
    expect(r2.findings[0].text).toContain("m3/min");
  });

  it("a pipe with no trusted capacity can carry flow but never caps it", () => {
    const w = "Desc_Water_C";
    const pump = machine("P", { out: [[w, 900]], current: 900, unit: "m3/min" });
    const m = machine("M", { state: "underfed", ing: [[w, 450]], unit: "m3/min" });
    const r = run([pump, m], [edge("p1", "P", "M", { kind: "pipe", cap: null, tier: "Pipeline" })]);
    expect(r.findings[0].rootCause.kind).toBe("logistics");
    expect(r.findings[0].rootCause.cappedBy).toBeUndefined();
  });

  it("an open end adds no arc: a belt that leads nowhere does not connect anything", () => {
    const q = machine("Q", { ing: [[PLATE, 10]] });
    const r = run(
      [producer(), q, M],
      [edge("e1", "P", null, { toKind: null }), edge("e2", null, "Q", { fromKind: null }), edge("e3", "S1", "M")],
    );
    expect(r.findings[0].rootCause.kind).toBe("notConnected");
  });

  it("a belt that joins another belt directly is one path", () => {
    const q = machine("Q", { ing: [[PLATE, 10]] });
    const r = run(
      [producer(120), q, M],
      [
        edge("e1", "P", "e2", { toKind: "conveyor" }),
        edge("e2", "e1", "M", { fromKind: "conveyor", cap: 60 }),
        edge("e9", "P", "Q"),
      ],
    );
    expect(r.findings.find((f) => f.buildingId === "M")?.rootCause.cappedBy?.conveyorId).toBe("e2");
  });

  it("backed up, belt level: an output belt caps the flow away", () => {
    const outMachine = machine("O", { state: "backedUp", out: [[PLATE, 120]], current: 120 });
    const c1 = machine("C1", { ing: [[PLATE, 200]] });
    const r = run([outMachine, c1], [edge("e1", "O", "C1", { cap: 60 })]);
    expect(r.findings[0].rootCause.kind).toBe("logistics");
    expect(r.findings[0].rootCause.cappedBy).toMatchObject({ conveyorId: "e1", capacityPerMinute: 60 });
  });

  it("backed up, belt level: nothing downstream is connected", () => {
    const outMachine = machine("O", { state: "backedUp", out: [[PLATE, 120]], current: 120 });
    const c1 = machine("C1", { ing: [[PLATE, 200]] });
    const r = run([outMachine, c1], [edge("e1", "O", "S1"), edge("e2", "S2", "C1")]);
    expect(r.findings[0].rootCause.kind).toBe("noConsumer");
  });
});

describe("beltData modes and notes", () => {
  const M = machine("M", { state: "underfed", ing: [[PLATE, 60]] });
  const P = producer(120);

  it("present: every recipe machine is on a conveyor", () => {
    const r = run([P, M], [edge("e1", "P", "M")]);
    expect(r.beltData).toBe("present");
    expect(r.connectionsRefreshMinutes).toBe(10);
    expect(r.notes.map((n) => n.code)).toEqual(["connectionsRefresh"]);
  });

  it("stale: a machine no conveyor names falls back to item level, with the refresh sentence", () => {
    const fresh = machine("U", { state: "underfed", ing: [[PLATE, 60]] });
    const r = run([P, M, fresh], [edge("e1", "P", "M")]);
    expect(r.beltData).toBe("stale");
    expect(r.notes.map((n) => n.code)).toEqual(["connectionsRefresh"]);
    const u = r.findings.find((f) => f.buildingId === "U");
    expect(u?.rootCause.kind).toBe("logistics");
    expect(u?.text).toContain("Connections refresh within 10 minutes");
    expect(r.findings.find((f) => f.buildingId === "M")?.text).not.toContain("refresh within");
  });

  it("stale: a producer built since the last read means item level for its consumers", () => {
    const late = machine("L", { out: [[PLATE, 500]], current: 500 });
    // M is on a conveyor, but no producer reaches it; the unnamed producer might.
    const r = run([late, M], [edge("e1", "S1", "M")]);
    expect(r.beltData).toBe("stale");
    expect(r.findings[0].rootCause.kind).not.toBe("notConnected");
  });

  it("a machine without a recipe being unnamed does not make the data stale", () => {
    const idle: FactoryBuilding = { ...machine("I"), recipe: null, state: "idle", production: [], ingredients: [] };
    const r = run([P, M, idle], [edge("e1", "P", "M")]);
    expect(r.beltData).toBe("present");
  });

  it("unsupported: item level only, with the update-FRM note and no refresh sentence", () => {
    const r = run([P, M], "unsupported");
    expect(r.beltData).toBe("unsupported");
    expect(r.notes).toEqual([{ code: "updateFrm", text: expect.stringContaining("1.5.4") }]);
    expect(r.findings[0].text).not.toContain("refresh");
  });

  it("tooLarge: item level only, with its own note", () => {
    const r = run([P, M], "tooLarge");
    expect(r.beltData).toBe("tooLarge");
    expect(r.notes.map((n) => n.code)).toEqual(["beltDataTooLarge"]);
    expect(r.findings[0].rootCause.cappedBy).toBeUndefined();
  });

  it("an empty edge list is a stale graph, not a crash", () => {
    const r = run([P, M], []);
    expect(r.beltData).toBe("stale");
    expect(r.findings).toHaveLength(1);
  });

  it("no machines at all", () => {
    expect(run([], [])).toMatchObject({ findings: [], truncated: false, beltData: "present" });
  });
});

describe("ranking and limit", () => {
  const lone = (i: number, lost: number) =>
    machine(`M${String(i).padStart(2, "0")}`, { state: "underfed", ing: [[`Item${i}_C`, 10]], out: [[`Out${i}_C`, lost]], current: 0 });

  it("defaults to the top 10 and says when there are more", () => {
    const ms = Array.from({ length: 12 }, (_, i) => lone(i, 100));
    const r = run(ms, "unsupported");
    expect(r.findings).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("honours a limit, clamps it to 1..50, and truncated is false when everything fits", () => {
    const ms = Array.from({ length: 12 }, (_, i) => lone(i, 100));
    expect(run(ms, "unsupported", 3).findings).toHaveLength(3);
    expect(run(ms, "unsupported", 0).findings).toHaveLength(1);
    const all = run(ms, "unsupported", 500);
    expect(all.findings).toHaveLength(12);
    expect(all.truncated).toBe(false);
  });

  it("orders by shared cause, then lost output, then building id", () => {
    const share = (id: string) => machine(id, { state: "underfed", ing: [[PLATE, 10]], out: [[`O${id}`, 10]] });
    const ms = [
      lone(1, 50),
      lone(2, 500),
      lone(3, 500),
      share("S1"),
      share("S2"),
    ];
    const r = run(ms, "unsupported");
    // S1 and S2 share a noProducer of Plate: one finding (#592); then the two 500s (id order), then the 50.
    expect(r.findings.map((f) => f.buildingId)).toEqual(["S1", "M02", "M03", "M01"]);
    expect(r.findings[0].affected?.map((a) => a.buildingId)).toEqual(["S1", "S2"]);
  });

  it("is deterministic: input order does not change the output", () => {
    const consumers = Array.from({ length: 6 }, (_, i) => machine(`C${i}`, { state: "underfed", ing: [[WIRE, 30]] }));
    const maker = machine("P", { out: [[WIRE, 600]], current: 600 });
    const edges = [edge("a0", "P", "S1", { cap: 120 }), ...consumers.map((c) => edge(`b${c.id}`, "S1", c.id)), edge("z", "S1", "S2", { cap: 5 })];
    const ms = [maker, ...consumers];
    const a = run(ms, edges);
    const b = run([...ms].reverse(), [...edges].reverse());
    expect(b).toEqual(a);
  });
});

describe("a generated 10x factory", () => {
  // 338 clusters of 10 machines (3,380 buildings): a plate maker, a splitter, and nine consumers, each with a Mk.1 or
  // Mk.5 feed and an output belt to storage; every third consumer is underfed and a few are backed up. About 6,400
  // edges, 40 item types so each item has about 8 producers (the whole-graph shared-cut Dinic runs once per item).
  function generate(): { buildings: FactoryBuilding[]; edges: ConveyorEdge[] } {
    const buildings: FactoryBuilding[] = [];
    const edges: ConveyorEdge[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 338; k++) {
      const item = `Item${k % 40}_C`;
      buildings.push(machine(`P${k}`, { out: [[item, 270]], current: 270 }));
      edges.push(edge(`pe${k}`, `P${k}`, `S${k}`, { cap: 780 }));
      for (let i = 0; i < 9; i++) {
        const id = `C${k}_${i}`;
        const state = i % 3 === 0 ? "underfed" : rnd() < 0.05 ? "backedUp" : "producing";
        buildings.push(machine(id, { state, ing: [[item, 30]], out: [[`Out${k % 40}_C`, 30]], current: 10 }));
        edges.push(edge(`se${k}_${i}`, `S${k}`, id, { cap: i % 2 === 0 ? 60 : 780 }));
        edges.push(edge(`oe${k}_${i}`, id, `T${k}`, { toKind: "storage" }));
      }
    }
    return { buildings, edges };
  }

  it("finishes inside a generous time bound with a valid, truncated result", () => {
    const { buildings, edges } = generate();
    expect(buildings).toHaveLength(3380);
    const start = performance.now();
    const r = run(buildings, edges);
    const ms = performance.now() - start;
    // Measured about 50 ms on the dev PC (finder plus contract parse); the bound is 100x that so a slow CI runner never flakes.
    expect(ms).toBeLessThan(5000);
    expect(r.findings).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(r.beltData).toBe("present");
  });
});

describe("fresh-eyes findings", () => {
  const stuck = (id: string, extra: MachineOptions = {}) => machine(id, { state: "underfed", ing: [[PLATE, 60]], ...extra });

  it("a NaN limit falls back to the default instead of returning nothing", () => {
    const r = run([stuck("M")], "unsupported", Number.NaN);
    expect(r.findings).toHaveLength(1);
  });

  it("text truncation never leaves half of a surrogate pair", () => {
    const r = run([stuck("M", { name: `${"x".repeat(498)}😀` })], "unsupported");
    expect(r.findings[0].text.length).toBeLessThanOrEqual(500);
    expect(r.findings[0].text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("ranking does not depend on the order of a machine's rates when the main products tie", () => {
    const twoOut = (order: 0 | 1) => {
      const m = machine("A", { state: "underfed", ing: [[PLATE, 10]] });
      const a = rate("OutA_C", 100, 0);
      const b = rate("OutB_C", 100, 90);
      m.production = order === 0 ? [a, b] : [b, a];
      return m;
    };
    const other = machine("B", { state: "underfed", ing: [[PLATE, 10]], out: [["OutC_C", 100]], current: 50 });
    const first = run([twoOut(0), other], "unsupported");
    const second = run([twoOut(1), other], "unsupported");
    expect(second.findings.map((f) => f.buildingId)).toEqual(first.findings.map((f) => f.buildingId));
  });

  it("a very long chain of directly joined belts does not overflow the stack", () => {
    const n = 30000;
    const edges: ConveyorEdge[] = [];
    for (let i = 0; i < n; i++) {
      const from = i === 0 ? "P" : `b${String(i - 1).padStart(6, "0")}`;
      const to = i === n - 1 ? "M" : `b${String(i + 1).padStart(6, "0")}`;
      edges.push(
        edge(`b${String(i).padStart(6, "0")}`, from, to, {
          cap: i === 10 ? 30 : 780,
          fromKind: i === 0 ? "machine" : "conveyor",
          toKind: i === n - 1 ? "machine" : "conveyor",
        }),
      );
    }
    const r = run([producer(120), stuck("M", { state: "underfed" })], edges);
    expect(r.findings[0].rootCause.cappedBy?.conveyorId).toBe("b000010");
  });

  it("one big manifold (200 producers, 1 belt, 1500 starved consumers) stays fast", () => {
    const buildings: FactoryBuilding[] = [];
    const edges: ConveyorEdge[] = [];
    for (let p = 0; p < 200; p++) {
      buildings.push(machine(`P${p}`, { out: [[PLATE, 60]], current: 60 }));
      edges.push(edge(`pe${p}`, `P${p}`, "Smerge", { cap: 60 }));
    }
    edges.push(edge("trunk", "Smerge", "Sroot", { cap: 780 }));
    for (let c = 0; c < 1500; c++) {
      const id = `C${String(c).padStart(4, "0")}`;
      buildings.push(stuck(id, { ing: [[PLATE, 30]] }));
      edges.push(edge(`ce${id}`, "Sroot", id, { cap: 780 }));
    }
    const start = performance.now();
    const r = run(buildings, edges);
    expect(performance.now() - start).toBeLessThan(5000);
    // One cause (the trunk), so one finding (#592), listing the first 50 of its 1500 machines.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].affectedCount).toBe(1500);
    expect(r.findings[0].affected).toHaveLength(50);
    expect(r.truncated).toBe(false);
  });
});

describe("wrong-answer fixes", () => {
  it("only an unread source and no producer anywhere: the text does not claim the item is made", () => {
    const m = machine("M", { state: "underfed", ing: [[PLATE, 60]] });
    const r = run([m], [edge("e1", "X1", "M", { fromKind: "extractor" })]);
    expect(r.findings[0].rootCause.kind).toBe("logistics");
    expect(r.findings[0].text).not.toContain("is made");
    expect(r.findings[0].text).toContain("fed only from storage, a station or an extractor whose contents are not read");
  });

  it("an unread source plus a producer elsewhere keeps the 'enough is made' text", () => {
    const m = machine("M", { state: "underfed", ing: [[PLATE, 60]] });
    const r = run([m, producer(120)], [edge("e1", "X1", "M", { fromKind: "extractor" })]);
    const f = r.findings.find((x) => x.buildingId === "M");
    expect(f?.text).toContain("enough Desc_IronPlate_C is made");
  });

  it("the same item at two different buildings in a chain is not a loop", () => {
    // A needs X from B, B needs Y from C, C needs X from D (starved of ore).
    // A loses the most output, so it represents the shared cause.
    const A = machine("A", { state: "underfed", ing: [["X_C", 60]], out: [["Big_C", 1000]] });
    const B = machine("B", { state: "underfed", ing: [["Y_C", 60]], out: [["X_C", 60]] });
    const C = machine("C", { state: "underfed", ing: [["X_C", 60]], out: [["Y_C", 60]] });
    const D = machine("D", { state: "unpowered", out: [["X_C", 60]] });
    const a = run([A, B, C, D], "unsupported").findings.find((f) => f.buildingId === "A");
    expect(a?.chain.some((s) => s.kind === "loop")).toBe(false);
    expect(a?.rootCause.kind).toBe("unpowered");
  });
});

describe("grouping and fix: contract and determinism (fresh eyes, #592)", () => {
  const X = "Desc_X_C";
  const at = (xM: number, yM: number) => ({ xM, yM, zM: 0, rotationDeg: 0 });
  const consumer = (id: string, extra: Partial<FactoryBuilding> = {}): FactoryBuilding => ({
    ...machine(id, { state: "underfed", ing: [[X, 100]], out: [["Out_C", 10]] }),
    ...extra,
  });
  const maker = (id: string, extra: Partial<FactoryBuilding> = {}): FactoryBuilding => ({ ...machine(id, { out: [[X, 30]], current: 30 }), ...extra });

  it("coordinates outside the contract's whole-metre bounds, or not finite, never break the response", () => {
    const b = [
      maker("P"),
      consumer("A", { location: at(5_000_000, -5_000_000) }),
      consumer("B", { location: at(Number.POSITIVE_INFINITY, 1) }),
      consumer("C", { location: at(-0.4, -0.5) }),
    ];
    const r = run(b, "unsupported");
    expect(r.findings[0].affectedCount).toBe(3);
  });

  it("long names and recipes stay inside the schema's 200 characters, in affected and in fix", () => {
    const long = "x".repeat(500);
    const b = [maker("P", { name: long, recipe: long }), consumer("A", { name: long, recipe: long })];
    const r = run(b, "unsupported");
    expect(r.findings[0].fix?.producerName).toHaveLength(200);
  });

  it("a producer with a tiny rate or tiny clock yields a positive, in-bounds fix", () => {
    for (const [max, clock] of [[0.001, 100], [30, 1e-8], [30, 1e6], [1e-6, 250]] as const) {
      const b = [maker("P", { production: [rate(X, max, max)], clockSpeedPercent: clock }), consumer("A")];
      const f = run(b, "unsupported").findings[0];
      expect(f.fix?.perMachinePerMinute).toBeGreaterThan(0);
      expect(f.fix?.machines).toBeGreaterThanOrEqual(1);
      expect(f.fix?.machines).toBeLessThanOrEqual(100_000);
    }
  });

  it("clock 0, negative or undefined falls back to the rated rate; a zero-max producer is not the fix", () => {
    const zero = maker("Z", { production: [rate(X, 0, 0)], name: "Zeroer" });
    for (const clock of [0, -50, undefined]) {
      const f = run([maker("P", { clockSpeedPercent: clock }), zero, consumer("A")], "unsupported").findings[0];
      expect(f.fix).toMatchObject({ producerName: "Machine P", perMachinePerMinute: 30 });
    }
  });

  it("input order changes nothing: groups, affected order, representative and fix tie-breaks", () => {
    const b = [
      maker("P1", { name: "Beta", recipe: "R2" }),
      maker("P2", { name: "Alpha", recipe: "R1", production: [rate(X, 45, 45)] }),
      consumer("A", { location: at(1, 2) }),
      consumer("B"),
      consumer("C"),
      { ...machine("D", { state: "underfed", ing: [["Y_C", 5]], out: [["Out_C", 10]] }) },
    ];
    const base = JSON.stringify(run(b, "unsupported"));
    const orders = [[...b].reverse(), [b[3], b[0], b[5], b[1], b[4], b[2]]];
    for (const o of orders) expect(JSON.stringify(run(o, "unsupported"))).toBe(base);
    // One of each is "most common": the lower (name, recipe) key wins.
    expect(JSON.parse(base).findings.find((f: { fix?: unknown }) => f.fix).fix.producerName).toBe("Alpha");
  });

  it("truncated is true only when there are more causes than the limit, and the groups are distinct causes", () => {
    const b: FactoryBuilding[] = [];
    for (let i = 0; i < 3; i++) b.push(machine(`M${i}`, { state: "underfed", ing: [[`Item${i}_C`, 10]] }));
    expect(run(b, "unsupported", 3)).toMatchObject({ truncated: false });
    const r = run(b, "unsupported", 2);
    expect(r.truncated).toBe(true);
    expect(new Set(r.findings.map((f) => f.rootCause.itemClassName)).size).toBe(2);
  });

  it("affected is capped at 50 while affectedCount counts all", () => {
    const b = [maker("P"), ...Array.from({ length: 60 }, (_, i) => consumer(`C${String(i).padStart(2, "0")}`))];
    const f = run(b, "unsupported").findings[0];
    expect(f.affectedCount).toBe(60);
    expect(f.affected).toHaveLength(50);
  });
});
