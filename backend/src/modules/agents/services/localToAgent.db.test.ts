import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { ServerRuntime, loadDatabaseServers } from "../../servers/index.js";
import type { RuntimeServer } from "../../servers/index.js";
import { addMember, getMemberRole } from "../../servers/repositories/memberRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { createAgentsService } from "./agentsService.js";
import { createEnrollmentService } from "./enrollmentService.js";

const available = dbTestsAvailable();
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const MIGRATION = fileURLToPath(new URL("../../../../migrations/1792540800000_local_servers_to_agent.sql", import.meta.url));

// ADR-0066 Decision 7 step 1 (build PR 5), against a real Postgres: direct polling is retired, so a `local` server becomes
// an agent server awaiting the mod. The migration converts the live rows; the loader treats a leftover one (a backup
// restored from before it) the same way. History, members, alert rules and the stored connection stay; the operator
// then mints an enrolment code and the mod enrols.
describe.skipIf(!available)("a direct-poll (`local`) server becomes one awaiting the mod", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let operatorId: string;
  let viewerId: string;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    operatorId = (await createUser(pool, { displayName: "operator" })).id;
    viewerId = (await createUser(pool, { displayName: "a viewer" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  /** A `local` server as a build before ADR-0066 left it: a stored connection, two members, history and an alert rule. */
  const localServer = async () => {
    const publicId = `lta-${++counter}`;
    const server = await upsertConfiguredServer(pool, { publicId, displayName: `Local ${publicId}` });
    await admin.query(
      `INSERT INTO servers.server_connections (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, key_id)
       VALUES ($1, '127.0.0.1', '127.0.0.1', 7777, 8080, decode(repeat('ab', 40), 'hex'), 'k1')`,
      [server.id],
    );
    await addMember(pool, { serverId: server.id, userId: operatorId, role: "owner", actorUserId: null });
    await addMember(pool, { serverId: server.id, userId: viewerId, role: "viewer", actorUserId: null });
    await admin.query(
      `INSERT INTO telemetry.power_samples (server_id, session, circuit, at, production_mw, consumption_mw, capacity_mw, battery_pct, fuse_tripped)
       VALUES ($1, 1, 1, now() - interval '1 hour', 100, 80, 120, 50, false), ($1, 1, 1, now(), 100, 80, 120, 50, false)`,
      [server.id],
    );
    await admin.query(
      "INSERT INTO alerts.rules (server_id, kind, for_seconds, clear_seconds, repeat_seconds, severity) VALUES ($1, 'power_outage', 0, 60, 3600, 'critical')",
      [server.id],
    );
    return { publicId, id: server.id };
  };

  const kindOf = async (id: string) => (await admin.query("SELECT connection_kind FROM servers.servers WHERE id = $1", [id])).rows[0]?.connection_kind as string;
  const count = async (table: string, id: string) => (await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE server_id = $1`, [id])).rows[0].n as number;
  const migrate = async () => admin.query(readFileSync(MIGRATION, "utf8").split("-- Down Migration")[0]!);

  /** The startup load, with a builder that records what it built (the composition root's is `buildAgentServer`). */
  const load = async () => {
    const built: string[] = [];
    const runtime = new ServerRuntime<string>();
    const buildAgent = ({ publicId, displayName }: { publicId: string; displayName: string }): RuntimeServer<string> => {
      built.push(publicId);
      return { id: publicId, displayName, services: "agent", workers: [], kind: "agent" };
    };
    await loadDatabaseServers({ db: pool, runtime, operatorUserId: operatorId, buildAgent });
    return { built, runtime };
  };

  const agents = () =>
    createAgentsService({ db: pool, canManage: (userId) => userId === operatorId, limiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }) });
  const enrollment = () =>
    createEnrollmentService({ db: pool, cadence: () => CADENCE, logger: createLogger({ level: "silent" }, { write: () => {} }), attachAgentRuntime: async () => {} });

  it("the migration converts every live `local` row to `agent`, keeping history, members, rules and the sealed tokens; a removed row is left as it is", async () => {
    const live = await localServer();
    const removed = await localServer();
    await softDeleteServer(pool, removed.publicId);
    expect(await kindOf(live.id)).toBe("local");

    await migrate();

    expect(await kindOf(live.id)).toBe("agent");
    expect(await kindOf(removed.id)).toBe("local");
    expect(await getMemberRole(pool, { publicId: live.publicId, userId: operatorId })).toBe("owner");
    expect(await getMemberRole(pool, { publicId: live.publicId, userId: viewerId })).toBe("viewer");
    expect(await count("telemetry.power_samples", live.id)).toBe(2);
    expect(await count("alerts.rules", live.id)).toBe(1);
    // Kept, unread, until the owner-gated contract step (build PR 10) drops the table: the step stays reversible.
    expect(await count("servers.server_connections", live.id)).toBe(1);
    // Running it again changes nothing.
    await migrate();
    expect(await kindOf(live.id)).toBe("agent");
  });

  it("a converted server loads as one awaiting the mod, and a code can be minted and enrolled; the enrolment drops the stored connection", async () => {
    const server = await localServer();
    await migrate();
    const { built, runtime } = await load();
    expect(built).toContain(server.publicId);
    expect(runtime.describe(server.publicId)?.kind).toBe("agent");

    const { code } = await agents().createEnrollmentCode(server.publicId, operatorId);
    await expect(enrollment().enroll(code, "mod/0.3.0")).resolves.toMatchObject({ serverId: server.publicId });
    expect(await kindOf(server.id)).toBe("agent");
    expect(await count("servers.server_connections", server.id)).toBe(0);
    // Its history and members are the same server's still.
    expect(await count("telemetry.power_samples", server.id)).toBe(2);
    expect(await getMemberRole(pool, { publicId: server.publicId, userId: viewerId })).toBe("viewer");
  });

  it("a leftover `local` row (a backup restored from before the migration) loads the same way, its connection never read, and can be enrolled", async () => {
    await migrate(); // what a newer backend's database has run; this row is written after it, as a restore would leave it
    const leftover = await localServer();
    expect(await kindOf(leftover.id)).toBe("local");

    const { built, runtime } = await load();
    expect(built).toContain(leftover.publicId);
    expect(runtime.describe(leftover.publicId)?.kind).toBe("agent");
    expect(await count("telemetry.power_samples", leftover.id)).toBe(2);
    expect(await getMemberRole(pool, { publicId: leftover.publicId, userId: viewerId })).toBe("viewer");

    // Enrolling on a `local` row is the operator's (it replaces stored tokens); enrolment makes it an agent server.
    const { code } = await agents().createEnrollmentCode(leftover.publicId, operatorId);
    await expect(enrollment().enroll(code, "mod/0.3.0")).resolves.toMatchObject({ serverId: leftover.publicId });
    expect(await kindOf(leftover.id)).toBe("agent");
    expect(await count("servers.server_connections", leftover.id)).toBe(0);
  });
});
