import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  CONVEYORS_MAX_EDGES,
  ConveyorEdgeSchema,
  ConveyorsLayerDataSchema,
  ConveyorsWorldIngestRequestSchema,
  ConveyorsWorldLayerResponseSchema,
  KNOWN_MAP_WORLD_LAYERS,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MAP_WORLD_LAYER_INGEST_SCHEMAS,
  MAP_WORLD_LAYER_ITEM_SCHEMAS,
  MAP_WORLD_LAYER_MAX_ITEMS,
  MAP_WORLD_MAX_ITEMS,
  MapWorldLayerResponseSchema,
} from "../src/index";
import type { ConveyorEdge } from "../src/index";

// ADR-0048 amendment, Decision 4: the conveyors world layer.
const belt: ConveyorEdge = fixtures.conveyorsSample.data.find((e) => e.id === "Build_ConveyorBeltMk1_C_2146995466")!;
const pipe: ConveyorEdge = fixtures.conveyorsSample.data.find((e) => e.id === "Build_Pipeline_C_2147376300")!;

describe("conveyors layer: registration", () => {
  it("is a known world layer, in every per-layer table", () => {
    expect(KNOWN_MAP_WORLD_LAYERS).toContain("conveyors");
    expect(MAP_WORLD_LAYER_DATA_SCHEMAS.conveyors).toBe(ConveyorsLayerDataSchema);
    expect(MAP_WORLD_LAYER_ITEM_SCHEMAS.conveyors).toBe(ConveyorEdgeSchema);
    expect(MAP_WORLD_LAYER_INGEST_SCHEMAS.conveyors).toBe(ConveyorsWorldIngestRequestSchema);
    for (const table of [MAP_WORLD_LAYER_DATA_SCHEMAS, MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_INGEST_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS]) {
      expect(Object.keys(table).sort()).toEqual([...KNOWN_MAP_WORLD_LAYERS].sort());
    }
  });

  it("has its own 50,000-edge cap; the other layers keep the shared 5,000", () => {
    expect(CONVEYORS_MAX_EDGES).toBe(50_000);
    expect(MAP_WORLD_LAYER_MAX_ITEMS).toEqual({ rails: MAP_WORLD_MAX_ITEMS, resourceNodes: MAP_WORLD_MAX_ITEMS, conveyors: CONVEYORS_MAX_EDGES });
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...belt, id: `belt-${String(i).padStart(6, "0")}` }));
    expect(ConveyorsLayerDataSchema.safeParse(many(MAP_WORLD_MAX_ITEMS + 1)).success).toBe(true);
    expect(ConveyorsLayerDataSchema.safeParse(many(CONVEYORS_MAX_EDGES)).success).toBe(true);
    expect(ConveyorsLayerDataSchema.safeParse(many(CONVEYORS_MAX_EDGES + 1)).success).toBe(false);
  });

  it("the world-layer GET's union accepts a conveyors response", () => {
    expect(MapWorldLayerResponseSchema.parse(fixtures.conveyorsWorldResponse)).toEqual(fixtures.conveyorsWorldResponse);
    expect(ConveyorsWorldLayerResponseSchema.parse(fixtures.conveyorsWorldResponseEmpty).count).toBe(0);
  });

  it("the ingest body is strict: the sender never asserts a hash (the backend hashes on change, ADR-0038)", () => {
    expect(ConveyorsWorldIngestRequestSchema.safeParse({ ...fixtures.conveyorsSample, hash: "x" }).success).toBe(false);
  });
});

describe("ConveyorEdgeSchema", () => {
  it("accepts a pipe without a trusted capacity (null until G-B2), and a belt with one", () => {
    expect(pipe.capacityPerMinute).toBeNull();
    expect(ConveyorEdgeSchema.safeParse(pipe).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...pipe, capacityPerMinute: 300 }).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, capacityPerMinute: null }).success).toBe(true);
  });

  it("rejects a negative or non-finite capacity, and a capacity left out (null, not missing)", () => {
    expect(ConveyorEdgeSchema.safeParse({ ...belt, capacityPerMinute: -1 }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, capacityPerMinute: Number.POSITIVE_INFINITY }).success).toBe(false);
    const { capacityPerMinute: _omit, ...missing } = belt;
    expect(ConveyorEdgeSchema.safeParse(missing).success).toBe(false);
  });

  it("an open end is null on both its id and its kind, never one without the other", () => {
    expect(ConveyorEdgeSchema.safeParse({ ...belt, to: null, toKind: null }).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, from: null, fromKind: null, to: null, toKind: null }).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, to: null }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, fromKind: null }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, from: "" }).success).toBe(false);
  });

  it("bounds ids at 128 and the tier at 64 characters, and takes only the three conveyor kinds", () => {
    expect(ConveyorEdgeSchema.safeParse({ ...belt, id: "x".repeat(128) }).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, id: "x".repeat(129) }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, to: "x".repeat(129) }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, tier: "x".repeat(65) }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, kind: "hypertube" }).success).toBe(false);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, toKind: "other" }).success).toBe(true);
    expect(ConveyorEdgeSchema.safeParse({ ...belt, toKind: "factory" }).success).toBe(false);
  });

  it("`at` is whole metres", () => {
    expect(ConveyorEdgeSchema.safeParse({ ...belt, at: { x: -553.8, y: -1278 } }).success).toBe(false);
  });
});

describe("conveyorsSample, checked against the 2026-10-21 captures' measured facts", () => {
  const data = fixtures.conveyorsSample.data;

  it("is sorted by id (the projection's stable-hash rule) with no duplicate", () => {
    const ids = data.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the 7 belts, 2 lifts and 2 pipes of the trimmed captures", () => {
    expect(data.filter((e) => e.kind === "belt")).toHaveLength(7);
    expect(data.filter((e) => e.kind === "lift")).toHaveLength(2);
    expect(data.filter((e) => e.kind === "pipe")).toHaveLength(2);
  });

  it("every belt and lift carries its tier's speed (60/120/270/480), every pipe a null capacity", () => {
    const tierSpeed: Record<string, number> = { "Mk.1": 60, "Mk.2": 120, "Mk.3": 270, "Mk.4": 480 };
    for (const edge of data) {
      if (edge.kind === "pipe") {
        expect(edge.capacityPerMinute, edge.id).toBeNull();
      } else {
        expect(edge.capacityPerMinute, edge.id).toBe(tierSpeed[edge.tier.slice(-4)]);
      }
    }
  });

  it("the belt-to-belt join names each other end 1 to end 0", () => {
    const first = data.find((e) => e.id === "Build_ConveyorBeltMk1_C_2146979166")!;
    const second = data.find((e) => e.id === "Build_ConveyorBeltMk1_C_2146977182")!;
    expect(first.to).toBe(second.id);
    expect(second.from).toBe(first.id);
  });
});
