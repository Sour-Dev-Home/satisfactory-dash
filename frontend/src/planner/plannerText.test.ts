import { describe, expect, it } from "vitest";
import { ProductionGraphSchema, type ProductionGraph } from "@satisfactory-dash/shared";
import { bottlenecksBeltLevel, productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import {
  bottleneckCountText,
  edgeCapacityText,
  edgeItemText,
  edgeRateText,
  findingsFor,
  groupLabel,
  outputLine,
  plannerNotes,
  siteEdges,
  siteNodes,
  stateCountsText,
  unconnectedText,
} from "./plannerText";

// Parsed, so the fixture takes the contract type (its literal type has optional-undefined state counts).
const graph: ProductionGraph = ProductionGraphSchema.parse(productionGraphTwoSites.data);
const finding = bottlenecksBeltLevel.data.findings[0];

describe("edgeRateText", () => {
  it("says a measured rate plainly", () => {
    expect(edgeRateText({ kind: "belt", rate: "measured", ratePerMinute: 120 })).toBe("120 items/min");
  });
  it("says an estimated rate with 'about'", () => {
    expect(edgeRateText({ kind: "belt", rate: "estimated", ratePerMinute: 102.2 })).toBe("about 102.2 items/min");
  });
  it("gives an unknown rate no number, even when the backend sent one", () => {
    expect(edgeRateText({ kind: "belt", rate: "unknown", ratePerMinute: null })).toBe("unknown");
    expect(edgeRateText({ kind: "belt", rate: "unknown", ratePerMinute: 5 })).toBe("unknown");
    expect(edgeRateText({ kind: "belt", rate: "measured", ratePerMinute: null })).toBe("unknown");
  });
  it("uses m³/min for a pipe", () => {
    expect(edgeRateText({ kind: "pipe", rate: "estimated", ratePerMinute: 30 })).toBe("about 30 m³/min");
  });
});

describe("edge and group wording", () => {
  it("marks a mixed belt and an item that could not be inferred", () => {
    expect(edgeItemText({ itemName: "Iron Plate", itemClassName: "Desc_IronPlate_C", mixed: true })).toBe("Iron Plate (mixed belt)");
    expect(edgeItemText({ itemName: null, itemClassName: null, mixed: false })).toBe("Item not inferred");
  });
  it("shows capacity only when the backend sent one", () => {
    expect(edgeCapacityText({ kind: "belt", capacityPerMinute: 270 })).toBe("270 items/min");
    expect(edgeCapacityText({ kind: "belt", capacityPerMinute: null })).toBeNull();
  });
  it("names a group with its count and recipe", () => {
    expect(groupLabel({ name: "Constructor", count: 8, recipe: "Iron Plate" })).toBe("8× Constructor, Iron Plate");
    expect(groupLabel({ name: "Storage Container", count: 1, recipe: null })).toBe("Storage Container");
  });
  it("shows actual over max and counts states, keeping a state it does not know", () => {
    expect(outputLine(graph.nodes[2].products[0])).toBe("Iron Plate: 72 / 160 items/min");
    expect(stateCountsText({ producing: 6, underfed: 2, idle: 0, newState: 1 })).toBe("6 Producing, 2 Underfed, 1 newState");
    expect(stateCountsText({})).toBe("No machine states");
  });
});

describe("the bottleneck join", () => {
  it("matches by the representative machine or any affected machine, and not otherwise", () => {
    const rep = { ...finding, buildingId: "Build_SmelterMk1_C_2", affected: undefined };
    expect(findingsFor(["Build_SmelterMk1_C_2"], [rep])).toHaveLength(1);
    expect(findingsFor(["Build_SmelterMk1_C_1"], [rep])).toHaveLength(0);
    const listed = {
      ...finding,
      buildingId: "elsewhere",
      affected: [{ buildingId: "Build_SmelterMk1_C_3", buildingName: "Smelter", recipe: null }],
    };
    expect(findingsFor(["Build_SmelterMk1_C_3"], [listed])).toHaveLength(1);
  });
  it("is empty without a read", () => {
    expect(findingsFor(["x"], undefined)).toEqual([]);
  });
  it("counts in words", () => {
    expect([0, 1, 3].map(bottleneckCountText)).toEqual(["No bottlenecks", "1 bottleneck", "3 bottlenecks"]);
  });
});

describe("a site's nodes and edges", () => {
  it("lists the site's nodes and the edges that touch them", () => {
    const nodes = siteNodes(graph, graph.sites[1]);
    expect(nodes.map((n) => n.name)).toEqual(["Miner Mk.1", "Smelter"]);
    expect(siteEdges(graph, nodes)).toHaveLength(1);
  });
  it("skips a node key nothing answers to", () => {
    expect(siteNodes(graph, { ...graph.sites[1], nodeKeys: ["gone"] })).toEqual([]);
  });
});

describe("notes", () => {
  it("says how many machines are on no conveyor", () => {
    expect(unconnectedText(0)).toBeNull();
    expect(unconnectedText(1)).toBe("1 machine is on no conveyor the last read knew of, so it is in no group.");
    expect(unconnectedText(2)).toMatch(/^2 machines are on no conveyor/);
  });
  it("puts the unconnected line before the finder's notes, for each belt-data mode", () => {
    expect(plannerNotes(graph)).toEqual([
      "1 machine is on no conveyor the last read knew of, so it is in no group.",
      "Connections refresh every 10 minutes.",
    ]);
    const old = plannerNotes({ ...graph, unconnectedMachineIds: [], beltData: "unsupported", notes: [] });
    expect(old).toEqual(["Item-level results only. Update FRM to 1.5.4 or newer for belt detail."]);
    const big = plannerNotes({ ...graph, unconnectedMachineIds: [], beltData: "tooLarge", notes: [] });
    expect(big).toEqual(["Item-level results only: this factory's connection data is too large to read."]);
  });
});
