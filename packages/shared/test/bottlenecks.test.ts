import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  BOTTLENECKS_DEFAULT_LIMIT,
  BOTTLENECKS_MAX_LIMIT,
  BOTTLENECK_CHAIN_MAX_STEPS,
  BottleneckCappedBySchema,
  BottleneckFixSchema,
  BottleneckMachineSchema,
  BottleneckSchema,
  BottleneckStepSchema,
  BottlenecksQuerySchema,
  BottlenecksResponseSchema,
  BottlenecksSchema,
  BottleneckNoteSchema,
  KNOWN_BOTTLENECK_NOTE_CODES,
  KNOWN_BOTTLENECK_STEP_KINDS,
  endpoints,
} from "../src/index";

// Maintained by hand (shared never imports backend): every note `code` the backend emits, from
// backend/src/modules/telemetry/services/{bottleneckFinder,productionGraph,logisticsEdges}.ts. A new backend note
// adds its code here and to KNOWN_BOTTLENECK_NOTE_CODES with a one-line meaning.
const BACKEND_EMITTED_NOTE_CODES = [
  "connectionsRefresh",
  "updateFrm",
  "beltDataTooLarge",
  "beltDataNotReceived",
  "unmatchedLinks",
  "graphTruncated",
  "duplicateStationName",
  "unknownTimetableStop",
];

describe("KNOWN_BOTTLENECK_NOTE_CODES", () => {
  it("names exactly the note codes the backend emits", () => {
    expect([...KNOWN_BOTTLENECK_NOTE_CODES].sort()).toEqual([...BACKEND_EMITTED_NOTE_CODES].sort());
  });

  it("has no duplicates, and every code fits the schema", () => {
    expect(new Set(KNOWN_BOTTLENECK_NOTE_CODES).size).toBe(KNOWN_BOTTLENECK_NOTE_CODES.length);
    for (const code of KNOWN_BOTTLENECK_NOTE_CODES) expect(BottleneckNoteSchema.safeParse({ code, text: "x" }).success).toBe(true);
  });

  it("keeps `code` a free string, so an unknown code still parses", () => {
    expect(BottleneckNoteSchema.safeParse({ code: "someFutureNote", text: "x" }).success).toBe(true);
  });
});

// ADR-0048 and its amendment, Decision 4.
const finding = fixtures.bottlenecksBeltLevel.data.findings[0]!;
const cappedBy = finding.rootCause.cappedBy!;

describe("bottlenecks endpoint", () => {
  it("is GET /api/servers/:serverId/bottlenecks with the limit query and the enveloped response", () => {
    expect(endpoints.bottlenecks.method).toBe("GET");
    expect(endpoints.bottlenecks.route).toBe("/api/servers/:serverId/bottlenecks");
    expect(endpoints.bottlenecks.path("a/b")).toBe("/api/servers/a%2Fb/bottlenecks");
    expect(endpoints.bottlenecks.query).toBe(BottlenecksQuerySchema);
    expect(endpoints.bottlenecks.response).toBe(BottlenecksResponseSchema);
  });

  it("limit defaults to 10 (the Factory page's top 10), coerces the query string, and allows 1 to 50", () => {
    expect(BOTTLENECKS_DEFAULT_LIMIT).toBe(10);
    expect(BottlenecksQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(BottlenecksQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(BottlenecksQuerySchema.safeParse({ limit: "1" }).success).toBe(true);
    expect(BottlenecksQuerySchema.safeParse({ limit: String(BOTTLENECKS_MAX_LIMIT) }).success).toBe(true);
    for (const bad of ["0", "51", "2.5", "ten", "-1"]) {
      expect(BottlenecksQuerySchema.safeParse({ limit: bad }).success, bad).toBe(false);
    }
  });
});

describe("BottleneckStepSchema", () => {
  it("lists the amendment's verdicts, notConnected included", () => {
    for (const kind of ["noProducer", "notConnected", "deficit", "upstream", "logistics"]) {
      expect(KNOWN_BOTTLENECK_STEP_KINDS).toContain(kind);
    }
  });

  it("parses an unknown kind (deploy skew: the client shows the text only), but not an empty or unbounded one", () => {
    expect(BottleneckStepSchema.safeParse({ kind: "somethingNew" }).success).toBe(true);
    expect(BottleneckStepSchema.safeParse({ kind: "" }).success).toBe(false);
    expect(BottleneckStepSchema.safeParse({ kind: "x".repeat(41) }).success).toBe(false);
  });

  it("cappedBy is optional, and a cut always has a capacity (never null, unlike a conveyor edge's)", () => {
    expect(BottleneckStepSchema.safeParse({ kind: "logistics" }).success).toBe(true);
    expect(BottleneckCappedBySchema.safeParse({ ...cappedBy, capacityPerMinute: null }).success).toBe(false);
    expect(BottleneckCappedBySchema.safeParse({ ...cappedBy, capacityPerMinute: -1 }).success).toBe(false);
    expect(BottleneckCappedBySchema.safeParse({ ...cappedBy, toId: null }).success).toBe(true);
    expect(BottleneckCappedBySchema.safeParse({ ...cappedBy, kind: "cable" }).success).toBe(false);
  });

  it("rejects a negative rate", () => {
    expect(BottleneckStepSchema.safeParse({ kind: "deficit", supplyMaxPerMinute: -1 }).success).toBe(false);
  });
});

describe("BottleneckSchema and BottlenecksSchema", () => {
  it("caps the chain at 8 steps and the findings at 50", () => {
    const step = { kind: "upstream" };
    expect(BottleneckSchema.safeParse({ ...finding, chain: Array(BOTTLENECK_CHAIN_MAX_STEPS).fill(step) }).success).toBe(true);
    expect(BottleneckSchema.safeParse({ ...finding, chain: Array(BOTTLENECK_CHAIN_MAX_STEPS + 1).fill(step) }).success).toBe(false);
    const data = fixtures.bottlenecksBeltLevel.data;
    expect(BottlenecksSchema.safeParse({ ...data, findings: Array(BOTTLENECKS_MAX_LIMIT).fill(finding) }).success).toBe(true);
    expect(BottlenecksSchema.safeParse({ ...data, findings: Array(BOTTLENECKS_MAX_LIMIT + 1).fill(finding) }).success).toBe(false);
  });

  it("a finding is only ever for an underfed or backed-up machine", () => {
    expect(BottleneckSchema.safeParse({ ...finding, state: "unpowered" }).success).toBe(false);
  });

  it("beltData names the mode that ran; an unknown mode is refused", () => {
    const data = fixtures.bottlenecksBeltLevel.data;
    for (const mode of ["present", "stale", "unsupported", "tooLarge"]) {
      expect(BottlenecksSchema.safeParse({ ...data, beltData: mode }).success, mode).toBe(true);
    }
    expect(BottlenecksSchema.safeParse({ ...data, beltData: "partial" }).success).toBe(false);
  });

  it("carries the owner's two notes: the 10-minute refresh and, on an older FRM, item level with update-FRM", () => {
    expect(fixtures.bottlenecksBeltLevel.data.connectionsRefreshMinutes).toBe(10);
    expect(fixtures.bottlenecksBeltLevel.data.notes.map((n) => n.code)).toEqual(["connectionsRefresh"]);
    expect(fixtures.bottlenecksItemLevelOldFrm.data.beltData).toBe("unsupported");
    expect(fixtures.bottlenecksItemLevelOldFrm.data.notes.map((n) => n.code)).toEqual(["updateFrm"]);
    const data = fixtures.bottlenecksBeltLevel.data;
    expect(BottlenecksSchema.safeParse({ ...data, connectionsRefreshMinutes: 0 }).success).toBe(false);
    expect(BottlenecksSchema.safeParse({ ...data, notes: [{ code: "connectionsRefresh", text: "" }] }).success).toBe(false);
  });
});

describe("bottleneck fixtures agree with the conveyors fixture they cite", () => {
  it("every cappedBy matches a conveyorsSample edge's kind, tier, capacity, ends and position", () => {
    const edges = new Map(fixtures.conveyorsSample.data.map((e) => [e.id, e]));
    const cuts = fixtures.bottlenecksBeltLevel.data.findings.flatMap((f) => (f.rootCause.cappedBy ? [f.rootCause.cappedBy] : []));
    expect(cuts).toHaveLength(2);
    for (const cut of cuts) {
      const edge = edges.get(cut.conveyorId);
      expect(edge, cut.conveyorId).toBeDefined();
      expect(cut).toEqual({
        conveyorId: edge!.id,
        kind: edge!.kind,
        tier: edge!.tier,
        capacityPerMinute: edge!.capacityPerMinute,
        fromId: edge!.from,
        toId: edge!.to,
        at: edge!.at,
      });
    }
  });
});

describe("BottleneckFixSchema and BottleneckMachineSchema bounds (fresh eyes, #592)", () => {
  const fix = { producerName: "Smelter", recipe: null, perMachinePerMinute: 30, machines: 1 };
  it("fix.machines is an integer from 1 to 100,000; perMachinePerMinute is finite and positive", () => {
    expect(BottleneckFixSchema.safeParse(fix).success).toBe(true);
    expect(BottleneckFixSchema.safeParse({ ...fix, machines: 100_000 }).success).toBe(true);
    for (const machines of [0, 100_001, 1.5, Number.NaN]) expect(BottleneckFixSchema.safeParse({ ...fix, machines }).success).toBe(false);
    for (const perMachinePerMinute of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(BottleneckFixSchema.safeParse({ ...fix, perMachinePerMinute }).success).toBe(false);
    }
  });
  it("a machine's position is whole metres within 1,000,000, and optional", () => {
    const m = { buildingId: "a", buildingName: "n", recipe: null };
    expect(BottleneckMachineSchema.safeParse(m).success).toBe(true);
    expect(BottleneckMachineSchema.safeParse({ ...m, at: { x: -1_000_000, y: 1_000_000 } }).success).toBe(true);
    expect(BottleneckMachineSchema.safeParse({ ...m, at: { x: 1_000_001, y: 0 } }).success).toBe(false);
    expect(BottleneckMachineSchema.safeParse({ ...m, at: { x: 1.5, y: 0 } }).success).toBe(false);
  });
  it("affected holds at most 50 machines and affectedCount is at least 1", () => {
    const m = { buildingId: "a", buildingName: "n", recipe: null };
    expect(BottleneckSchema.safeParse({ ...finding, affected: Array.from({ length: 50 }, () => m) }).success).toBe(true);
    expect(BottleneckSchema.safeParse({ ...finding, affected: Array.from({ length: 51 }, () => m) }).success).toBe(false);
    expect(BottleneckSchema.safeParse({ ...finding, affectedCount: 0 }).success).toBe(false);
  });
});
