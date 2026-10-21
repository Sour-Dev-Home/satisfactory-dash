import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ensureServer, softDeleteServer, upsertConfiguredServer } from "./repositories/serverRepository.js";

// ADR-0047 amendment: a removed server keeps only its ids. The removal paths each assert the cleared name in their own tests
// (serverAdmin, serverManagement, selfServeOwner: owner remove and sweep; identity/accountDeletion); this file covers the
// schema rule, the revive paths and the migration's back-fill.
const available = dbTestsAvailable();

describe.skipIf(!available)("a removed server keeps no name (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const nameOf = async (publicId: string) =>
    ((await admin.query("SELECT display_name FROM servers.servers WHERE public_id = $1", [publicId])).rows[0] as { display_name: string | null }).display_name;

  it("the soft delete clears the name, and a live server can never be without one", async () => {
    const server = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Typed by a person" });
    expect(await softDeleteServer(pool, server.publicId, { actorUserId: null })).toBe(true);
    expect(await nameOf(server.publicId)).toBeNull();
    // The audit row names ids only, never the name.
    const audit = await admin.query("SELECT detail::text FROM audit.audit_events WHERE server_id = $1", [server.id]);
    expect(JSON.stringify(audit.rows)).not.toContain("Typed by a person");
    // A live row without a name is refused (the CHECK), and the removed row may not be brought back nameless by hand.
    await expect(pool.query("UPDATE servers.servers SET deleted_at = NULL WHERE id = $1", [server.id])).rejects.toMatchObject({ constraint: "servers_live_has_name" });
    const live = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Live" });
    await expect(pool.query("UPDATE servers.servers SET display_name = NULL WHERE id = $1", [live.id])).rejects.toMatchObject({ constraint: "servers_live_has_name" });
  });

  it("the revive paths give a removed id the name they bring; an import keeps a live server's own name", async () => {
    const viaImport = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Old" });
    await softDeleteServer(pool, viaImport.publicId);
    const revived = await ensureServer(pool, { publicId: viaImport.publicId, displayName: "From the import" });
    expect([revived.id, revived.displayName, await nameOf(viaImport.publicId)]).toEqual([viaImport.id, "From the import", "From the import"]);
    // Live: the import does not undo a rename.
    expect((await ensureServer(pool, { publicId: viaImport.publicId, displayName: "Ignored" })).displayName).toBe("From the import");

    const viaCreate = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Old" });
    await softDeleteServer(pool, viaCreate.publicId);
    expect((await upsertConfiguredServer(pool, { publicId: viaCreate.publicId, displayName: "Created again" })).displayName).toBe("Created again");
  });

  it("names are not unique: two removed servers both without a name, and live servers sharing one, are fine", async () => {
    const [a, b] = [await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Same" }), await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Same" })];
    await softDeleteServer(pool, a.publicId);
    await softDeleteServer(pool, b.publicId);
    expect([await nameOf(a.publicId), await nameOf(b.publicId)]).toEqual([null, null]);
  });

  it("the migration's back-fill clears the names of servers removed before it, and only theirs", async () => {
    const removedEarlier = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Removed before" });
    const live = await upsertConfiguredServer(pool, { publicId: `nm-${++n}`, displayName: "Still here" });
    // As a pre-migration removal left it: deleted, name kept (the CHECK allows a named removed row).
    await admin.query("UPDATE servers.servers SET deleted_at = now() WHERE id = $1", [removedEarlier.id]);
    expect(await nameOf(removedEarlier.publicId)).toBe("Removed before");

    const file = fileURLToPath(new URL("../../../migrations/1791763200000_removed_servers_keep_no_name.sql", import.meta.url));
    const backfill = readFileSync(file, "utf8").split("\n").find((line) => line.startsWith("UPDATE servers.servers SET display_name = NULL"));
    expect(backfill).toBeDefined();
    await admin.query(backfill!);
    expect([await nameOf(removedEarlier.publicId), await nameOf(live.publicId)]).toEqual([null, "Still here"]);
  });
});
