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
  PolylinePointSchema,
  PolylineSchema,
  RailSegmentSchema,
  RailsLayerDataSchema,
  RailsWorldIngestRequestSchema,
  RailsWorldLayerResponseSchema,
  ResourceNodeSchema,
  ResourceNodesLayerDataSchema,
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

  it("has one entry per distinct type/purity/nodeType/exploited combination sampled, matching the capture's own count", () => {
    expect(fixtures.resourceNodesSample.data).toHaveLength(7);
    expect(fixtures.resourceNodesSample.data.filter((n) => n.exploited)).toHaveLength(2);
  });

  it("nodeType tells a miner-able Node apart from a Fracking Satellite, since one capture returns both (architect, #352 follow-up)", () => {
    const byNodeType = (nodeType: string) => fixtures.resourceNodesSample.data.filter((n) => n.nodeType === nodeType);
    expect(byNodeType("node")).toHaveLength(6);
    expect(byNodeType("frackingSatellite")).toHaveLength(1);
    expect(byNodeType("frackingSatellite")[0]).toMatchObject({ type: "Nitrogen Gas", purity: "pure" });
  });

  it("purity, type and nodeType are plain strings (deploy skew: a value this contract doesn't yet know about still parses)", () => {
    const node = fixtures.resourceNodesSample.data[0];
    expect(ResourceNodeSchema.safeParse({ ...node, type: "Bauxite", purity: "unknown-future-purity", nodeType: "geyser" }).success).toBe(true);
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

// test-hunter (fresh-eyes pass, FULL tier): adversarial cases the implementer's own test.ts didn't try.
describe("PolylineSchema / PolylinePointSchema: adversarial inputs (fresh-eyes)", () => {
  it("rejects a 3-element tuple (z.tuple does NOT silently accept extra elements)", () => {
    expect(PolylineSchema.safeParse([[0, 0, 0], [1, 1]]).success).toBe(false);
  });

  it("rejects a 1-element tuple mixed into an otherwise-valid list (per-point arity, not just overall shape)", () => {
    expect(PolylineSchema.safeParse([[0, 0], [1]]).success).toBe(false);
  });

  it("rejects string-typed coordinates (no implicit coercion of numeric strings)", () => {
    expect(PolylinePointSchema.safeParse(["10", "5"]).success).toBe(false);
  });

  it("accepts both bounds of WholeMetreSchema and rejects one metre past either bound", () => {
    expect(PolylinePointSchema.safeParse([1_000_000, -1_000_000]).success).toBe(true);
    expect(PolylinePointSchema.safeParse([1_000_001, 0]).success).toBe(false);
    expect(PolylinePointSchema.safeParse([0, -1_000_001]).success).toBe(false);
  });

  it("rejects a value that is only an integer once truncated (a large float whose fractional part is real)", () => {
    expect(PolylinePointSchema.safeParse([1_000_000.5, 0]).success).toBe(false);
  });

  it("rejects a value so large it is still an integer per Number.isInteger but has lost precision (well past the metre bound anyway)", () => {
    expect(PolylinePointSchema.safeParse([1e21, 0]).success).toBe(false);
  });

  it("accepts -0 (an unremarkable whole metre, not a special case worth rejecting)", () => {
    expect(PolylinePointSchema.safeParse([-0, 0]).success).toBe(true);
  });
});

describe("worldLayerResponseSchema: generic wrapper construction (fresh-eyes)", () => {
  it("RailsWorldLayerResponseSchema's data field is the ARRAY schema (RailsLayerDataSchema), not the item schema", () => {
    // If map.ts ever passed RailSegmentSchema (the item) instead of RailsLayerDataSchema (the array) to
    // worldLayerResponseSchema, a single object would wrongly satisfy `data` and an actual array of segments
    // would wrongly be refused. Pin the correct (array) wiring by construction, not just by one fixture parsing.
    const base = { layer: "rails", hash: "h", observedAt: "2026-09-27T00:00:00Z", truncated: false, count: 1 };
    expect(RailsWorldLayerResponseSchema.safeParse({ ...base, data: fixtures.railsSample.data[0] }).success).toBe(false);
    expect(RailsWorldLayerResponseSchema.safeParse({ ...base, data: fixtures.railsSample.data }).success).toBe(true);
  });

  it("ResourceNodesWorldLayerResponseSchema's data field is likewise the array schema, not the item schema", () => {
    const base = { layer: "resourceNodes", hash: "h", observedAt: "2026-09-27T00:00:00Z", truncated: false, count: 1 };
    expect(ResourceNodesWorldLayerResponseSchema.safeParse({ ...base, data: fixtures.resourceNodesSample.data[0] }).success).toBe(false);
    expect(ResourceNodesWorldLayerResponseSchema.safeParse({ ...base, data: fixtures.resourceNodesSample.data }).success).toBe(true);
  });

  it("documents the generic's real hazard: nothing in worldLayerResponseSchema<T>'s signature stops an ITEM schema from being passed, and if it were, a single item would silently satisfy `data`", () => {
    const itemSchemaMisusedAsDataSchema = worldLayerResponseSchema(RailSegmentSchema); // the mistake this PR's own code does NOT make
    const base = { layer: "rails", hash: "h", observedAt: "2026-09-27T00:00:00Z", truncated: false, count: 1 };
    expect(itemSchemaMisusedAsDataSchema.safeParse({ ...base, data: fixtures.railsSample.data[0] }).success).toBe(true);
    expect(itemSchemaMisusedAsDataSchema.safeParse({ ...base, data: fixtures.railsSample.data }).success).toBe(false);
  });
});

describe("MAP_WORLD_LAYER_DATA_SCHEMAS: keyed correctly for M3's runtime lookup (fresh-eyes)", () => {
  it("maps each known layer to its OWN data schema, not to the wrong layer's or a stale reference", () => {
    expect(MAP_WORLD_LAYER_DATA_SCHEMAS.rails).toBe(RailsLayerDataSchema);
    expect(MAP_WORLD_LAYER_DATA_SCHEMAS.resourceNodes).toBe(ResourceNodesLayerDataSchema);
  });

  it("a rails-shaped payload is refused against the resourceNodes schema and vice versa (the lookup table must actually discriminate)", () => {
    expect(MAP_WORLD_LAYER_DATA_SCHEMAS.resourceNodes.safeParse(fixtures.railsSample.data).success).toBe(false);
    expect(MAP_WORLD_LAYER_DATA_SCHEMAS.rails.safeParse(fixtures.resourceNodesSample.data).success).toBe(false);
  });
});

describe("SnapshotRequestSchema's refine, exhaustive over all 6 optional parts (fresh-eyes)", () => {
  const PARTS = ["settings", "status", "power", "factory", "players", "mapLive"] as const;
  const fillers = {
    settings: { autoPause: true },
    status: fixtures.agentSnapshotRequestFull.status,
    power: fixtures.agentSnapshotRequestFull.power,
    factory: fixtures.agentSnapshotRequestFull.factory,
    players: fixtures.agentSnapshotRequestFull.players,
    mapLive: fixtures.mapLiveSample,
  };
  const base = { agentVersion: "0.1.0", observedAt: "2026-09-26T12:00:00.000Z", paused: null } as const;

  it("an unreachable snapshot is refused if even ONE of the 6 parts is present, whichever one it is", () => {
    for (const part of PARTS) {
      const snapshot = { ...base, reachable: false, [part]: fillers[part] };
      expect(SnapshotRequestSchema.safeParse(snapshot).success, `reachable:false with only ${part} set`).toBe(false);
    }
  });

  it("an unreachable snapshot with none of the 6 parts (and paused unknown) is accepted", () => {
    expect(SnapshotRequestSchema.safeParse({ ...base, reachable: false }).success).toBe(true);
  });

  it("a reachable snapshot is accepted no matter which subset of the 6 parts is present, including all six together", () => {
    const allSix = PARTS.reduce((acc, part) => ({ ...acc, [part]: fillers[part] }), {} as Record<string, unknown>);
    expect(SnapshotRequestSchema.safeParse({ ...base, reachable: true, paused: false, ...allSix }).success).toBe(true);
    for (const part of PARTS) {
      expect(SnapshotRequestSchema.safeParse({ ...base, reachable: true, paused: false, [part]: fillers[part] }).success, part).toBe(true);
    }
    expect(SnapshotRequestSchema.safeParse({ ...base, reachable: true, paused: false }).success).toBe(true);
  });
});

describe("map fixtures independently recomputed from the raw FRM captures (fresh-eyes, not trusting the commit message)", () => {
  // docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json, the shortest (17-point)
  // segment's raw SplineData x values (y is constant -150400 for every point of this particular segment).
  const rawRailXCentimetres = [
    -111900, -111827.58079429774, -111754.80246639732, -111682.02742033168, -111609.30488775825,
    -111536.40248749494, -111463.64841158094, -111390.78347491259, -111317.94462871869, -111245.08165218907,
    -111172.27148772354, -111099.39619405456, -111026.5777148786, -110953.82986631832, -110880.96652673393,
    -110808.37622046052, -110735.56460883941,
  ];
  const rawRailYCentimetres = -150400;

  it("rails: recomputing x/100 rounded to the nearest whole metre for all 17 points matches the fixture exactly", () => {
    const recomputedX = rawRailXCentimetres.map((cm) => Math.round(cm / 100));
    expect(recomputedX).toEqual(fixtures.railsSample.data[0].points.map((p) => p[0]));
    expect(fixtures.railsSample.data[0].points.every((p) => p[1] === Math.round(rawRailYCentimetres / 100))).toBe(true);
  });

  // frm-getResourceNode-2026-09-27-trimmed.json: raw location.x/y (centimetres) and Exploited for the same six
  // type/purity/exploited combinations the fixture claims to sample.
  const rawResourceNodes = [
    { type: "Crude Oil", x: 178265.375, y: 206095.640625, exploited: false },
    { type: "SAM (impure)", x: 161928.67437098248, y: 103777.13714502621, exploited: false },
    { type: "SAM (pure)", x: 162898.917256, y: 65413.69006496003, exploited: false },
    { type: "Limestone", x: -280836.6875, y: -42089.1796875, exploited: false },
    { type: "Coal", x: -99604.046875, y: -146823.21875, exploited: true },
    { type: "Iron Ore", x: -110588, y: -135153, exploited: true },
  ];

  it("resourceNodes: recomputing x/100 and y/100 rounded to the nearest whole metre matches the fixture exactly, in order", () => {
    const recomputed = rawResourceNodes.map((n) => ({ x: Math.round(n.x / 100), y: Math.round(n.y / 100), exploited: n.exploited }));
    // The first 6 items are the Node rows this list was built against; the 7th (a Fracking Satellite, added for
    // #352's nodeType follow-up) is checked separately below and in "nodeType tells a miner-able Node apart...".
    const actual = fixtures.resourceNodesSample.data.slice(0, 6).map((n) => ({ x: n.x, y: n.y, exploited: n.exploited }));
    expect(actual).toEqual(recomputed);
  });

  // frm-getResourceNode-2026-09-27-trimmed.json, item 11: Nitrogen Gas, Fracking Satellite, RP_Pure, not exploited.
  it("the fracking satellite sample matches the raw capture too", () => {
    const satellite = fixtures.resourceNodesSample.data.find((n) => n.nodeType === "frackingSatellite");
    expect(satellite).toMatchObject({
      type: "Nitrogen Gas",
      purity: "pure",
      exploited: false,
      x: Math.round(212492.40625 / 100),
      y: Math.round(138086.90625 / 100),
    });
  });

  // frm-getTrains-2026-09-27-full.json and frm-getTrainStation-2026-09-27-full.json.
  it("mapLive: recomputing the train's and both stations' x/y matches the fixture exactly", () => {
    const train = fixtures.mapLiveSample.trains[0];
    expect([train.x, train.y]).toEqual([Math.round(-102587.95567750931 / 100), Math.round(-147300 / 100)]);
    const [station1, station2] = fixtures.mapLiveSample.stations;
    expect([station1.x, station1.y]).toEqual([Math.round(-104300 / 100), Math.round(-147300 / 100)]);
    expect([station2.x, station2.y]).toEqual([Math.round(-195200 / 100), Math.round(-114400 / 100)]);
  });

  it("purity values are the raw capture's Purity field lowercased (with the game's 'Inpure' typo corrected to 'impure'), not EnumPurity lowercased as the .describe() text implies", () => {
    // EnumPurity's actual raw values are RP_Normal/RP_Inpure/RP_Pure; lowercasing THOSE directly would give
    // "rp_normal"/"rp_inpure"/"rp_pure", which is not what any fixture contains. The fixtures instead match the
    // raw Purity field ("Normal"/"Impure"/"Pure" -> lowercased), which is a different (and correct) source field
    // from the one the schema's .describe() comment names. This is a documentation nit, not a schema defect:
    // `purity` is a plain string, so any real mapper's actual output still parses either way.
    const purities = fixtures.resourceNodesSample.data.map((n) => n.purity);
    expect(purities).toEqual(["normal", "impure", "pure", "normal", "normal", "pure", "pure"]);
    expect(purities).not.toContain("rp_normal");
  });
});
