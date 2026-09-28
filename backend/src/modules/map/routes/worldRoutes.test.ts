import { describe, expect, it } from "vitest";
import request from "supertest";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createWorldRoutes } from "./worldRoutes.js";
import { MapLiveStore } from "../services/mapLiveStore.js";

function fakeDb(rows: unknown[] = []) {
  return { query: (_text: string, _values?: unknown[]) => Promise.resolve({ rows }) };
}

function build(deps?: { db?: ReturnType<typeof fakeDb>; mapLive?: MapLiveStore }) {
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: {} }]);
  const routes = createWorldRoutes(directory, deps && { db: deps.db ?? fakeDb(), mapLive: deps.mapLive ?? new MapLiveStore() });
  return createApp({ logger: createLogger({ level: "silent" }), routers: [routes] });
}

const railsRow = { hash: "abc123", observed_at: "2026-09-28T00:00:00.000Z", truncated: false, count: 1, data: [{ id: "r1", points: [[0, 0], [1, 1]] }] };

describe("GET /api/servers/:serverId/map/world/:layer", () => {
  it("an unregistered server id is a 404 (same code the membership check would give a non-member)", async () => {
    const res = await request(build({ db: fakeDb([railsRow]) })).get(endpoints.map.worldLayer.path("no-such-server", "rails"));
    expect(res.status).toBe(404);
  });

  it("an unknown layer is a 404", async () => {
    const res = await request(build({ db: fakeDb([railsRow]) })).get(endpoints.map.worldLayer.path("default", "belts"));
    expect(res.status).toBe(404);
  });

  it("without a database, both routes are 503", async () => {
    const res = await request(build()).get(endpoints.map.worldLayer.path("default", "rails"));
    expect(res.status).toBe(503);
  });

  it("no row yet: 200, a synthetic empty response, still a real ETag", async () => {
    const res = await request(build({ db: fakeDb([]) })).get(endpoints.map.worldLayer.path("default", "rails"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ layer: "rails", truncated: false, count: 0, data: [] });
    expect(res.headers.etag).toBeTruthy();
  });

  it("a stored row is served as-is, including truncated:true", async () => {
    const res = await request(build({ db: fakeDb([{ ...railsRow, truncated: true }]) })).get(endpoints.map.worldLayer.path("default", "rails"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ layer: "rails", hash: "abc123", truncated: true, count: 1, data: railsRow.data });
    expect(res.headers.etag).toBe('"abc123"');
  });

  it("a matching If-None-Match is a bare 304, no body", async () => {
    const app = build({ db: fakeDb([railsRow]) });
    const res = await request(app).get(endpoints.map.worldLayer.path("default", "rails")).set("If-None-Match", '"abc123"');
    expect(res.status).toBe(304);
    expect(res.text).toBe("");
  });

  it("a stale If-None-Match still gets the full body", async () => {
    const res = await request(build({ db: fakeDb([railsRow]) })).get(endpoints.map.worldLayer.path("default", "rails")).set("If-None-Match", '"old-hash"');
    expect(res.status).toBe(200);
  });
});

describe("GET /api/servers/:serverId/map/live", () => {
  it("an unregistered server id is a 404", async () => {
    const res = await request(build()).get(endpoints.map.live.path("no-such-server"));
    expect(res.status).toBe(404);
  });

  it("no reading yet: 200 with empty trains/stations", async () => {
    const res = await request(build({ mapLive: new MapLiveStore() })).get(endpoints.map.live.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ trains: [], stations: [] });
  });

  it("serves the latest recorded reading", async () => {
    const mapLive = new MapLiveStore();
    mapLive.record("default", { trains: [{ id: "t1", name: "Train", x: 1, y: 2, status: "Self-Driving" }], stations: [] }, 1_700_000_000_000);
    const res = await request(build({ mapLive })).get(endpoints.map.live.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data.trains).toEqual([{ id: "t1", name: "Train", x: 1, y: 2, status: "Self-Driving" }]);
    expect(res.body.observedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  // Found by test-hunter (PR #374): unlike the world-layer ingest path (WorldIngestService
  // re-validates every item, "conform, don't reject"), nothing validated a mapLive reading before
  // MapLiveStore.record() stored it — a train name over MapTrainSchema's 200-char bound (which the
  // game-adapter's trainsMapper.ts only checks for coordinate bounds, never string length) would be
  // stored as-is, and this route's own `sendValidated` would then throw for every later caller,
  // turning one bad reading into a persistent 500. Fixed in MapLiveStore.record() itself (conforms
  // both the local-poller and, as defense in depth, the already-validated agent path).
  it("an overlong train name recorded by the local poller is dropped, not stored, so later reads stay healthy", async () => {
    const mapLive = new MapLiveStore();
    mapLive.record("default", { trains: [{ id: "t1", name: "x".repeat(300), x: 1, y: 2, status: "Self-Driving" }], stations: [] }, 1_700_000_000_000);
    const res = await request(build({ mapLive })).get(endpoints.map.live.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data.trains).toEqual([]); // the whole reading is kept; only the bad train is dropped
  });
});
