import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_MARKER_NAME_MAX_CHARS, MAP_MARKERS_MAX_ITEMS, MapMarkerSchema, MapMarkersLayerDataSchema } from "@satisfactory-dash/shared";
import { mapMarkersSample } from "@satisfactory-dash/shared/fixtures";
import { DEFAULT_MARKER_COLOR, DERIVED_ID_PREFIX, mapMapMarkers, markerColor, markerKind, markerName } from "./mapMarkersMapper.js";

// docs-vault/raw-sources/captured-responses: a preamble, a `---` line, then the JSON.
const CAPTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs-vault/raw-sources/captured-responses");

function readCapture(name: string): Record<string, unknown>[] {
  const text = readFileSync(path.join(CAPTURES, name), "utf8").replace(/\r\n/g, "\n");
  return JSON.parse(text.slice(text.indexOf("\n---\n") + 5)) as Record<string, unknown>[];
}

const capture = () => readCapture("frm-getMapMarkers-2026-09-27-full.json");

const marker = (over: Record<string, unknown> = {}) => ({
  ID: "m1",
  Name: "Mark",
  location: { x: 0, y: 0, z: 0 },
  Category: "",
  MapMarkerType: "RT_MapMarker",
  IconID: 349,
  ColorSlot: "6EA37BFF",
  Scale: 1,
  CompassViewDistance: "CVD_Off",
  ...over,
});

describe("mapMapMarkers on the 2026-09-27 capture (ADR-0038 §1, #330)", () => {
  it("projects all four markers to the contract's fixture, sorted by id", () => {
    const { data, dropped } = mapMapMarkers(capture());
    expect(dropped).toBe(0);
    expect(MapMarkersLayerDataSchema.safeParse(data).success).toBe(true);
    expect(data).toEqual([...mapMarkersSample.data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  });

  it("is the same for the same game state whatever FRM's order or the fields the layer ignores", () => {
    const raw = capture();
    const once = JSON.stringify(mapMapMarkers(raw).data);
    const shuffled = [...raw].reverse().map((m) => ({ ...m, Scale: 9, CompassViewDistance: "CVD_Far", location: { ...(m.location as object), z: 0 } }));
    expect(JSON.stringify(mapMapMarkers(shuffled).data)).toBe(once);
    const twins = [marker({ Name: "b" }), marker({ Name: "a" })];
    expect(JSON.stringify(mapMapMarkers(twins).data)).toBe(JSON.stringify(mapMapMarkers([...twins].reverse()).data));
  });
});

describe("markerName", () => {
  it("trims, keeps an empty name, and cuts at 60 UTF-16 code units", () => {
    expect(markerName("  Rock  ")).toBe("Rock");
    expect(markerName("   ")).toBe("");
    expect(markerName(undefined)).toBe("");
    expect(markerName("a".repeat(70))).toBe("a".repeat(MAP_MARKER_NAME_MAX_CHARS));
    expect(markerName(` ${"a".repeat(60)} `)).toBe("a".repeat(60));
  });

  it("never splits a surrogate pair, and the result always passes the contract's .max", () => {
    const emoji = "\u{1F600}"; // two UTF-16 code units
    // 59 letters then an emoji: the cut at 60 would land between its halves, so the emoji goes whole.
    const split = markerName(`${"a".repeat(59)}${emoji}tail`);
    expect(split).toBe("a".repeat(59));
    // 58 letters then an emoji: both halves fit exactly.
    expect(markerName(`${"a".repeat(58)}${emoji}tail`)).toBe(`${"a".repeat(58)}${emoji}`);
    expect(markerName(emoji.repeat(40))).toBe(emoji.repeat(30));
    for (const name of [split, markerName(emoji.repeat(40)), markerName(`b${emoji.repeat(40)}`)]) {
      expect(name.length).toBeLessThanOrEqual(MAP_MARKER_NAME_MAX_CHARS);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name)).toBe(false);
    }
  });

  it("keeps a non-string name as empty rather than dropping the marker", () => {
    const { data, dropped } = mapMapMarkers([marker({ Name: 5 }), marker({ ID: "m2", Name: undefined })]);
    expect(dropped).toBe(0);
    expect(data.map((m) => m.name)).toEqual(["", ""]);
  });
});

describe("markerKind", () => {
  it("maps RT_Stamp to stamp, RT_MapMarker and anything else to marker", () => {
    expect(markerKind("RT_Stamp")).toBe("stamp");
    expect(markerKind("RT_MapMarker")).toBe("marker");
    expect(markerKind("RT_Something")).toBe("marker");
    expect(markerKind("rt_stamp")).toBe("marker");
    expect(markerKind(undefined)).toBe("marker");
    expect(mapMapMarkers([marker({ MapMarkerType: 7 })]).data[0]!.kind).toBe("marker");
  });
});

describe("markerColor", () => {
  it("reads ColorSlot as RRGGBBAA, drops the alpha and lower-cases it", () => {
    expect(markerColor("6EA37BFF")).toBe("#6ea37b");
    expect(markerColor("FFFFFFFF")).toBe("#ffffff");
    expect(markerColor("12ab34cd")).toBe("#12ab34");
  });

  it("gives the neutral default to a missing or malformed slot", () => {
    for (const bad of [undefined, "", "6EA37B", "6EA37BFF0", "GGGGGGGG", "#6EA37BFF", " 6EA37BFF"]) {
      expect(markerColor(bad)).toBe(DEFAULT_MARKER_COLOR);
    }
    expect(mapMapMarkers([marker({ ColorSlot: 0xff })]).data[0]!.color).toBe(DEFAULT_MARKER_COLOR);
  });
});

describe("mapMapMarkers ids", () => {
  it("keeps FRM's id when the contract can hold it", () => {
    expect(mapMapMarkers([marker({ ID: "i".repeat(200) })]).data[0]!.id).toBe("i".repeat(200));
  });

  it("derives a deterministic id for a missing, empty, non-string or over-long id; the marker still parses", () => {
    for (const ID of [undefined, "", 42, "i".repeat(201)]) {
      const first = mapMapMarkers([marker({ ID })]).data[0]!;
      const again = mapMapMarkers([marker({ ID })]).data[0]!;
      expect(first.id.startsWith(DERIVED_ID_PREFIX)).toBe(true);
      expect(first.id).toBe(again.id);
      expect(MapMarkerSchema.safeParse(first).success).toBe(true);
    }
    const a = mapMapMarkers([marker({ ID: undefined, Name: "a" })]).data[0]!.id;
    const b = mapMapMarkers([marker({ ID: undefined, Name: "b" })]).data[0]!.id;
    const moved = mapMapMarkers([marker({ ID: undefined, Name: "a", location: { x: 10_000, y: 0, z: 0 } })]).data[0]!.id;
    expect(new Set([a, b, moved]).size).toBe(3);
  });
});

describe("mapMapMarkers drops", () => {
  it("drops and counts a marker without a finite, in-bounds position; keeps the rest", () => {
    const junk = [
      null,
      "x",
      {},
      marker({ location: undefined }),
      marker({ location: { x: 1 } }),
      marker({ location: { x: Number.NaN, y: 0 } }),
      marker({ location: { x: 0, y: Number.POSITIVE_INFINITY } }),
      marker({ location: { x: "1", y: 0 } }),
      marker({ location: { x: 2e8, y: 0 } }),
    ];
    const { data, dropped } = mapMapMarkers([...junk, marker({ ID: "ok", location: { x: 150, y: -149 } })]);
    expect(dropped).toBe(junk.length);
    expect(data).toEqual([{ id: "ok", name: "Mark", kind: "marker", icon: 349, color: "#6ea37b", x: 2, y: -1 }]);
  });

  it("drops and counts a marker whose icon is not a whole number in 0..1,000,000", () => {
    const bad = [undefined, -1, 1.5, 1_000_001, "349", null, Number.NaN];
    const { data, dropped } = mapMapMarkers([...bad.map((IconID, i) => marker({ ID: `b${i}`, IconID })), marker({ ID: "zero", IconID: 0 }), marker({ ID: "max", IconID: 1_000_000 })]);
    expect(dropped).toBe(bad.length);
    expect(data.map((m) => [m.id, m.icon])).toEqual([["max", 1_000_000], ["zero", 0]]);
  });

  it("caps the layer at MAP_MARKERS_MAX_ITEMS, counting the cut markers", () => {
    const many = Array.from({ length: MAP_MARKERS_MAX_ITEMS + 3 }, (_, i) => marker({ ID: `m${String(i).padStart(5, "0")}` }));
    const { data, dropped } = mapMapMarkers(many);
    expect(data).toHaveLength(MAP_MARKERS_MAX_ITEMS);
    expect(dropped).toBe(3);
    expect(data.at(-1)!.id).toBe(`m${String(MAP_MARKERS_MAX_ITEMS - 1).padStart(5, "0")}`);
    expect(MapMarkersLayerDataSchema.safeParse(data).success).toBe(true);
  });
});
