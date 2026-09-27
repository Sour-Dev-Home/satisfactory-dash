import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { addMember, getMemberRole } from "./repositories/memberRepository.js";
import { switchToAgentConnection, upsertConfiguredServer } from "./repositories/serverRepository.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

const available = dbTestsAvailable();

const buildAgent = ({ publicId, displayName }: { publicId: string; displayName: string }): RuntimeServer<string> => ({ id: publicId, displayName, services: "agent", workers: [] });
const build = () => {
  throw new Error("no connection rows exist in these tests");
};

// #267: startup makes the operator owner of an agent server that has no owner, and never takes one from an existing owner.
// Runs as satis_app against a real Postgres.
describe.skipIf(!available)("seeding the operator as owner of agent servers, against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let operatorId: string;
  let otherId: string;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    operatorId = (await createUser(pool, { displayName: "operator" })).id;
    otherId = (await createUser(pool, { displayName: "another user" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const agentServer = async () => {
    const publicId = `own-${++counter}`;
    const server = await upsertConfiguredServer(pool, { publicId, displayName: `Server ${publicId}` });
    await switchToAgentConnection(pool, server.id);
    return { publicId, id: server.id };
  };
  const load = () => loadDatabaseServers({ db: pool, ring: null, runtime: new ServerRuntime<string>(), operatorUserId: operatorId, build, buildAgent });

  it("an agent server with no owner gets the operator as owner, and a second startup changes nothing", async () => {
    const { publicId, id } = await agentServer();
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBeUndefined();
    await load();
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBe("owner");
    await load();
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBe("owner");
    const audited = await pool.query("SELECT count(*)::int AS n FROM audit.audit_events WHERE server_id = $1 AND action = 'member_added'", [id]);
    expect(audited.rows[0].n).toBe(1);
  });

  it("an agent server that already has another owner keeps it: the operator is not added", async () => {
    const { publicId, id } = await agentServer();
    expect(await addMember(pool, { serverId: id, userId: otherId, role: "owner", actorUserId: null })).toBe("added");
    await load();
    expect(await getMemberRole(pool, { publicId, userId: otherId })).toBe("owner");
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBeUndefined();
  });

  it("an operator who is already a non-owner member is left as it is when someone else owns the server", async () => {
    const { publicId, id } = await agentServer();
    await addMember(pool, { serverId: id, userId: otherId, role: "owner", actorUserId: null });
    await addMember(pool, { serverId: id, userId: operatorId, role: "viewer", actorUserId: null });
    await load();
    expect(await getMemberRole(pool, { publicId, userId: operatorId })).toBe("viewer");
  });
});
