import { EventEmitter } from "node:events";
import type { RequestHandler } from "express";
import request from "supertest";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { createAgentsService } from "../services/agentsService.js";
import { createAgentUserRouter } from "./agentUser.js";

const SERVER_UUID = "11111111-1111-4111-8111-111111111111";
const URL = "/api/servers/alpha/agent/enrollment-codes";

function fakePool() {
  const client = Object.assign(new EventEmitter(), {
    async query(text: string) {
      if (text.includes("FOR NO KEY UPDATE")) return { rows: [{ id: SERVER_UUID, connection_kind: "agent" }] };
      if (text.includes("INSERT INTO agents.enrollment_codes")) return { rows: [{ id: "c1" }] };
      if (text.includes("INSERT INTO audit.audit_events")) return { rows: [{ id: 1, at: new Date(), actor_user_id: null, server_id: SERVER_UUID, action: "x", detail: {} }] };
      return { rows: [] };
    },
    release() {},
  }) as unknown as PoolClient;
  return { connect: async () => client, query: client.query.bind(client) } as never;
}

function build(codesPerHour: number, operator: string | undefined) {
  const clock = { t: 1_000_000 };
  const asUser: RequestHandler = (req, res, next) => {
    res.locals.user = { id: String(req.header("x-test-user")) };
    next();
  };
  const service = createAgentsService({ db: fakePool(), canManage: (id) => id === operator, codesPerHour, now: () => clock.t });
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [asUser as never, createAgentUserRouter(service, { getCommand: async () => { throw new Error("unused"); } })],
  });
  return { app, clock };
}

describe("POST /api/servers/:serverId/agent/enrollment-codes, hourly limit (ADR-0046 C7)", () => {
  it("answers 201 up to the hourly cap, then 429 with Retry-After and a message that holds no code or account id", async () => {
    const { app, clock } = build(3, undefined);
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post(URL).set("x-test-user", "user-secret-id").send({});
      expect(ok.status).toBe(201);
      clock.t += 7_000;
    }
    const refused = await request(app).post(URL).set("x-test-user", "user-secret-id").send({});
    expect(refused.status).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(60);
    expect(JSON.stringify(refused.body)).toMatch(/this hour/);
    expect(JSON.stringify(refused.body)).not.toContain("user-secret-id");
    // Another account is not affected.
    expect((await request(app).post(URL).set("x-test-user", "someone-else").send({})).status).toBe(201);
  });

  it("the operator is not refused by the hourly cap", async () => {
    const { app, clock } = build(1, "boss");
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post(URL).set("x-test-user", "boss").send({})).status).toBe(201);
      clock.t += 7_000;
    }
  });
});
