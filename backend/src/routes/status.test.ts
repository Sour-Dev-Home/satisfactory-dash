import { describe, it, expect } from "vitest";
import request from "supertest";
import { createStatusRouter } from "./status.js";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { UpstreamError } from "../adapters/index.js";
import type { ServerStatusService } from "../services/serverStatusService.js";

function buildApp(service: Pick<ServerStatusService, "getStatus">) {
  return createApp({ logger: createLogger(), routers: [createStatusRouter(service as ServerStatusService)] });
}

describe("GET /api/status", () => {
  it("returns the service's status on success", async () => {
    const service = {
      getStatus: async () => ({
        healthy: true,
        isGameRunning: true,
        isPaused: false,
        sessionName: "save",
        connectedPlayers: 1,
        playerLimit: 4,
        tickRate: 30,
        totalGameDurationSeconds: 10,
      }),
    };
    const res = await request(buildApp(service)).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body.sessionName).toBe("save");
  });

  it("returns 503 upstream_unreachable when the game server can't be reached", async () => {
    const service = {
      getStatus: async () => {
        throw new UpstreamError("server unreachable", { failureKind: "unreachable" });
      },
    };
    const res = await request(buildApp(service)).get("/api/status");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
  });

  // A reachable-but-slow server (vanilla API HealthCheck's "slow" state, per
  // docs-vault/raw-sources/dedicated-server-api.md) resolves with `healthy: false`
  // rather than rejecting. The route must still return 200 with that flag embedded,
  // not 503 — 503 is reserved for the adapter call actually failing/throwing.
  it("returns 200 with healthy: false when the server is reachable but reports unhealthy", async () => {
    const service = {
      getStatus: async () => ({
        healthy: false,
        isGameRunning: true,
        isPaused: false,
        sessionName: "save",
        connectedPlayers: 1,
        playerLimit: 4,
        tickRate: 4,
        totalGameDurationSeconds: 10,
      }),
    };
    const res = await request(buildApp(service)).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body.healthy).toBe(false);
  });
});
