import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MAP_WORLD_LAYER_INGEST_SCHEMAS,
  MAP_WORLD_LAYER_ITEM_SCHEMAS,
  MAP_WORLD_LAYER_MAX_ITEMS,
  MapWorldLayerResponseSchema,
  POWER_LINES_MAX_ITEMS,
  PowerLineSchema,
  PowerLinesLayerDataSchema,
  PowerLinesWorldIngestRequestSchema,
} from "../src/index";

const [shortest, longest] = fixtures.powerLinesSample.data;

describe("powerLines world layer (ADR-0038 §1)", () => {
  it("the fixture parses as a layer, an ingest body and a response", () => {
    expect(PowerLinesLayerDataSchema.safeParse(fixtures.powerLinesSample.data).success).toBe(true);
    expect(PowerLinesWorldIngestRequestSchema.safeParse(fixtures.powerLinesSample).success).toBe(true);
    expect(MapWorldLayerResponseSchema.safeParse(fixtures.powerLinesWorldResponse).success).toBe(true);
    expect(shortest!.points).toHaveLength(2);
    expect(longest!.points).toHaveLength(2);
  });

  it("is registered in every per-layer table", () => {
    for (const table of [MAP_WORLD_LAYER_DATA_SCHEMAS, MAP_WORLD_LAYER_INGEST_SCHEMAS, MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS]) {
      expect(Object.keys(table)).toContain("powerLines");
    }
    expect(MAP_WORLD_LAYER_MAX_ITEMS.powerLines).toBe(POWER_LINES_MAX_ITEMS);
  });

  it("the cap holds the captured save's 843 lines with room to grow", () => {
    expect(POWER_LINES_MAX_ITEMS).toBeGreaterThan(843 * 10);
  });

  it("the ingest body refuses extra keys", () => {
    expect(PowerLinesWorldIngestRequestSchema.safeParse({ ...fixtures.powerLinesSample, layer: "powerLines" }).success).toBe(false);
  });

  it("a line is exactly two [x, y] ends: no spline, no z", () => {
    const [a, b] = longest!.points;
    expect(PowerLineSchema.safeParse({ ...longest, points: [a] }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, points: [a, b, a] }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, points: [[...a, 10], b] }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, points: [{ x: a[0], y: a[1] }, b] }).success).toBe(false);
  });

  it("bounds the id, coordinates and item count", () => {
    expect(PowerLineSchema.safeParse({ ...longest, id: "" }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, id: "i".repeat(201) }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, points: [[1.5, 0], [0, 0]] }).success).toBe(false);
    expect(PowerLineSchema.safeParse({ ...longest, points: [[0, 0], [0, 2_000_000]] }).success).toBe(false);
    expect(PowerLinesLayerDataSchema.safeParse(Array<unknown>(POWER_LINES_MAX_ITEMS).fill(longest)).success).toBe(true);
    expect(PowerLinesLayerDataSchema.safeParse(Array<unknown>(POWER_LINES_MAX_ITEMS + 1).fill(longest)).success).toBe(false);
  });
});

describe("powerLines item schema as the ingest uses it (per-item re-validation)", () => {
  it("drops junk items without throwing", () => {
    const { points: _points, ...noPoints } = longest!;
    const { id: _id, ...noId } = longest!;
    for (const junk of [null, undefined, 5, "line", {}, { id: "x" }, noPoints, noId, { ...longest, points: "[[0,0],[1,1]]" }]) {
      expect(PowerLineSchema.safeParse(junk).success).toBe(false);
    }
  });
});
