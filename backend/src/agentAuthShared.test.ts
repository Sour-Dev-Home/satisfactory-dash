import { describe, expect, it } from "vitest";
import request from "supertest";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { UserRateLimiter } from "./platform/userRateLimiter.js";
import { createAgentApiRouters, createAgentAuth } from "./modules/agents/index.js";
import { createAgentWorldRouter } from "./modules/map/index.js";

/** #562: server.ts builds ONE createAgentAuth and hands it to both the agent API and the world-layer routes, so a
 *  failure on either spends the same budget. This wires them the same way, with a tiny process-wide budget. */
function build() {
  const db = { query: async () => ({ rows: [] }) };
  const auth = createAgentAuth({
    db,
    limiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }),
    globalLimiter: new UserRateLimiter({ max: 3, windowMs: 60_000 }),
  });
  const agentRouters = [
    // Nothing past the auth step is reached by an unknown credential, so the rest are stand-ins.
    ...createAgentApiRouters({
      db: db as never,
      logger: createLogger({ level: "silent" }),
      commands: {} as never,
      directory: {} as never,
      attachAgentRuntime: async () => undefined,
      auth,
    }),
    createAgentWorldRouter({ auth, ingest: { ingest: async () => ({ accepted: true, unchanged: false }) } }),
  ];
  return createApp({ logger: createLogger({ level: "silent" }), routers: [], agentRouters });
}

const junk = `Bearer ${"A".repeat(43)}`;

describe("one agent-auth budget for the agent API and the world layers (#562)", () => {
  it("failures on the world-layer route use up the agent API's process-wide budget", async () => {
    const app = build();
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(endpoints.agentApi.world.path("rails")).set("Authorization", junk).send({});
      expect(res.status).toBe(401);
    }
    const res = await request(app).get(endpoints.agentApi.commands.path()).set("Authorization", junk);
    expect(res.status).toBe(429);
  });

  it("and the other way round", async () => {
    const app = build();
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get(endpoints.agentApi.commands.path()).set("Authorization", junk)).status).toBe(401);
    }
    const res = await request(app).post(endpoints.agentApi.world.path("rails")).set("Authorization", junk).send({});
    expect(res.status).toBe(429);
  });
});
