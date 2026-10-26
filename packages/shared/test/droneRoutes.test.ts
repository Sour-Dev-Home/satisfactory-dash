import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  DRONE_ROUTES_MAX_ITEMS,
  DronePortSchema,
  DroneRoutesLayerDataSchema,
  DroneRoutesWorldIngestRequestSchema,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MAP_WORLD_LAYER_INGEST_SCHEMAS,
  MAP_WORLD_LAYER_ITEM_SCHEMAS,
  MAP_WORLD_LAYER_MAX_ITEMS,
  MapWorldLayerResponseSchema,
  TRAIN_ROUTES_MAX_ITEM_CLASSES,
} from "../src/index";

const [home, partner, unpaired] = fixtures.droneRoutesSample.data;

describe("droneRoutes world layer (ADR-0055 Decision 1)", () => {
  it("the fixture parses as a layer, an ingest body and a response, with a pair named on both ports", () => {
    expect(DroneRoutesLayerDataSchema.safeParse(fixtures.droneRoutesSample.data).success).toBe(true);
    expect(DroneRoutesWorldIngestRequestSchema.safeParse(fixtures.droneRoutesSample).success).toBe(true);
    expect(MapWorldLayerResponseSchema.safeParse(fixtures.droneRoutesWorldResponse).success).toBe(true);
    expect(home!.paired).toBe(partner!.name);
    expect(partner!.paired).toBe(home!.name);
    expect(unpaired!.paired).toBeNull();
  });

  it("is registered in every per-layer table", () => {
    for (const table of [MAP_WORLD_LAYER_DATA_SCHEMAS, MAP_WORLD_LAYER_INGEST_SCHEMAS, MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS]) {
      expect(Object.keys(table)).toContain("droneRoutes");
    }
    expect(MAP_WORLD_LAYER_MAX_ITEMS.droneRoutes).toBe(DRONE_ROUTES_MAX_ITEMS);
  });

  it("the ingest body refuses extra keys", () => {
    expect(DroneRoutesWorldIngestRequestSchema.safeParse({ ...fixtures.droneRoutesSample, layer: "droneRoutes" }).success).toBe(false);
  });

  it("bounds every list, string and coordinate", () => {
    const many = (n: number) => Array<string>(n).fill("Desc_X_C");
    expect(DronePortSchema.safeParse({ ...home, input: many(TRAIN_ROUTES_MAX_ITEM_CLASSES) }).success).toBe(true);
    for (const field of ["input", "output", "fuel"]) {
      expect(DronePortSchema.safeParse({ ...home, [field]: many(TRAIN_ROUTES_MAX_ITEM_CLASSES + 1) }).success).toBe(false);
      expect(DronePortSchema.safeParse({ ...home, [field]: [""] }).success).toBe(false);
    }
    expect(DronePortSchema.safeParse({ ...home, name: "n".repeat(201) }).success).toBe(false);
    expect(DronePortSchema.safeParse({ ...home, paired: "n".repeat(201) }).success).toBe(false);
    expect(DronePortSchema.safeParse({ ...home, x: 1.5 }).success).toBe(false);
    expect(DronePortSchema.safeParse({ ...home, y: 2_000_000 }).success).toBe(false);
    expect(DroneRoutesLayerDataSchema.safeParse(Array<unknown>(DRONE_ROUTES_MAX_ITEMS).fill(home)).success).toBe(true);
    expect(DroneRoutesLayerDataSchema.safeParse(Array<unknown>(DRONE_ROUTES_MAX_ITEMS + 1).fill(home)).success).toBe(false);
  });
});

describe("droneRoutes item schema as the ingest uses it (per-item re-validation)", () => {
  it("drops junk items without throwing", () => {
    const { paired: _paired, ...noPaired } = home!;
    const { fuel: _fuel, ...noFuel } = home!;
    for (const junk of [null, undefined, 5, "port", {}, { id: "x" }, noPaired, noFuel, { ...home, paired: 5 }]) {
      expect(DronePortSchema.safeParse(junk).success).toBe(false);
    }
  });
});
