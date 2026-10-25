import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PLANNER_DESIGNATIONS_MAX_PER_SERVER } from "@satisfactory-dash/shared";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { createDbDesignationStore } from "./designationRepository.js";

const available = dbTestsAvailable();
const m = (id: string | null, c: string, x: number, y: number) => ({ id, c, x, y });

// Runs as satis_app against a real Postgres (the migration is applied by createTestDatabase).
describe.skipIf(!available)("map.factory_designations against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  const user = randomUUID();

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 8 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const store = () => createDbDesignationStore(pool);
  const newServer = async () => (await upsertConfiguredServer(pool, { publicId: `des-${++counter}`, displayName: "D" })).publicId;
  const create = (server: string, name: string, members = [m(`id-${name}`, "S", 1, 1)]) => store().create(server, { userId: user, name, mode: "core", members });

  it("creates, lists oldest first, updates and removes, and audits each write without the name", async () => {
    const server = await newServer();
    const a = await create(server, "Secret name A", [m("a1", "S", 1, 1)]);
    const b = await create(server, "B", [m("b1", "S", 2, 2)]);
    if (a.kind !== "created" || b.kind !== "created") throw new Error("expected created");
    expect((await store().list(server)).map((d) => d.name)).toEqual(["Secret name A", "B"]);

    const renamed = await store().update(server, a.designation.id, { userId: user, name: "A2" });
    expect(renamed).toMatchObject({ kind: "updated", designation: { name: "A2", members: [m("a1", "S", 1, 1)] } });
    const moved = await store().update(server, a.designation.id, { userId: user, members: [m("a9", "S", 7, 7)] });
    expect(moved).toMatchObject({ kind: "updated", designation: { name: "A2", members: [m("a9", "S", 7, 7)] } });

    expect(await store().remove(server, b.designation.id, user)).toBe(true);
    expect(await store().remove(server, b.designation.id, user)).toBe(false);
    expect(await store().update(server, b.designation.id, { userId: user, name: "x" })).toEqual({ kind: "not_found" });

    const audit = await admin.query("SELECT action, actor_user_id, detail::text AS detail FROM audit.audit_events WHERE action LIKE 'planner.designation_%' ORDER BY id");
    const mine = audit.rows.filter((r) => r.detail.includes(a.designation.id) || r.detail.includes(b.designation.id));
    expect(mine.map((r) => r.action)).toEqual([
      "planner.designation_created",
      "planner.designation_created",
      "planner.designation_updated",
      "planner.designation_updated",
      "planner.designation_deleted",
    ]);
    expect(mine.every((r) => r.actor_user_id === user && !r.detail.includes("Secret"))).toBe(true);
  });

  it("refuses an overlap by id or by (class, x, y) and names the other designation; a failed write stores nothing", async () => {
    const server = await newServer();
    const a = await create(server, "Alpha", [m("a1", "S", 1, 1), m(null, "C", 5, 5)]);
    if (a.kind !== "created") throw new Error("expected created");
    const other = { id: a.designation.id, name: "Alpha" };
    expect(await create(server, "Beta", [m("a1", "S", 99, 99)])).toEqual({ kind: "overlap", other });
    expect(await create(server, "Beta", [m("zz", "C", 5, 5)])).toEqual({ kind: "overlap", other });
    expect(await store().list(server)).toHaveLength(1);
    const b = await create(server, "Beta", [m("b1", "S", 2, 2)]);
    if (b.kind !== "created") throw new Error("expected created");
    expect(await store().update(server, b.designation.id, { userId: user, members: [m("a1", "S", 1, 1)] })).toEqual({ kind: "overlap", other });
    // Its own members never overlap itself.
    expect((await store().update(server, a.designation.id, { userId: user, members: [m("a1", "S", 1, 1)] })).kind).toBe("updated");
  });

  it("designations are per server: the same buildings can be named on another server", async () => {
    const one = await newServer();
    const two = await newServer();
    expect((await create(one, "X", [m("a1", "S", 1, 1)])).kind).toBe("created");
    expect((await create(two, "X", [m("a1", "S", 1, 1)])).kind).toBe("created");
    expect(await store().remove(two, (await store().list(one))[0]!.id, user)).toBe(false);
  });

  it("stops at the per-server cap", async () => {
    const server = await newServer();
    for (let i = 0; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER; i++) {
      expect((await create(server, `D${i}`, [m(`b${i}`, "S", i, i)])).kind).toBe("created");
    }
    expect(await create(server, "extra", [m("extra", "S", 999, 999)])).toEqual({ kind: "cap" });
  });

  it("two concurrent creates cannot both pass the cap or the overlap check", async () => {
    const capped = await newServer();
    for (let i = 0; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER - 1; i++) await create(capped, `D${i}`, [m(`b${i}`, "S", i, i)]);
    const raced = await Promise.all([create(capped, "r1", [m("r1", "S", 900, 900)]), create(capped, "r2", [m("r2", "S", 901, 901)])]);
    expect(raced.map((r) => r.kind).sort()).toEqual(["cap", "created"]);
    expect(await store().list(capped)).toHaveLength(PLANNER_DESIGNATIONS_MAX_PER_SERVER);

    const overlapping = await newServer();
    const both = await Promise.all([create(overlapping, "o1", [m("same", "S", 1, 1)]), create(overlapping, "o2", [m("same", "S", 1, 1)])]);
    expect(both.map((r) => r.kind).sort()).toEqual(["created", "overlap"]);
    expect(await store().list(overlapping)).toHaveLength(1);
  });

  it("an unknown or removed server has no designations and accepts no writes", async () => {
    expect(await store().list("no-such")).toEqual([]);
    expect(await create("no-such", "A")).toEqual({ kind: "no_server" });
    expect(await store().remove("no-such", randomUUID(), user)).toBe(false);
  });

  it("a stored row the contract does not allow is refused by the table", async () => {
    const server = await newServer();
    const uuid = (await admin.query("SELECT id FROM servers.servers WHERE public_id = $1", [server])).rows[0].id;
    await expect(admin.query("INSERT INTO map.factory_designations (server_id, name, mode, members) VALUES ($1, '', 'core', '[{}]')", [uuid])).rejects.toThrow();
    await expect(admin.query("INSERT INTO map.factory_designations (server_id, name, mode, members) VALUES ($1, 'ok', 'other', '[{}]')", [uuid])).rejects.toThrow();
    await expect(admin.query("INSERT INTO map.factory_designations (server_id, name, mode, members) VALUES ($1, 'ok', 'core', '[]')", [uuid])).rejects.toThrow();
  });
});
