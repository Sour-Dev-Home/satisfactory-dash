import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import request from "supertest";
import type { RequestHandler } from "express";
import { ManagedServerListResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { Mutex } from "../../platform/mutex.js";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { addMember, getMemberRole } from "./repositories/memberRepository.js";
import { findServerByPublicId, switchToAgentConnection, upsertConfiguredServer } from "./repositories/serverRepository.js";
import { createServerManagementRouters } from "./serverManagementRouter.js";
import { createServerManagementService } from "./serverManagement.js";
import { ServerRuntime } from "./serverRuntime.js";

const available = dbTestsAvailable();

// ADR-0066 build PR 5, as satis_app against a real Postgres: every server is reached through the mod. The operator lists,
// renames and removes them; the direct-poll routes answer 410 and write nothing.
describe.skipIf(!available)("server management against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let operatorId: string;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    operatorId = (await createUser(pool, { displayName: "operator" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** An operator-created agent server, owned by the operator, with a running entry. */
  const agentServer = async (runtime: ServerRuntime<string>) => {
    const publicId = `sm-${++counter}`;
    const server = await upsertConfiguredServer(pool, { publicId, displayName: `Name ${publicId}` });
    await switchToAgentConnection(pool, server.id);
    await addMember(pool, { serverId: server.id, userId: operatorId, role: "owner", actorUserId: null });
    runtime.add({ id: publicId, displayName: `Name ${publicId}`, services: "agent", workers: [], kind: "agent" });
    return { publicId, id: server.id };
  };

  const appWith = (runtime: ServerRuntime<string>) => {
    const service = createServerManagementService({ db: pool, runtime, getOperatorUserId: () => operatorId, mutex: new Mutex() });
    const guard: RequestHandler = (_req, res, next) => {
      res.locals.user = { id: operatorId, name: "operator" };
      next();
    };
    const management = createServerManagementRouters(service, {});
    return createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      routers: [],
      sessionGuard: guard,
      protectedRouters: [management.collection, management.scoped],
    });
  };

  it("the managed list sends `servers: []` and the operator's agent servers", async () => {
    const runtime = new ServerRuntime<string>();
    const { publicId } = await agentServer(runtime);
    const res = await request(appWith(runtime)).get("/api/servers/managed");
    expect(res.status).toBe(200);
    const body = ManagedServerListResponseSchema.parse(res.body);
    expect(body.servers).toEqual([]);
    expect(body.agentServers).toContainEqual({ id: publicId, displayName: `Name ${publicId}`, kind: "agent" });
  });

  it("removes an agent server (it has no stored connection): soft-deleted, its members gone, its entry stopped", async () => {
    const runtime = new ServerRuntime<string>();
    const { publicId } = await agentServer(runtime);
    const app = appWith(runtime);
    expect((await request(app).delete(`/api/servers/${publicId}`)).body).toEqual({ deleted: true });
    expect(await findServerByPublicId(pool, publicId)).toBeUndefined();
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBeUndefined();
    expect(runtime.has(publicId)).toBe(false);
    expect((await request(app).delete(`/api/servers/${publicId}`)).status).toBe(404);
  });

  it("the direct-poll routes answer 410 and write nothing", async () => {
    const runtime = new ServerRuntime<string>();
    const { publicId, id } = await agentServer(runtime);
    const app = appWith(runtime);
    const body = JSON.stringify({ id: "sm-new", displayName: "New", host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234" });
    const answers = [
      await request(app).post("/api/servers").set("Content-Type", "application/json").send(body),
      await request(app).post("/api/servers/test-connection").set("Content-Type", "application/json").send(body),
      await request(app).get(`/api/servers/${publicId}/connection`),
      await request(app).patch(`/api/servers/${publicId}`).set("Content-Type", "application/json").send(JSON.stringify({ displayName: "X" })),
      await request(app).post(`/api/servers/${publicId}/test-connection`),
      await request(app).post(`/api/servers/${publicId}/local-connection`).set("Content-Type", "application/json").send(body),
    ];
    expect(answers.map((res) => res.status)).toEqual([410, 410, 410, 410, 410, 410]);
    expect(await findServerByPublicId(pool, "sm-new")).toBeUndefined();
    expect((await pool.query("SELECT connection_kind, display_name FROM servers.servers WHERE id = $1", [id])).rows).toEqual([
      { connection_kind: "agent", display_name: `Name ${publicId}` },
    ]);
    expect((await pool.query("SELECT 1 FROM servers.server_connections WHERE server_id = $1", [id])).rowCount).toBe(0);
  });
});
