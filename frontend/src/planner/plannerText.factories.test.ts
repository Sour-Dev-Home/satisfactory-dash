import { describe, expect, it } from "vitest";
import {
  aggregateRateText,
  bubbleTitle,
  carrierText,
  carrierWord,
  destinationChipText,
  destinationPhrase,
  distanceText,
  edgeRateText,
  factorySitesText,
  factoryTitle,
  flowText,
  foldText,
  itemFromText,
  rateText,
  remoteText,
  roleText,
  shareText,
} from "./plannerText";

describe("flowText (ADR-0053 Decision 1, ADR-0055 Decision 3)", () => {
  it("says supply plainly, and excess and output with where they end", () => {
    expect(flowText("supply", "factory")).toBe("Supply");
    expect(flowText("excess", "sink")).toBe("Excess to the AWESOME Sink");
    expect(flowText("output", "storage")).toBe("Output to storage");
    expect(flowText("output", "depot")).toBe("Output to the Dimensional Depot");
    expect(flowText("output", "power")).toBe("Output to power");
    expect(flowText("output", "export")).toBe("Output to a station whose route is not read");
    expect(flowText("output", "unknown")).toBe("Output to an unknown end");
  });

  it("drops the destination when the flow goes on to a machine group or does not say", () => {
    expect(flowText("excess", undefined)).toBe("Excess");
    expect(flowText("output", "factory")).toBe("Output");
    expect(flowText("output", "machine")).toBe("Output");
  });

  it("keeps a value it does not know, as text", () => {
    expect(flowText("overflow", "bin")).toBe("overflow to bin");
    expect(destinationPhrase("constructor")).toBe("constructor");
    expect(destinationPhrase("__proto__")).toBe("__proto__");
  });
});

describe("carriers", () => {
  it("names belts, pipes and transport modes, and keeps an unknown mode's word", () => {
    expect(["belt", "pipe", "train", "truck", "drone", "depot", "hyperloop"].map(carrierWord)).toEqual([
      "Belt",
      "Pipe",
      "Train",
      "Truck",
      "Drone",
      "Depot",
      "hyperloop",
    ]);
    expect(carrierWord("toString")).toBe("toString");
  });

  it("adds the route and the number of carriers for a transport", () => {
    expect(carrierText({ carrier: "belt", routeName: null, carriers: null })).toBe("Belt");
    expect(carrierText({ carrier: "train", routeName: "Ore Run", carriers: 2 })).toBe("Train: Ore Run (2 trains)");
    expect(carrierText({ carrier: "train", routeName: "Ore Run", carriers: 1 })).toBe("Train: Ore Run");
    expect(carrierText({ carrier: "drone", routeName: null, carriers: 3 })).toBe("Drone (3 drones)");
    expect(carrierText({ carrier: "depot", routeName: "", carriers: 4 })).toBe("Depot");
  });
});

describe("rates", () => {
  it("writes measured plain, estimated with about, unknown with no number", () => {
    expect(rateText("measured", 12, "items/min")).toBe("12 items/min");
    expect(rateText("estimated", 12, "m3/min")).toBe("about 12 m³/min");
    expect(rateText("unknown", 12, "items/min")).toBe("unknown");
    expect(rateText("measured", null, "items/min")).toBe("unknown");
    expect(edgeRateText({ kind: "belt", rate: "estimated", ratePerMinute: 3 })).toBe("about 3 items/min");
  });

  it("adds at least for a sum with an unknown part", () => {
    const base = { unit: "items/min" as const, ratePerMinute: 10 };
    expect(aggregateRateText({ ...base, quality: "measured" })).toBe("10 items/min");
    expect(aggregateRateText({ ...base, quality: "estimated" })).toBe("about 10 items/min");
    expect(aggregateRateText({ ...base, quality: "atLeast" })).toBe("at least 10 items/min");
    expect(aggregateRateText({ ...base, quality: "unknown" })).toBe("unknown");
    expect(aggregateRateText({ unit: "items/min", ratePerMinute: null, quality: "atLeast" })).toBe("unknown");
  });
});

describe("itemFromText and roleText", () => {
  it("says how an item was inferred, nothing for a named one, and the raw word for a new value", () => {
    expect(itemFromText(undefined)).toBeNull();
    expect(itemFromText("resourceNode")).toBe("inferred from the resource node");
    expect(itemFromText("upstream")).toBe("inferred from what feeds it");
    expect(itemFromText("downstream")).toBe("inferred from what it feeds");
    expect(itemFromText("recipe")).toBe("inferred from the recipes at both ends");
    expect(itemFromText("guess")).toBe("inferred (guess)");
  });

  it("words the known roles and keeps a new one", () => {
    expect(roleText(undefined)).toBeNull();
    expect(["buffer", "storage", "depot", "sink", "power", "export"].map(roleText)).toEqual([
      "Buffer",
      "Storage",
      "Dimensional Depot",
      "AWESOME Sink",
      "Power",
      "Station, route not read",
    ]);
    expect(roleText("hub")).toBe("hub");
  });
});

describe("factory words", () => {
  it("shows side products in the title as ADR-0055 Decision 4 does", () => {
    expect(factoryTitle({ name: "Iron Plate factory", sideProducts: [] })).toBe("Iron Plate factory");
    expect(factoryTitle({ name: "Iron Plate factory", sideProducts: ["Iron Rod", "Screw"] })).toBe("Iron Plate factory (+ Iron Rod, Screw)");
  });

  it("says where a factory stands", () => {
    const site = { key: "s", name: "Main base", at: { x: 0, y: 0 }, machineCount: 1, stateCounts: {}, topOutputs: [], nodeKeys: [] };
    expect(factorySitesText({ home: site, remoteSites: [] })).toBe("Main base");
    expect(factorySitesText({ home: site, remoteSites: [site, site] })).toBe("Main base + 2 remote");
    expect(factorySitesText({ home: null, remoteSites: [] })).toBe("No site listed");
  });

  it("makes destination chips and keeps an unknown destination", () => {
    expect(destinationChipText("storage", 3)).toBe("to storage: 3");
    expect(destinationChipText("depot", 1)).toBe("to the Depot: 1");
    expect(destinationChipText("sink", 2)).toBe("to the Sink: 2");
    expect(destinationChipText("export", 1)).toBe("leaving by station: 1");
    expect(destinationChipText("bin", 1)).toBe("to bin: 1");
  });

  it("writes distances in metres under a kilometre and kilometres above", () => {
    expect([0, 850, 999, 1000, 1840, 12_345].map(distanceText)).toEqual(["0 m", "850 m", "999 m", "1 km", "1.8 km", "12.3 km"]);
  });

  it("describes a remote group by place, distance and mode", () => {
    expect(remoteText({ siteName: "Ore farm", distanceM: 1840, modes: ["train"] })).toBe("Ore farm, 1.8 km, by train");
    expect(remoteText({ siteName: "Ore farm", distanceM: 300, modes: ["drone", "train"] })).toBe("Ore farm, 300 m, by drone and train");
    expect(remoteText({ siteName: "Ore farm", distanceM: null, modes: [] })).toBe("Ore farm");
  });

  it("writes a split as here, the other factories by name and the rest", () => {
    const names = new Map([["g", "Computer factory"]]);
    expect(shareText({ here: 75, others: [{ factoryKey: "g", percent: 25 }], rest: 0 }, names)).toBe("75% here, 25% Computer factory");
    expect(shareText({ here: null, others: [{ factoryKey: "x", percent: 20 }], rest: 5 }, names)).toBe("20% another factory, 5% other");
  });
});

describe("bubble words", () => {
  const node = (over: object = {}) => ({ name: "Constructor", recipe: "Iron Plate", resource: null, ...over });

  it("titles a bubble with its machines and recipe, and its tree only when the recipe has several", () => {
    expect(bubbleTitle({ nodes: [node()] as never, ordinal: 1, of: 1, machineCount: 12 })).toBe("12× Constructor, Iron Plate");
    expect(bubbleTitle({ nodes: [node()] as never, ordinal: 2, of: 3, machineCount: 4 })).toBe("4× Constructor, Iron Plate, tree 2 of 3");
  });

  it("falls back to the mined item, then to the building alone, for a bubble with no recipe", () => {
    const miner = { name: "Miner Mk.2", recipe: null, resource: { className: "Desc_OreIron_C", name: "Iron Ore" } };
    expect(bubbleTitle({ nodes: [node(miner)] as never, ordinal: 1, of: 1, machineCount: 2 })).toBe("2× Miner Mk.2, Iron Ore");
    expect(bubbleTitle({ nodes: [node({ name: "Storage Container", recipe: null })] as never, ordinal: 1, of: 1, machineCount: 1 })).toBe(
      "1× Storage Container",
    );
  });

  it("labels a fold by its trees' recipe, singular for one", () => {
    const entry = (n: number) => ({ type: "fold" as const, key: "fold", bubbles: Array.from({ length: n }, () => ({ nodes: [node({ recipe: "Iron Ingot" })] })) as never });
    expect(foldText(entry(3))).toBe("3 more Iron Ingot trees");
    expect(foldText(entry(1))).toBe("1 more Iron Ingot tree");
  });
});
