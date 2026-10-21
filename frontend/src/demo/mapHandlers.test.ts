import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endpoints,
  MAP_WORLD_LAYER_DATA_SCHEMAS,
  MapWorldLayerResponseSchema,
  RailsWorldLayerResponseSchema,
  ResourceNodesWorldLayerResponseSchema,
  worldLayerResponseSchema,
} from "@satisfactory-dash/shared";
import { resetDemoState } from "./handlers";
import { transport } from "./transport";
import { DEMO_EPOCH, DEMO_SERVER_ID, railsWorld, resourceNodesWorld } from "./world";

// ADR-0038 M5: the demo answers the map's world layers from its own made-up world (world.ts), through
// the same transport the page uses, and never touches the network.

const call = (path: string) => transport(path, { method: "GET", credentials: "include" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  resetDemoState();
  fetchSpy = vi.fn(() => Promise.reject(new Error("the demo must not use the network")));
  vi.stubGlobal("fetch", fetchSpy);
  await transport(endpoints.auth.login.path(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("the demo's map world layers", () => {
  it("serves rails that satisfy the contract, with at least one segment", async () => {
    const res = await call(endpoints.map.worldLayer.path(DEMO_SERVER_ID, "rails"));
    expect(res.status).toBe(200);
    const body = RailsWorldLayerResponseSchema.parse(await res.json());
    expect(body.layer).toBe("rails");
    expect(body.count).toBe(body.data.length);
    expect(body.data.length).toBeGreaterThan(0);
    expect(() => MapWorldLayerResponseSchema.parse(body)).not.toThrow();
  });

  it("serves resource nodes of more than one resource, kind and purity, some in use", async () => {
    const res = await call(endpoints.map.worldLayer.path(DEMO_SERVER_ID, "resourceNodes"));
    const body = ResourceNodesWorldLayerResponseSchema.parse(await res.json());
    expect(new Set(body.data.map((n) => n.type)).size).toBeGreaterThan(3);
    expect(new Set(body.data.map((n) => n.nodeType)).size).toBeGreaterThan(1);
    expect(new Set(body.data.map((n) => n.purity)).size).toBe(3);
    expect(body.data.some((n) => n.exploited)).toBe(true);
    expect(body.data.some((n) => !n.exploited)).toBe(true);
  });

  it("is a 404 for a layer the demo doesn't have, and a 401 when signed out", async () => {
    expect((await call(endpoints.map.worldLayer.path(DEMO_SERVER_ID, "belts"))).status).toBe(404);
    resetDemoState();
    expect((await call(endpoints.map.worldLayer.path(DEMO_SERVER_ID, "rails"))).status).toBe(401);
  });

  it("keeps its rails and nodes within whole metres of the contract at any time", () => {
    for (const now of [DEMO_EPOCH, Date.now()]) {
      expect(() => worldLayerResponseSchema(MAP_WORLD_LAYER_DATA_SCHEMAS.rails).parse(railsWorld(now))).not.toThrow();
      expect(() => worldLayerResponseSchema(MAP_WORLD_LAYER_DATA_SCHEMAS.resourceNodes).parse(resourceNodesWorld(now))).not.toThrow();
    }
  });
});
