import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ApiFailure, ServerNotFoundError } from "../../platform/errorResponse.js";
import { Mutex } from "../../platform/mutex.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { MAX_LOCAL_SERVERS } from "./importServers.js";
import { getConnection } from "./repositories/connectionRepository.js";
import { getMemberRole } from "./repositories/memberRepository.js";
import { findServerByPublicId } from "./repositories/serverRepository.js";
import { createServerManagementService } from "./serverManagement.js";
import { ServerRuntime } from "./serverRuntime.js";

const available = dbTestsAvailable();
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
const API = "api-token-abcdefgh1234";
const FRM = "frm-token-abcdefgh5678";
const passed = { ok: true, api: { ok: true }, frm: { ok: true } };

const input = (id: string) => ({ id, displayName: `Name ${id}`, host: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API, frmToken: FRM });
const failure = async (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (error: unknown) => error);

// Runs as satis_app against a real Postgres. The tests build on each other in order (the cap test is last).
describe.skipIf(!available)("server management against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 12 });
    operatorId = (await createUser(pool, { displayName: "operator" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** Each call is a separate "process": its own runtime and its own mutex, so only the database lock can serialise two of them. */
  const newInstance = (instanceRing: typeof ring | null = ring) => {
    const runtime = new ServerRuntime<string>();
    const service = createServerManagementService({
      db: pool,
      ring: instanceRing,
      runtime,
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }),
      testConnection: async () => passed,
      getOperatorUserId: () => operatorId,
      lookup: async () => ["192.168.1.20"],
      mutex: new Mutex(),
    });
    return { service, runtime };
  };
  const connectionCount = async () => (await pool.query("SELECT count(*)::int AS n FROM servers.server_connections")).rows[0].n as number;

  it("creates a server: an encrypted row, the operator as owner, an audit event without a token, and a running server", async () => {
    const { service, runtime } = newInstance();
    const view = await service.create(operatorId, input("db-a"));
    expect(view).toMatchObject({ id: "db-a", apiTokenSet: true, apiTokenLast4: "1234", state: "ok" });
    expect(runtime.get("db-a")).toBe(API);
    expect(await getMemberRole(pool, { publicId: "db-a", userId: operatorId })).toBe("owner");
    const server = await findServerByPublicId(pool, "db-a");
    const raw = (await pool.query("SELECT api_token_enc FROM servers.server_connections WHERE server_id = $1", [server!.id])).rows[0];
    expect(Buffer.from(raw.api_token_enc).includes(Buffer.from(API))).toBe(false);
    const audit = (await pool.query("SELECT action, detail FROM audit.audit_events WHERE server_id = $1", [server!.id])).rows;
    // Making the operator owner writes its own member_added event; the creation is audited too.
    expect(audit.map((row) => row.action).sort()).toEqual(["member_added", "server.created"]);
    expect(JSON.stringify(audit)).not.toContain(API);
    expect(JSON.stringify(audit)).not.toContain(FRM);
  });

  it("refuses an id that is taken", async () => {
    const error = await failure(newInstance().service.create(operatorId, input("db-a")));
    expect((error as ApiFailure).code).toBe("server_exists");
    expect(await connectionCount()).toBe(1);
  });

  it("an edit renames, re-seals and audits the field NAMES only", async () => {
    const { service } = newInstance();
    // A separate instance has an empty runtime; replace() adds the edited server to it.
    const view = await service.update(operatorId, "db-a", { apiToken: "new-api-token-zzzz9999", displayName: "Renamed" });
    expect(view).toMatchObject({ displayName: "Renamed", apiTokenLast4: "9999", frmTokenLast4: "5678" });
    const server = await findServerByPublicId(pool, "db-a");
    expect(server?.displayName).toBe("Renamed");
    expect((await getConnection(pool, ring, server!.id))?.apiToken).toBe("new-api-token-zzzz9999");
    const updated = (await pool.query("SELECT detail FROM audit.audit_events WHERE server_id = $1 AND action = 'server.updated'", [server!.id])).rows;
    expect(updated).toHaveLength(1);
    expect(updated[0].detail).toEqual({ fields: ["apiToken", "displayName"] });
    expect(JSON.stringify(updated)).not.toContain("new-api-token");
  });

  it("removing wipes the tokens and the memberships, stops the server, and the id can be created again", async () => {
    const { service, runtime } = newInstance();
    await service.create(operatorId, input("db-b"));
    expect(runtime.has("db-b")).toBe(true);
    await service.remove(operatorId, "db-b");
    expect(runtime.has("db-b")).toBe(false);
    const gone = await findServerByPublicId(pool, "db-b");
    expect(gone).toBeUndefined();
    expect((await pool.query("SELECT 1 FROM servers.server_connections c JOIN servers.servers s ON s.id = c.server_id WHERE s.public_id = 'db-b'")).rowCount).toBe(0);
    expect(await getMemberRole(pool, { publicId: "db-b", userId: operatorId })).toBeUndefined();
    expect(await failure(service.get("db-b"))).toBeInstanceOf(ServerNotFoundError);
    expect(await failure(service.remove(operatorId, "db-b"))).toBeInstanceOf(ServerNotFoundError);

    const again = await newInstance().service.create(operatorId, input("db-b"));
    expect(again.id).toBe("db-b");
    expect(await getMemberRole(pool, { publicId: "db-b", userId: operatorId })).toBe("owner");
  });

  it("lists every stored connection with its state, including unreadable and refused ones, and removes them without a keyring", async () => {
    await newInstance().service.create(operatorId, input("db-u"));
    await newInstance().service.create(operatorId, input("db-r"));
    // A tampered address, edited in the database by hand: refused, and its tokens are not even opened.
    await pool.query("UPDATE servers.server_connections SET pinned_ip = '8.8.8.8' WHERE server_id = (SELECT id FROM servers.servers WHERE public_id = 'db-r')");

    const withKey = await newInstance().service.list();
    const stateOf = (views: typeof withKey, id: string) => views.find((view) => view.id === id)?.state;
    expect(stateOf(withKey, "db-a")).toBe("ok");
    expect(stateOf(withKey, "db-u")).toBe("ok");
    expect(stateOf(withKey, "db-r")).toBe("refused");

    // The same rows read by a backend with a DIFFERENT key (or none): unreadable, still listed with host and ports.
    const otherKey = createSecretsKeyring("k9", new Map([["k9", randomBytes(32)]]));
    for (const instanceRing of [otherKey, null]) {
      const views = await newInstance(instanceRing).service.list();
      expect(stateOf(views, "db-u")).toBe("unreadable");
      expect(stateOf(views, "db-r")).toBe("refused");
      expect(views.find((view) => view.id === "db-u")).toMatchObject({ host: "192.168.1.20", apiPort: 7777, apiTokenLast4: null });
      expect(JSON.stringify(views)).not.toContain(API);
    }

    // Removal needs no key.
    await newInstance(null).service.remove(operatorId, "db-u");
    await newInstance(null).service.remove(operatorId, "db-r");
    const after = await newInstance().service.list();
    expect(after.map((view) => view.id)).not.toContain("db-u");
    expect(after.map((view) => view.id)).not.toContain("db-r");
  });

  it("holds the cap of 8 under concurrent creates from separate instances (the advisory lock, not just the mutex)", async () => {
    const existing = await connectionCount();
    const room = MAX_LOCAL_SERVERS - existing;
    const results = await Promise.allSettled(
      Array.from({ length: room + 4 }, (_, i) => newInstance().service.create(operatorId, input(`cap-${i}`))),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(room);
    const refusals = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(refusals).toHaveLength(4);
    expect(refusals.every((result) => (result.reason as ApiFailure).code === "server_limit_reached")).toBe(true);
    expect(await connectionCount()).toBe(MAX_LOCAL_SERVERS);
  });
});
