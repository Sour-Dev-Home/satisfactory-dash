import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as fixtures from "../fixtures/index";
import {
  KNOWN_MAP_WORLD_LAYERS,
  MAP_WORLD_LAYER_MAX_BYTES,
  MAP_WORLD_MAX_ITEMS,
  MAP_WORLD_MAX_POLYLINE_POINTS,
  MAP_LIVE_MAX_TRAINS,
  MAP_LIVE_MAX_STATIONS,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  PolylineSchema,
  RailSegmentSchema,
  RailsLayerDataSchema,
  RailsWorldIngestRequestSchema,
  RailsWorldLayerResponseSchema,
  ResourceNodeSchema,
  ResourceNodesWorldIngestRequestSchema,
  ResourceNodesWorldLayerResponseSchema,
  MapLiveSchema,
  MapTrainSchema,
  MapTrainStationSchema,
  worldLayerResponseSchema,
  SnapshotRequestSchema,
} from "../src/index";

describe("ADR-0038 M1: scope (#352)", () => {
  it("covers exactly rails and resourceNodes for now", () => {
    expect(KNOWN_MAP_WORLD_LAYERS).toEqual(["rails", "resourceNodes"]);
  });

  it("MAP_WORLD_LAYER_DATA_SCHEMAS has exactly one entry per known layer", () => {
    expect(Object.keys(MAP_WORLD_LAYER_DATA_SCHEMAS).sort()).toEqual([...KNOWN_MAP_WORLD_LAYERS].sort());
  });
});

describe("PolylineSchema (#352 addition a: one shared Polyline schema)", () => {
  it("accepts an array of [x, y] whole-metre integer pairs", () => {
    expect(PolylineSchema.safeParse([[0, 0], [10, -5]]).success).toBe(true);
  });

  it("requires at least 2 points (a line needs two ends)", () => {
    expect(PolylineSchema.safeParse([[0, 0]]).success).toBe(false);
    expect(PolylineSchema.safeParse([]).success).toBe(false);
  });

  it("rejects a non-integer or non-finite coordinate", () => {
    for (const bad of [[[0.5, 0], [1, 1]], [[Infinity, 0], [1, 1]], [[NaN, 0], [1, 1]]]) {
      expect(PolylineSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects more than MAP_WORLD_MAX_POLYLINE_POINTS points", () => {
    const tooMany = Array.from({ length: MAP_WORLD_MAX_POLYLINE_POINTS + 1 }, (_, i) => [i, 0]);
    expect(PolylineSchema.safeParse(tooMany).success).toBe(false);
    expect(PolylineSchema.safeParse(tooMany.slice(0, MAP_WORLD_MAX_POLYLINE_POINTS)).success).toBe(true);
  });

  it("rejects a point given as {x, y} instead of [x, y] (the whole point of the tuple form)", () => {
    expect(PolylineSchema.safeParse([{ x: 0, y: 0 }, { x: 1, y: 1 }]).success).toBe(false);
  });
});

describe("rails layer", () => {
  it("the sample fixture parses as an ingest request and as a response", () => {
    expect(RailsWorldIngestRequestSchema.safeParse(fixtures.railsSample).success).toBe(true);
    expect(RailsWorldLayerResponseSchema.safeParse(fixtures.railsWorldResponse).success).toBe(true);
    expect(RailsWorldLayerResponseSchema.safeParse(fixtures.railsWorldResponseEmpty).success).toBe(true);
    expect(RailsWorldLayerResponseSchema.safeParse(fixtures.railsWorldResponseTruncated).success).toBe(true);
  });

  it("rejects an unbounded id, and more items than MAP_WORLD_MAX_ITEMS", () => {
    const segment = fixtures.railsSample.data[0];
    expect(RailSegmentSchema.safeParse({ ...segment, id: "x".repeat(201) }).success).toBe(false);
    const tooMany = Array.from({ length: MAP_WORLD_MAX_ITEMS + 1 }, (_, i) => ({ ...segment, id: `rail-${i}` }));
    expect(RailsLayerDataSchema.safeParse(tooMany).success).toBe(false);
  });

  it("the ingest request is strict: an unknown field (e.g. a stray layer or hash) is refused", () => {
    expect(RailsWorldIngestRequestSchema.safeParse({ ...fixtures.railsSample, layer: "rails" }).success).toBe(false);
    expect(RailsWorldIngestRequestSchema.safeParse({ ...fixtures.railsSample, hash: "x" }).success).toBe(false);
  });
});

describe("resourceNodes layer", () => {
  it("the sample fixture parses as an ingest request and as a response", () => {
    expect(ResourceNodesWorldIngestRequestSchema.safeParse(fixtures.resourceNodesSample).success).toBe(true);
    expect(ResourceNodesWorldLayerResponseSchema.safeParse(fixtures.resourceNodesWorldResponse).success).toBe(true);
    expect(ResourceNodesWorldLayerResponseSchema.safeParse(fixtures.resourceNodesWorldResponseEmpty).success).toBe(true);
  });

  it("has one entry per distinct type/purity/exploited combination sampled, matching the capture's own count", () => {
    expect(fixtures.resourceNodesSample.data).toHaveLength(6);
    expect(fixtures.resourceNodesSample.data.filter((n) => n.exploited)).toHaveLength(2);
  });

  it("purity and type are plain strings (deploy skew: a purity or resource this contract doesn't yet know about still parses)", () => {
    const node = fixtures.resourceNodesSample.data[0];
    expect(ResourceNodeSchema.safeParse({ ...node, type: "Bauxite", purity: "unknown-future-purity" }).success).toBe(true);
  });

  it("requires x/y to be whole-metre integers and exploited to be a real boolean", () => {
    const node = fixtures.resourceNodesSample.data[0];
    expect(ResourceNodeSchema.safeParse({ ...node, x: 1.5 }).success).toBe(false);
    expect(ResourceNodeSchema.safeParse({ ...node, exploited: "yes" }).success).toBe(false);
  });
});

describe("worldLayerResponseSchema (the generic wrapper, ADR-0004's snapshotEnvelope pattern)", () => {
  it("builds a response schema for any array item schema", () => {
    const schema = worldLayerResponseSchema(z.array(RailSegmentSchema.pick({ id: true })));
    expect(schema.safeParse({ layer: "rails", hash: "h", observedAt: "2026-09-27T00:00:00Z", truncated: false, count: 1, data: [{ id: "a" }] }).success).toBe(true);
  });

  it("layer is a plain string: an unrecognized layer name still parses (an older contract must survive a newer backend's new layer)", () => {
    expect(RailsWorldLayerResponseSchema.safeParse({ ...fixtures.railsWorldResponse, layer: "belts" }).success).toBe(true);
  });

  it("count and data.length may disagree without being refused (count is documentation of what the backend computed, not cross-checked)", () => {
    // The schema does not refine count === data.length: the backend is trusted to have derived count correctly, and a
    // contract-level cross-check would just duplicate that computation. This test pins that deliberate choice.
    expect(RailsWorldLayerResponseSchema.safeParse({ ...fixtures.railsWorldResponse, count: 999 }).success).toBe(true);
  });

  it("rejects a negative count", () => {
    expect(RailsWorldLayerResponseSchema.safeParse({ ...fixtures.railsWorldResponse, count: -1 }).success).toBe(false);
  });
});

describe("MAP_WORLD_LAYER_MAX_BYTES (#352 addition b)", () => {
  it("is 2 MB, and is a plain exported constant (M3's route reads it directly, not a schema refine)", () => {
    expect(MAP_WORLD_LAYER_MAX_BYTES).toBe(2_000_000);
  });

  it("the sample fixtures are far under the cap (sanity: the fixtures are realistic, not already at the limit)", () => {
    expect(JSON.stringify(fixtures.railsSample).length).toBeLessThan(MAP_WORLD_LAYER_MAX_BYTES);
    expect(JSON.stringify(fixtures.resourceNodesSample).length).toBeLessThan(MAP_WORLD_LAYER_MAX_BYTES);
  });
});

describe("mapLive", () => {
  it("the sample and empty fixtures parse", () => {
    expect(MapLiveSchema.safeParse(fixtures.mapLiveSample).success).toBe(true);
    expect(MapLiveSchema.safeParse(fixtures.mapLiveEmpty).success).toBe(true);
  });

  it("bounds trains and stations to MAP_LIVE_MAX_TRAINS/STATIONS", () => {
    const train = fixtures.mapLiveSample.trains[0];
    const station = fixtures.mapLiveSample.stations[0];
    expect(MapTrainSchema.safeParse(train).success).toBe(true);
    expect(MapTrainStationSchema.safeParse(station).success).toBe(true);
    expect(MapLiveSchema.safeParse({ trains: Array.from({ length: MAP_LIVE_MAX_TRAINS + 1 }, () => train), stations: [] }).success).toBe(false);
    expect(MapLiveSchema.safeParse({ trains: [], stations: Array.from({ length: MAP_LIVE_MAX_STATIONS + 1 }, () => station) }).success).toBe(false);
  });

  it("is optional in a snapshot, and is refused on an unreachable one, like every other data part", () => {
    const reachableWithMapLive = { ...fixtures.agentSnapshotRequestWithMapLive };
    expect(SnapshotRequestSchema.safeParse(reachableWithMapLive).success).toBe(true);
    const unreachableWithMapLive = { ...fixtures.agentSnapshotRequestUnreachable, mapLive: fixtures.mapLiveSample };
    expect(SnapshotRequestSchema.safeParse(unreachableWithMapLive).success).toBe(false);
    expect(SnapshotRequestSchema.safeParse(fixtures.agentSnapshotRequestFull).success).toBe(true); // no mapLive at all: still fine
  });
});
