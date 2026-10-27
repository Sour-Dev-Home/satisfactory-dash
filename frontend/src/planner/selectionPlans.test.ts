import { describe, expect, it } from "vitest";
import { PLANNER_MAX_MACHINE_IDS, ProductionGraphResponseSchema, type PlannerDesignation, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import type { Place } from "./designationMatch";
import { NEEDS_NEWER_BACKEND, TOO_FEW_TO_MERGE } from "./designationOps";
import { NOT_CONNECTED_TEXT } from "./designationText";
import { factoryModels } from "./graph/hierarchy";
import { mergeSources, splitMachines, splitPartsNote } from "./selectionPlans";

const base = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
// Every group lists all its machines, so each can be found again by id.
const graph: ProductionGraph = { ...base, nodes: base.nodes.map((n) => ({ ...n, machineIds: Array.from({ length: n.count }, (_, i) => `${n.key}#${i}`) })) };
const places = new Map<string, Place>(graph.nodes.flatMap((n, j) => n.machineIds.map((id, i) => [id, { c: n.className, x: j * 100 + i, y: 0, mx: j * 100 + i, my: 0 }] as const)));
const ID = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";

describe("mergeSources", () => {
  const models = factoryModels(graph);

  it("takes two connected automatic factories as suggestions, each with its machines", () => {
    const result = mergeSources(graph, models, [], places);
    if (!result.ok) throw new Error(result.reason);
    expect(result.designations).toEqual([]);
    expect(result.suggested).toHaveLength(2);
    expect(result.suggested[0]!.length).toBeGreaterThan(0);
    expect(result.names.map((n) => n.name)).toEqual(models.map((m) => m.factory.name));
  });

  it("uses the stored designation for a designated factory", () => {
    const designated = { ...graph, factories: graph.factories!.map((f, i) => (i === 1 ? { ...f, designationId: ID } : f)) };
    const stored: PlannerDesignation = {
      id: ID,
      name: "Rods",
      mode: "core",
      members: [{ id: "x", c: "C", x: 0, y: 0 }],
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
      revision: 3,
    };
    const result = mergeSources(designated, factoryModels(designated), [stored], places);
    if (!result.ok) throw new Error(result.reason);
    expect(result.designations).toEqual([stored]);
    expect(result.suggested).toHaveLength(1);
    expect(mergeSources(designated, factoryModels(designated), [{ ...stored, revision: undefined }], places)).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
    expect(mergeSources(designated, factoryModels(designated), undefined, places).ok).toBe(false);
    expect(mergeSources(designated, factoryModels(designated), [], places)).toMatchObject({ ok: false, reason: expect.stringMatching(/no longer designated/) });
  });

  it("refuses one factory, and factories with nothing between them", () => {
    expect(mergeSources(graph, models.slice(0, 1), [], places)).toEqual({ ok: false, reason: TOO_FEW_TO_MERGE });
    const apart: ProductionGraph = { ...graph, edges: [], transports: [], nodes: graph.nodes.map((n) => ({ ...n, shares: undefined })) };
    expect(mergeSources(apart, factoryModels(apart), [], places)).toEqual({ ok: false, reason: NOT_CONNECTED_TEXT });
  });

  it("merges a suggested factory whose storage container end has no Factory-read building (count above its listed ids)", () => {
    // The backend counts every conveyor end in `count` but lists an id only for an end a Factory-read building matches.
    const bare: ProductionGraph = { ...graph, nodes: graph.nodes.map((n) => (n.kind === "storage" ? { ...n, count: 1, machineIds: [] } : n)) };
    expect(bare.nodes.some((n) => n.kind === "storage")).toBe(true);
    const result = mergeSources(bare, factoryModels(bare), [], places);
    if (!result.ok) throw new Error(result.reason);
    expect(result.suggested.flat().some((m) => m.id?.startsWith("Build_StorageContainer"))).toBe(false);
  });

  it("still refuses a group whose ids the graph cut at the cap", () => {
    const at = graph.nodes.findIndex((n) => n.kind === "machines");
    const ids = Array.from({ length: PLANNER_MAX_MACHINE_IDS }, (_, i) => `big#${i}`);
    const big: ProductionGraph = { ...graph, nodes: graph.nodes.map((n, i) => (i === at ? { ...n, count: PLANNER_MAX_MACHINE_IDS + 1, machineIds: ids } : n)) };
    expect(mergeSources(big, factoryModels(big), [], places)).toEqual({ ok: false, reason: "These groups are too large to designate whole." });
  });

  it("waits for the machine positions of a suggestion", () => {
    expect(mergeSources(graph, models, [], undefined)).toEqual({ ok: false, reason: "Machine positions are still loading." });
  });
});

describe("splitMachines", () => {
  it("collects the picked groups' machine ids, refusing a group listed in part", () => {
    const [a, b] = graph.nodes;
    const result = splitMachines([a!, b!]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.machineIds.size).toBe(a!.count + b!.count);
    const cut = Array.from({ length: PLANNER_MAX_MACHINE_IDS }, (_, i) => `cut#${i}`);
    expect(splitMachines([{ ...a!, count: PLANNER_MAX_MACHINE_IDS + 1, machineIds: cut }]).ok).toBe(false);
    // Ends with no building (storage, a stale end) count but list no id; under the cap the group is listed whole.
    expect(splitMachines([{ ...a!, count: a!.count + 1 }]).ok).toBe(true);
    expect(splitMachines([]).ok).toBe(false);
  });
});

describe("splitPartsNote", () => {
  it("says so when a side would not be one connected piece, and nothing otherwise", () => {
    const plate = factoryModels(graph).find((m) => m.nodes.length > 2)!;
    const keys = plate.nodes.map((n) => n.key);
    const connectedPair = graph.edges.find((e) => keys.includes(e.from) && keys.includes(e.to))!;
    const lonePick = new Set([keys.find((k) => k !== connectedPair.from && k !== connectedPair.to)!]);
    expect(splitPartsNote(graph, plate, new Set(keys))).toBeNull();
    expect(typeof splitPartsNote({ ...graph, edges: [], transports: [] }, plate, lonePick)).toBe("string");
  });
});
