import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  MAP_MARKERS_MAX_ITEMS,
  MAP_MARKER_NAME_MAX_CHARS,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MAP_WORLD_LAYER_INGEST_SCHEMAS,
  MAP_WORLD_LAYER_ITEM_SCHEMAS,
  MAP_WORLD_LAYER_MAX_ITEMS,
  MapMarkerSchema,
  MapMarkersLayerDataSchema,
  MapMarkersWorldIngestRequestSchema,
  MapWorldLayerResponseSchema,
} from "../src/index";

const [stamp, , , marker] = fixtures.mapMarkersSample.data;

describe("mapMarkers world layer (ADR-0038 §1)", () => {
  it("the fixture parses as a layer, an ingest body and a response, with both captured kinds", () => {
    expect(MapMarkersLayerDataSchema.safeParse(fixtures.mapMarkersSample.data).success).toBe(true);
    expect(MapMarkersWorldIngestRequestSchema.safeParse(fixtures.mapMarkersSample).success).toBe(true);
    expect(MapWorldLayerResponseSchema.safeParse(fixtures.mapMarkersWorldResponse).success).toBe(true);
    expect(stamp!.kind).toBe("stamp");
    expect(marker!.kind).toBe("marker");
  });

  it("is registered in every per-layer table", () => {
    for (const table of [MAP_WORLD_LAYER_DATA_SCHEMAS, MAP_WORLD_LAYER_INGEST_SCHEMAS, MAP_WORLD_LAYER_ITEM_SCHEMAS, MAP_WORLD_LAYER_MAX_ITEMS]) {
      expect(Object.keys(table)).toContain("mapMarkers");
    }
    expect(MAP_WORLD_LAYER_MAX_ITEMS.mapMarkers).toBe(MAP_MARKERS_MAX_ITEMS);
  });

  it("the ingest body refuses extra keys", () => {
    expect(MapMarkersWorldIngestRequestSchema.safeParse({ ...fixtures.mapMarkersSample, layer: "mapMarkers" }).success).toBe(false);
  });

  it("keeps names to 60 characters and allows an empty one", () => {
    expect(MapMarkerSchema.safeParse({ ...marker, name: "" }).success).toBe(true);
    expect(MapMarkerSchema.safeParse({ ...marker, name: "n".repeat(MAP_MARKER_NAME_MAX_CHARS) }).success).toBe(true);
    expect(MapMarkerSchema.safeParse({ ...marker, name: "n".repeat(MAP_MARKER_NAME_MAX_CHARS + 1) }).success).toBe(false);
  });

  it("bounds the id, kind, icon, colour, coordinates and item count", () => {
    expect(MapMarkerSchema.safeParse({ ...marker, id: "" }).success).toBe(false);
    expect(MapMarkerSchema.safeParse({ ...marker, id: "i".repeat(201) }).success).toBe(false);
    expect(MapMarkerSchema.safeParse({ ...marker, kind: "RT_MapMarker" }).success).toBe(false);
    expect(MapMarkerSchema.safeParse({ ...marker, icon: -1 }).success).toBe(false);
    expect(MapMarkerSchema.safeParse({ ...marker, icon: 1.5 }).success).toBe(false);
    for (const color of ["6ea37b", "#6EA37B", "#6ea37bff", "#fff", "#gggggg"]) {
      expect(MapMarkerSchema.safeParse({ ...marker, color }).success, color).toBe(false);
    }
    expect(MapMarkerSchema.safeParse({ ...marker, x: 1.5 }).success).toBe(false);
    expect(MapMarkerSchema.safeParse({ ...marker, y: 2_000_000 }).success).toBe(false);
    expect(MapMarkersLayerDataSchema.safeParse(Array<unknown>(MAP_MARKERS_MAX_ITEMS).fill(marker)).success).toBe(true);
    expect(MapMarkersLayerDataSchema.safeParse(Array<unknown>(MAP_MARKERS_MAX_ITEMS + 1).fill(marker)).success).toBe(false);
  });
});

describe("mapMarkers item schema as the ingest uses it (per-item re-validation)", () => {
  it("drops junk items without throwing", () => {
    const { color: _color, ...noColor } = marker!;
    const { kind: _kind, ...noKind } = marker!;
    for (const junk of [null, undefined, 5, "marker", {}, { id: "x" }, noColor, noKind, { ...marker, icon: "349" }]) {
      expect(MapMarkerSchema.safeParse(junk).success).toBe(false);
    }
  });
});
