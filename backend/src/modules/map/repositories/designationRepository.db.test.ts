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

  it("another server's designation id cannot be updated or collide in the overlap check", async () => {
    const one = await newServer();
    const two = await newServer();
    const a = await create(one, "A", [m("a1", "S", 1, 1)]);
    const b = await create(two, "B", [m("b1", "S", 2, 2)]);
    if (a.kind !== "created" || b.kind !== "created") throw new Error("expected created");
    expect(await store().update(two, a.designation.id, { userId: user, name: "hijack" })).toEqual({ kind: "not_found" });
    // Server two's designation naming server one's building is no overlap: the check is per server.
    expect((await store().update(two, b.designation.id, { userId: user, members: [m("a1", "S", 1, 1)] })).kind).toBe("updated");
    expect((await store().list(one))[0]?.name).toBe("A");
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

  // ADR-0055 amendment 2026-10-27, Decision 11.
  describe("revision and replace", () => {
    const created = async (server: string, name: string, members = [m(`id-${name}`, "S", 1, 1)]) => {
      const outcome = await create(server, name, members);
      if (outcome.kind !== "created") throw new Error(`expected created, got ${outcome.kind}`);
      return outcome.designation as typeof outcome.designation & { revision: number };
    };
    const replace = (server: string, input: Omit<Parameters<ReturnType<typeof store>["replace"]>[1], "userId">) => store().replace(server, { userId: user, ...input });
    const view = (d: { id: string; name: string; members: unknown; createdAt: string }) => ({ id: d.id, name: d.name, members: d.members, createdAt: d.createdAt });

    it("starts at revision 1 and every update bumps it; createdAt is in whole milliseconds", async () => {
      const server = await newServer();
      const a = await created(server, "A");
      expect(a.revision).toBe(1);
      expect(a.createdAt).toMatch(/\.\d{3}Z$/);
      const renamed = await store().update(server, a.id, { userId: user, name: "A2" });
      expect(renamed).toMatchObject({ kind: "updated", designation: { revision: 2, createdAt: a.createdAt } });
      expect((await store().list(server))[0]?.revision).toBe(2);
    });

    it("merges in place (kept id and createdAt, revision + 1), removes the rest, and audits once without names", async () => {
      const server = await newServer();
      const a = await created(server, "Secret A", [m("a1", "S", 1, 1)]);
      const b = await created(server, "Secret B", [m("b1", "S", 2, 2), m(null, "S", 3, 3)]);
      const merged = await replace(server, {
        expect: [{ id: a.id, revision: 1 }, { id: b.id, revision: 1 }],
        put: [{ id: a.id, name: "Merged", members: [...a.members, ...b.members] }],
        intent: "merge",
      });
      if (merged.kind !== "replaced") throw new Error(`expected replaced, got ${merged.kind}`);
      expect(merged.removedIds).toEqual([b.id]);
      expect(merged.designations).toHaveLength(1);
      expect(merged.designations[0]).toMatchObject({ id: a.id, name: "Merged", createdAt: a.createdAt, revision: 2, members: [...a.members, ...b.members] });
      expect((await store().list(server)).map((d) => d.id)).toEqual([a.id]);

      const audit = await admin.query("SELECT actor_user_id, detail FROM audit.audit_events WHERE action = 'planner.designations_replaced' AND detail::text LIKE $1", [`%${a.id}%`]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].actor_user_id).toBe(user);
      expect(audit.rows[0].detail).toEqual({ intent: "merge", removedIds: [b.id], updatedIds: [a.id], addedIds: [], members: 3 });
      expect(JSON.stringify(audit.rows[0].detail)).not.toContain("Secret");
    });

    it("merge then split back is the identity on ids, members, order and createdAt, and keeps the matching priority", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1), m("a2", "S", 1, 2)]);
      const b = await created(server, "B", [m("b1", "S", 2, 2)]);
      const c = await created(server, "C", [m(null, "S", 3, 3)]);
      const outsider = await created(server, "Outsider", [m("o1", "S", 4, 4)]);
      const before = (await store().list(server)).map(view);

      // Merge A and C into A; B and the outsider stay.
      const merged = await replace(server, {
        expect: [{ id: a.id, revision: 1 }, { id: c.id, revision: 1 }],
        put: [{ id: a.id, name: "A", members: [...a.members, ...c.members] }],
      });
      if (merged.kind !== "replaced") throw new Error(`expected replaced, got ${merged.kind}`);
      const undo = await replace(server, {
        expect: [{ id: a.id, revision: merged.designations[0]!.revision }],
        put: [view(a), view(c)].map(({ id, name, members, createdAt }) => ({ id, name, members: members as typeof a.members, createdAt })),
        intent: "undo",
      });
      expect(undo).toMatchObject({ kind: "replaced", removedIds: [] });
      expect((await store().list(server)).map(view)).toEqual(before);
      expect(new Set(before.map((d) => d.id))).toEqual(new Set([a.id, b.id, c.id, outsider.id]));
    });

    it("splits: the source keeps its id with the unselected members, a new designation takes the rest", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1), m("a2", "S", 2, 2)]);
      const split = await replace(server, {
        expect: [{ id: a.id, revision: 1 }],
        put: [{ id: a.id, name: "A", members: [m("a1", "S", 1, 1)] }, { name: "Popped", members: [m("a2", "S", 2, 2)] }],
        intent: "pop_out",
      });
      if (split.kind !== "replaced") throw new Error(`expected replaced, got ${split.kind}`);
      expect(split.removedIds).toEqual([]);
      expect(split.designations.map((d) => [d.name, d.revision])).toEqual([["A", 2], ["Popped", 1]]);
      // The new one is never older than the source, which keeps its createdAt (so its matching priority).
      expect(split.designations[0]!.createdAt).toBe(a.createdAt);
      expect(Date.parse(split.designations[1]!.createdAt)).toBeGreaterThanOrEqual(Date.parse(a.createdAt));
    });

    it("refuses a stale revision, a gone designation and an inserted id that still exists, and writes nothing", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1)]);
      const b = await created(server, "B", [m("b1", "S", 2, 2)]);
      await store().update(server, a.id, { userId: user, name: "A renamed" });
      const gone = randomUUID();
      expect(await replace(server, { expect: [{ id: a.id, revision: 1 }, { id: b.id, revision: 1 }], put: [] })).toEqual({ kind: "stale", ids: [a.id] });
      expect(await replace(server, { expect: [{ id: gone, revision: 1 }], put: [] })).toEqual({ kind: "stale", ids: [gone] });
      expect(await replace(server, { expect: [{ id: a.id, revision: 2 }], put: [{ id: b.id, name: "Copy", members: [m("c1", "S", 9, 9)] }] })).toEqual({ kind: "stale", ids: [b.id] });
      const list = await store().list(server);
      expect(list.map((d) => [d.id, d.name, d.revision])).toEqual([[a.id, "A renamed", 2], [b.id, "B", 1]]);
    });

    it("an insert may reuse an id only once it is gone: an id on another server is no conflict", async () => {
      const one = await newServer();
      const two = await newServer();
      const a = await created(one, "A", [m("a1", "S", 1, 1)]);
      const res = await replace(two, { expect: [], put: [{ id: a.id, name: "Same id elsewhere", members: [m("a1", "S", 1, 1)] }] });
      expect(res).toMatchObject({ kind: "replaced", designations: [{ id: a.id, revision: 1 }] });
      expect((await store().list(one))[0]?.name).toBe("A");
    });

    it("refuses an overlap with a designation outside expect (naming it); one inside expect is fine", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1)]);
      const b = await created(server, "B", [m(null, "S", 2, 2)]);
      const clash = await replace(server, { expect: [{ id: a.id, revision: 1 }], put: [{ id: a.id, name: "A", members: [m("a1", "S", 1, 1), m("x", "S", 2, 2)] }] });
      expect(clash).toEqual({ kind: "overlap", other: { id: b.id, name: "B" } });
      const ok = await replace(server, { expect: [{ id: a.id, revision: 1 }, { id: b.id, revision: 1 }], put: [{ name: "AB", members: [m("a1", "S", 1, 1), m(null, "S", 2, 2)] }] });
      expect(ok).toMatchObject({ kind: "replaced", removedIds: [a.id, b.id] });
      expect((await store().list(server)).map((d) => d.name)).toEqual(["AB"]);
    });

    it("checks the cap on the resulting set: a split at the cap is refused, a merge at the cap is fine", async () => {
      const server = await newServer();
      const all = [];
      for (let i = 0; i < PLANNER_DESIGNATIONS_MAX_PER_SERVER; i++) all.push(await created(server, `D${i}`, [m(`b${i}`, "S", i, i), m(`c${i}`, "S", i, i + 500)]));
      const d0 = all[0]!;
      const d1 = all[1]!;
      expect(
        await replace(server, { expect: [{ id: d0.id, revision: 1 }], put: [{ id: d0.id, name: "D0", members: [d0.members[0]!] }, { name: "New", members: [d0.members[1]!] }] }),
      ).toEqual({ kind: "cap" });
      expect(await replace(server, { expect: [], put: [{ name: "New", members: [m("n", "S", 9999, 9999)] }] })).toEqual({ kind: "cap" });
      const merged = await replace(server, { expect: [{ id: d0.id, revision: 1 }, { id: d1.id, revision: 1 }], put: [{ id: d0.id, name: "D0", members: [...d0.members, ...d1.members] }] });
      expect(merged.kind).toBe("replaced");
      expect(await store().list(server)).toHaveLength(PLANNER_DESIGNATIONS_MAX_PER_SERVER - 1);
    });

    it("refuses a createdAt in the future before touching the database; a past one is restored as given", async () => {
      const server = await newServer();
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(await replace(server, { expect: [], put: [{ name: "F", members: [m("f", "S", 1, 1)], createdAt: future }] })).toEqual({ kind: "created_in_future" });
      expect(await store().list(server)).toEqual([]);
      const past = "2026-01-02T03:04:05.678Z";
      const res = await replace(server, { expect: [], put: [{ name: "P", members: [m("p", "S", 1, 1)], createdAt: past }] });
      expect(res).toMatchObject({ kind: "replaced", designations: [{ createdAt: past, revision: 1 }] });
    });

    it("a createdAt sent for an update in place is ignored: the designation keeps its own", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1)]);
      const res = await replace(server, { expect: [{ id: a.id, revision: 1 }], put: [{ id: a.id, name: "A", members: a.members, createdAt: "2020-01-01T00:00:00.000Z" }] });
      expect(res).toMatchObject({ kind: "replaced", designations: [{ id: a.id, createdAt: a.createdAt, revision: 2 }] });
    });

    it("two concurrent replaces of one designation serialize: one wins, the other is stale", async () => {
      const server = await newServer();
      const a = await created(server, "A", [m("a1", "S", 1, 1), m("a2", "S", 2, 2)]);
      const raced = await Promise.all([
        replace(server, { expect: [{ id: a.id, revision: 1 }], put: [{ id: a.id, name: "A", members: [m("a1", "S", 1, 1)] }, { name: "X", members: [m("a2", "S", 2, 2)] }] }),
        replace(server, { expect: [{ id: a.id, revision: 1 }], put: [] }),
      ]);
      expect(raced.map((r) => r.kind).sort()).toEqual(["replaced", "stale"]);
      const list = await store().list(server);
      expect(list.length === 0 || (list.length === 2 && list[0]!.id === a.id && list[0]!.revision === 2)).toBe(true);

      // Two inserts that claim one building: the second sees the first's commit and overlaps.
      const other = await newServer();
      const both = await Promise.all([
        replace(other, { expect: [], put: [{ name: "o1", members: [m("same", "S", 1, 1)] }] }),
        replace(other, { expect: [], put: [{ name: "o2", members: [m("same", "S", 1, 1)] }] }),
      ]);
      expect(both.map((r) => r.kind).sort()).toEqual(["overlap", "replaced"]);
      expect(await store().list(other)).toHaveLength(1);
    });

    it("an unknown server accepts no replace", async () => {
      expect(await replace("no-such", { expect: [], put: [{ name: "A", members: [m("a", "S", 1, 1)] }] })).toEqual({ kind: "no_server" });
    });
  });
});
