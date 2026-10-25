import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MAP_WORLD_LAYER_INGEST_SCHEMAS,
  MAP_WORLD_LAYER_ITEM_SCHEMAS,
  MAP_WORLD_LAYER_MAX_ITEMS,
  MapWorldLayerResponseSchema,
  ResourceNodeSchema,
  TRAIN_ROUTES_MAX_ITEMS,
  TRAIN_ROUTES_MAX_ITEM_CLASSES,
  TRAIN_ROUTES_MAX_PLATFORMS,
  TRAIN_ROUTES_MAX_STOPS,
  TrainRouteRecordSchema,
  TrainRouteStationSchema,
  TrainRouteTrainSchema,
  TrainRoutesLayerDataSchema,
  TrainRoutesWorldIngestRequestSchema,
} from "../src/index";

const [station, , , train] = fixtures.trainRoutesSample.data;

describe("trainRoutes world layer (ADR-0055 Decision 1)", () => {
  it("the fixture parses as a layer, an ingest body and a response, including a duplicate and a trailing-space name", () => {
    expect(TrainRoutesLayerDataSchema.safeParse(fixtures.trainRoutesSample.data).success).toBe(true);
    expect(TrainRoutesWorldIngestRequestSchema.safeParse(fixtures.trainRoutesSample).success).toBe(true);
    expect(MapWorldLayerResponseSchema.safeParse(fixtures.trainRoutesWorldResponse).success).toBe(true);
    const names = fixtures.trainRoutesSample.data.filter((r) => r.recordType === "station").map((r) => r.name);
    expect(new Set(names).size).toBeLessThan(names.length);
    expect(names.some((n) => n !== n.trim())).toBe(true);
  });

  it("is registered in every per-layer table", () => {
    for (const table of [MAP_WORLD_LAYER_DATA_SCHEMAS, MAP_WORLD_LAYER_INGEST_SCHEMAS, MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS]) {
      expect(Object.keys(table)).toContain("trainRoutes");
    }
    expect(MAP_WORLD_LAYER_MAX_ITEMS.trainRoutes).toBe(TRAIN_ROUTES_MAX_ITEMS);
  });

  it("an unknown recordType fails its item (the ingest drops it), and the ingest body refuses extra keys", () => {
    expect(TrainRouteRecordSchema.safeParse({ ...train, recordType: "signal" }).success).toBe(false);
    expect(TrainRoutesWorldIngestRequestSchema.safeParse({ ...fixtures.trainRoutesSample, layer: "trainRoutes" }).success).toBe(false);
  });

  it("a platform mode is an open string, but not empty-bounded past its cap", () => {
    const withMode = (mode: string) => ({ ...station, platforms: [{ id: "p", mode, items: [] }] });
    expect(TrainRouteStationSchema.safeParse(withMode("someNewMode")).success).toBe(true);
    expect(TrainRouteStationSchema.safeParse(withMode("x".repeat(41))).success).toBe(false);
  });

  it("bounds every list and string", () => {
    const ok = (n: number, v: unknown) => Array<unknown>(n).fill(v);
    expect(TrainRouteStationSchema.safeParse({ ...station, platforms: ok(TRAIN_ROUTES_MAX_PLATFORMS, { id: "p", mode: "load", items: [] }) }).success).toBe(true);
    expect(TrainRouteStationSchema.safeParse({ ...station, platforms: ok(TRAIN_ROUTES_MAX_PLATFORMS + 1, { id: "p", mode: "load", items: [] }) }).success).toBe(false);
    expect(TrainRouteTrainSchema.safeParse({ ...train, stops: ok(TRAIN_ROUTES_MAX_STOPS, "A") }).success).toBe(true);
    expect(TrainRouteTrainSchema.safeParse({ ...train, stops: ok(TRAIN_ROUTES_MAX_STOPS + 1, "A") }).success).toBe(false);
    expect(TrainRouteTrainSchema.safeParse({ ...train, items: ok(TRAIN_ROUTES_MAX_ITEM_CLASSES + 1, "Desc_X_C") }).success).toBe(false);
    expect(TrainRouteTrainSchema.safeParse({ ...train, items: [""] }).success).toBe(false);
    expect(TrainRouteTrainSchema.safeParse({ ...train, name: "n".repeat(201) }).success).toBe(false);
    expect(TrainRoutesLayerDataSchema.safeParse(ok(TRAIN_ROUTES_MAX_ITEMS + 1, train)).success).toBe(false);
  });

  it("a station without platforms and a train without stops are valid (a half-built network)", () => {
    expect(TrainRouteStationSchema.safeParse({ ...station, platforms: [] }).success).toBe(true);
    expect(TrainRouteTrainSchema.safeParse({ ...train, stops: [], items: [] }).success).toBe(true);
  });
});

describe("trainRoutes item schema as the ingest uses it (per-item re-validation)", () => {
  it("drops junk items without throwing: null, missing recordType, a station with a train's fields", () => {
    for (const junk of [null, undefined, 5, "station", {}, { id: "x" }, { ...train, recordType: undefined }, { ...station, recordType: "train" }]) {
      expect(TrainRouteRecordSchema.safeParse(junk).success).toBe(false);
    }
  });

  it("a platform needs mode and items; an id is bounded", () => {
    const plat = (p: object) => ({ ...station, platforms: [p] });
    expect(TrainRouteStationSchema.safeParse(plat({ id: "p", items: [] })).success).toBe(false);
    expect(TrainRouteStationSchema.safeParse(plat({ id: "p", mode: "load" })).success).toBe(false);
    expect(TrainRouteStationSchema.safeParse({ ...station, id: "i".repeat(201) }).success).toBe(false);
  });

  it("the layer array caps at exactly TRAIN_ROUTES_MAX_ITEMS", () => {
    expect(TrainRoutesLayerDataSchema.safeParse(Array<unknown>(TRAIN_ROUTES_MAX_ITEMS).fill(train)).success).toBe(true);
  });
});

describe("ResourceNode.className (ADR-0053 Decision 5)", () => {
  const node = fixtures.resourceNodesSample.data[0]!;

  it("is optional: an older layer without it parses", () => {
    const { className: _className, ...oldRow } = node;
    expect("className" in oldRow).toBe(false);
    expect(ResourceNodeSchema.safeParse(oldRow).success).toBe(true);
    expect(ResourceNodeSchema.safeParse(node).success).toBe(true);
  });

  it("accepts a FRM class name and bounds it", () => {
    expect(ResourceNodeSchema.safeParse({ ...node, className: "Desc_OreIron_C" }).success).toBe(true);
    expect(ResourceNodeSchema.safeParse({ ...node, className: "x".repeat(201) }).success).toBe(false);
    expect(ResourceNodeSchema.safeParse({ ...node, className: 5 }).success).toBe(false);
  });
});
