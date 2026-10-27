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

describe("droneRoutes pairedId (S4-A: a native reader can send the partner's id)", () => {
  const [nativeHome, nativePartner, nativeUnpaired] = fixtures.droneRoutesSampleWithPairedId.data;

  it("an FRM-shaped port without pairedId still parses, and parsing doesn't add the key", () => {
    expect(home).not.toHaveProperty("pairedId");
    const parsed = DronePortSchema.parse(home);
    expect(parsed).not.toHaveProperty("pairedId");
    expect(parsed).toEqual(home);
  });

  it("the native fixture names the partner's id on both ports and null on the unpaired one", () => {
    expect(DroneRoutesWorldIngestRequestSchema.safeParse(fixtures.droneRoutesSampleWithPairedId).success).toBe(true);
    expect(nativeHome!.pairedId).toBe(nativePartner!.id);
    expect(nativePartner!.pairedId).toBe(nativeHome!.id);
    expect(nativeUnpaired!.pairedId).toBeNull();
    expect(nativeHome!.paired).toBe(nativePartner!.name);
  });

  it("accepts null and a string, and is bounded like id", () => {
    expect(DronePortSchema.safeParse({ ...home, pairedId: null }).success).toBe(true);
    expect(DronePortSchema.safeParse({ ...home, pairedId: "Build_DroneStation_C_1" }).success).toBe(true);
    expect(DronePortSchema.safeParse({ ...home, pairedId: "n".repeat(200) }).success).toBe(true);
    expect(DronePortSchema.safeParse({ ...home, pairedId: "n".repeat(201) }).success).toBe(false);
    expect(DronePortSchema.safeParse({ ...home, id: "n".repeat(200) }).success).toBe(true);
    expect(DronePortSchema.safeParse({ ...home, id: "n".repeat(201) }).success).toBe(false);
    // Same bound as id, including its (lack of a) minimum.
    expect(DronePortSchema.safeParse({ ...home, pairedId: "" }).success).toBe(DronePortSchema.safeParse({ ...home, id: "" }).success);
  });

  it("refuses a non-string pairedId", () => {
    for (const bad of [5, true, {}, ["Build_DroneStation_C_1"]]) {
      expect(DronePortSchema.safeParse({ ...home, pairedId: bad }).success).toBe(false);
    }
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
