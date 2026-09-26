import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  ApiErrorResponseSchema,
  HistoryItemsResponseSchema,
  HistoryPowerResponseSchema,
  HistoryTransitionsResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { historyItems7d, historyPower24h, historyTransitions24h } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters } from "../index.js";
import type { TelemetryServices } from "../telemetryServices.js";

// ADR-0027 decision 3: the history routes (the SQL is covered by the service tests and the real-Postgres test).

function build(history: TelemetryServices["history"]) {
  const telemetry = { history } as unknown as TelemetryServices;
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { telemetry } }]);
  return createApp({ logger: createLogger({ level: "silent" }), routers: createTelemetryRouters(directory) });
}

const service = () => ({
  power: vi.fn(async () => historyPower24h.data),
  items: vi.fn(async () => historyItems7d.data),
  transitions: vi.fn(async () => historyTransitions24h.data),
});

describe("GET /api/servers/:serverId/history/*", () => {
  it("power: a bare GET uses the 24h default, and the response matches the contract", async () => {
    const history = service();
    const res = await request(build(history)).get(endpoints.history.power.path("default"));
    expect(res.status).toBe(200);
    expect(HistoryPowerResponseSchema.parse(res.body).serverId).toBe("default");
    expect(history.power).toHaveBeenCalledWith("24h");
  });

  it("power: passes the requested range", async () => {
    const history = service();
    await request(build(history)).get(`${endpoints.history.power.path("default")}?range=1y`);
    expect(history.power).toHaveBeenCalledWith("1y");
  });

  it("items: the range and an optional item reach the service", async () => {
    const history = service();
    const app = build(history);
    const all = await request(app).get(endpoints.history.items.path("default"));
    expect(all.status).toBe(200);
    expect(HistoryItemsResponseSchema.safeParse(all.body).success).toBe(true);
    expect(history.items).toHaveBeenLastCalledWith("24h", undefined);
    await request(app).get(`${endpoints.history.items.path("default")}?range=7d&item=Desc_IronPlate_C`);
    expect(history.items).toHaveBeenLastCalledWith("7d", "Desc_IronPlate_C");
  });

  it("transitions: defaults to 24h and a limit of 100, and takes both from the query", async () => {
    const history = service();
    const app = build(history);
    const res = await request(app).get(endpoints.history.transitions.path("default"));
    expect(res.status).toBe(200);
    expect(HistoryTransitionsResponseSchema.safeParse(res.body).success).toBe(true);
    expect(history.transitions).toHaveBeenLastCalledWith("24h", 100);
    await request(app).get(`${endpoints.history.transitions.path("default")}?range=30d&limit=500`);
    expect(history.transitions).toHaveBeenLastCalledWith("30d", 500);
  });

  it.each([
    ["power", "?range=2h"],
    ["power", "?range=1H"],
    ["power", "?range=1h&range=6h"],
    ["items", "?range=bogus"],
    ["items", `?item=${"x".repeat(201)}`],
    ["items", "?item="],
    ["transitions", "?range=1y"], // transitions are kept 30 days
    ["transitions", "?limit=501"],
    ["transitions", "?limit=0"],
    ["transitions", "?limit=abc"],
    ["transitions", "?limit=1.5"],
  ] as const)("%s %s is a 400 that names the parameter and never calls the service", async (name, query) => {
    const history = service();
    const res = await request(build(history)).get(`${endpoints.history[name].path("default")}${query}`);
    expect(res.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
    expect(res.body.error.message).toMatch(/^Invalid query parameter: (range|item|limit)$/);
    expect(history.power).not.toHaveBeenCalled();
    expect(history.items).not.toHaveBeenCalled();
    expect(history.transitions).not.toHaveBeenCalled();
  });

  it("ignores parameters it does not know (and a bracketed key is just another unknown key)", async () => {
    const history = service();
    const res = await request(build(history)).get(`${endpoints.history.power.path("default")}?range[]=1h&foo=bar`);
    expect(res.status).toBe(200);
    expect(history.power).toHaveBeenCalledWith("24h");
  });

  it("never echoes a bad value back", async () => {
    const res = await request(build(service())).get(`${endpoints.history.power.path("default")}?range=SECRET-value`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("SECRET");
  });

  it.each(["power", "items", "transitions"] as const)("%s is a 503 service_unavailable without a database (no history service)", async (name) => {
    const res = await request(build(undefined)).get(endpoints.history[name].path("default"));
    expect(res.status).toBe(503);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("service_unavailable");
  });

  it("a service that fails is a 503, not a hang or a 500", async () => {
    const { ServiceUnavailableError } = await import("../../../platform/errorResponse.js");
    const history = service();
    history.power.mockRejectedValueOnce(new ServiceUnavailableError());
    const res = await request(build(history)).get(endpoints.history.power.path("default"));
    expect(res.status).toBe(503);
  });

  it("an unknown server is the usual 404", async () => {
    const res = await request(build(service())).get(endpoints.history.power.path("nope"));
    expect(res.status).toBe(404);
  });
});
