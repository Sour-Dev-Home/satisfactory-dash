import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ApiFailure } from "../../platform/errorResponse.js";
import { createLogger } from "../../platform/logger.js";
import { Mutex } from "../../platform/mutex.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { findActiveAgent, sha256 } from "../agents/repositories/agentRepository.js";
import { createAgentsService } from "../agents/services/agentsService.js";
import { createCommandsService } from "../agents/services/commandsService.js";
import { CommandNotifier } from "../agents/services/commandNotifier.js";
import { createEnrollmentService } from "../agents/services/enrollmentService.js";
import { releaseAgentServer } from "../agents/services/releaseAgent.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { getConnection } from "./repositories/connectionRepository.js";
import { addMember, getMemberRole } from "./repositories/memberRepository.js";
import { findServerByPublicId, upsertConfiguredServer } from "./repositories/serverRepository.js";
import { createServerManagementService } from "./serverManagement.js";
import { ServerRuntime } from "./serverRuntime.js";

const available = dbTestsAvailable();
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const API = "api-token-abcdefgh1234";
const FRM = "frm-token-abcdefgh5678";
const passed = { ok: true, api: { ok: true }, frm: { ok: true } };
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const silent = createLogger({ level: "silent" }, { write: () => {} });
const body = { host: "localhost", apiPort: 7777, frmPort: 8080, apiToken: API, frmToken: FRM };
const codeOf = async (work: Promise<unknown>): Promise<string> => work.then(() => "resolved", (err: unknown) => (err instanceof ApiFailure ? err.code : String(err)));

// ADR-0031 amendment ("Rollback: switch back to local") against a real Postgres, as satis_app: an agent server becomes a server this
// backend reads itself again, in ONE transaction, keeping its members and history and letting go of everything of the agent.
describe.skipIf(!available)("switching an agent server back to local, against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let operatorId: string;
  let counter = 0;
  let runtime: ServerRuntime<string>;
  let service: ReturnType<typeof createServerManagementService<string>>;
  let agents: ReturnType<typeof createAgentsService>;
  let enrollment: ReturnType<typeof createEnrollmentService>;
  let commands: ReturnType<typeof createCommandsService>;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    operatorId = (await createUser(pool, { displayName: "operator" })).id;
    runtime = new ServerRuntime<string>();
    service = createServerManagementService({
      db: pool,
      ring,
      runtime,
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: "polled", workers: [] }),
      testConnection: async () => passed,
      getOperatorUserId: () => operatorId,
      lookup: async () => ["127.0.0.1"],
      mutex: new Mutex(),
      releaseAgent: releaseAgentServer,
    });
    agents = createAgentsService({ db: pool, canManage: () => true });
    enrollment = createEnrollmentService({ db: pool, cadence: () => CADENCE, logger: silent, attachAgentRuntime: async () => undefined });
    commands = createCommandsService({ db: pool, notifier: new CommandNotifier() });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  /** An enrolled agent server with an owner, some history and a waiting command. Returns what the tests need to look at afterwards. */
  async function newAgentServer() {
    const server = await upsertConfiguredServer(pool, { publicId: `sw-${++counter}`, displayName: `Switch ${counter}` });
    await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [server.id]);
    await addMember(pool, { serverId: server.id, userId: operatorId, role: "owner", actorUserId: null });
    const enrolled = await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, operatorId)).code, "0.1.0");
    await admin.query("INSERT INTO telemetry.item_samples (server_id, item, at, current_per_min, max_per_min) VALUES ($1, 'Desc_IronPlate_C', now(), 10, 20)", [server.id]);
    const command = await commands.requestAutoPause(server.publicId, true, operatorId);
    runtime.add({ id: server.publicId, displayName: server.displayName, services: "agent", workers: [], kind: "agent" });
    return { server, secret: enrolled.agentSecret, commandId: command.id };
  }
  const kindOf = async (publicId: string) => (await findServerByPublicId(pool, publicId))?.connectionKind;
  const historyRows = async (serverUuid: string) => (await admin.query("SELECT count(*)::int AS n FROM telemetry.item_samples WHERE server_id = $1", [serverUuid])).rows[0].n as number;

  it("happy path: the server becomes local with its connection stored (tokens sealed), the credential is revoked, the runtime entry is the polled one, and it is audited", async () => {
    const { server, secret } = await newAgentServer();
    expect((await findActiveAgent(pool, sha256(secret)))?.publicId).toBe(server.publicId); // a working agent before

    const view = await service.switchToLocal(operatorId, server.publicId, body);
    expect(view).toMatchObject({ id: server.publicId, host: "localhost", apiPort: 7777, frmTokenSet: true, state: "ok" });
    expect(await kindOf(server.publicId)).toBe("local");
    const stored = await getConnection(pool, ring, server.publicId);
    expect(stored).toMatchObject({ host: "localhost", apiToken: API, frmToken: FRM });
    const raw = (await admin.query("SELECT api_token_enc FROM servers.server_connections WHERE server_id = $1", [server.id])).rows[0].api_token_enc as Buffer;
    expect(raw.toString("latin1")).not.toContain(API); // sealed, never plaintext
    expect(runtime.get(server.publicId)).toBe("polled");
    const audit = (await admin.query("SELECT action, detail::text AS detail FROM audit.audit_events WHERE server_id = $1 AND action = 'server.switched_to_local'", [server.id])).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].detail)).toEqual({ credentialRevoked: true, commandsEnded: 1 });
    expect(JSON.stringify(audit)).not.toContain(API);
  });

  it("the agent's secret stops working at once: refused at ingest (revoked, and the server is no longer an agent server)", async () => {
    const { server, secret } = await newAgentServer();
    await service.switchToLocal(operatorId, server.publicId, body);
    expect(await findActiveAgent(pool, sha256(secret))).toBeUndefined();
    const status = await agents.getStatus(server.publicId);
    expect(status).toMatchObject({ enrolled: false, connectionKind: "local" });
  });

  it("defence in depth: even an UN-revoked credential of a server that is not an agent server is refused (the kind check in the ingest lookup)", async () => {
    const { server, secret } = await newAgentServer();
    await admin.query("UPDATE servers.servers SET connection_kind = 'local' WHERE id = $1", [server.id]); // as if revoke had been missed
    expect(await findActiveAgent(pool, sha256(secret))).toBeUndefined();
  });

  it("an enrolment code issued BEFORE the switch is refused afterwards, so no old code can flip the server back to an agent", async () => {
    const { server } = await newAgentServer();
    const code = (await agents.createEnrollmentCode(server.publicId, operatorId)).code;
    await service.switchToLocal(operatorId, server.publicId, body);
    expect(await codeOf(enrollment.enroll(code, "0.1.0"))).not.toBe("resolved");
    expect(await kindOf(server.publicId)).toBe("local"); // still local
    expect((await admin.query("SELECT count(*)::int AS n FROM agents.enrollment_codes WHERE server_id = $1 AND consumed_at IS NULL", [server.id])).rows[0].n).toBe(0);
  });

  it("waiting commands end as `expired` (terminal), none is left pending or sent", async () => {
    const { server, commandId } = await newAgentServer();
    await service.switchToLocal(operatorId, server.publicId, body);
    const row = (await admin.query("SELECT status, completed_at, result_code FROM agents.commands WHERE id = $1", [commandId])).rows[0];
    expect(row.status).toBe("expired");
    expect(row.completed_at).not.toBeNull();
    expect(row.result_code).toBeNull();
    expect((await admin.query("SELECT count(*)::int AS n FROM agents.commands WHERE server_id = $1 AND status IN ('pending', 'sent')", [server.id])).rows[0].n).toBe(0);
  });

  it("members and history are exactly as they were: same owner, same rows", async () => {
    const { server } = await newAgentServer();
    const before = await historyRows(server.id);
    expect(before).toBeGreaterThan(0);
    await service.switchToLocal(operatorId, server.publicId, body);
    expect(await getMemberRole(pool, { publicId: server.publicId, userId: operatorId })).toBe("owner");
    expect(await historyRows(server.id)).toBe(before);
    expect((await findServerByPublicId(pool, server.publicId))?.id).toBe(server.id); // the same internal id (history keys on it)
  });

  it("a `local` server is 409 server_not_agent, and switching the same server twice is too: the second finds it already local", async () => {
    const local = await upsertConfiguredServer(pool, { publicId: `sw-${++counter}`, displayName: "Already local" });
    expect(await codeOf(service.switchToLocal(operatorId, local.publicId, body))).toBe("server_not_agent");
    const { server } = await newAgentServer();
    await service.switchToLocal(operatorId, server.publicId, body);
    expect(await codeOf(service.switchToLocal(operatorId, server.publicId, body))).toBe("server_not_agent");
    expect(await codeOf(service.switchToLocal(operatorId, "no-such-server", body))).toBe("server_not_found");
  });

  it("two concurrent switches of the same server: exactly one succeeds, the other is refused, and the database holds one consistent state", async () => {
    const { server } = await newAgentServer();
    const results = await Promise.all([service.switchToLocal(operatorId, server.publicId, body), service.switchToLocal(operatorId, server.publicId, body)].map((work) => codeOf(work)));
    expect(results.filter((result) => result === "resolved")).toHaveLength(1);
    expect(results.filter((result) => result !== "resolved")).toEqual(["server_not_agent"]);
    expect(await kindOf(server.publicId)).toBe("local");
    expect((await admin.query("SELECT count(*)::int AS n FROM servers.server_connections WHERE server_id = $1", [server.id])).rows[0].n).toBe(1);
  });

  it("a failure inside the transaction leaves EVERYTHING as it was: still an agent server, the credential still live, the command still waiting", async () => {
    const { server, secret, commandId } = await newAgentServer();
    const failing = createServerManagementService({
      db: pool,
      ring,
      runtime: new ServerRuntime<string>(),
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: "polled", workers: [] }),
      testConnection: async () => passed,
      getOperatorUserId: () => operatorId,
      lookup: async () => ["127.0.0.1"],
      mutex: new Mutex(),
      releaseAgent: async () => {
        throw new Error("release failed");
      },
    });
    await expect(failing.switchToLocal(operatorId, server.publicId, body)).rejects.toThrow("release failed");
    expect(await kindOf(server.publicId)).toBe("agent");
    expect((await admin.query("SELECT count(*)::int AS n FROM servers.server_connections WHERE server_id = $1", [server.id])).rows[0].n).toBe(0);
    expect((await findActiveAgent(pool, sha256(secret)))?.publicId).toBe(server.publicId);
    expect((await admin.query("SELECT status FROM agents.commands WHERE id = $1", [commandId])).rows[0].status).toBe("pending");
  });

  it("the way back is complete: after switching to local, enrolling again (a fresh code) makes it an agent server again", async () => {
    const { server } = await newAgentServer();
    await service.switchToLocal(operatorId, server.publicId, body);
    await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, operatorId)).code, "0.2.0");
    expect(await kindOf(server.publicId)).toBe("agent");
    expect((await admin.query("SELECT count(*)::int AS n FROM servers.server_connections WHERE server_id = $1", [server.id])).rows[0].n).toBe(0);
  });
});
