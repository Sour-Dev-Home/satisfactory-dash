import { describe, it, expect } from "vitest";
import { registerConfiguredServers } from "./registerConfiguredServers.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";

/** A scripted database: the upsert answers a server row, the member insert answers or throws. */
function fakeDb(insertMember: () => unknown): Queryable & { inserts: number } {
  const db = {
    inserts: 0,
    query: async (sql: string) => {
      if (sql.includes("INSERT INTO servers.servers")) {
        return { rows: [{ id: "uuid-1", public_id: "home", display_name: "Home", hosting_mode: "self" }] };
      }
      db.inserts += 1;
      const result = insertMember();
      if (result instanceof Error) {
        throw result;
      }
      return { rows: [] };
    },
  };
  return db as unknown as Queryable & { inserts: number };
}

describe("registerConfiguredServers outcomes", () => {
  it("counts a normal registration", async () => {
    const db = fakeDb(() => undefined);
    expect(await registerConfiguredServers(db, [{ id: "home", displayName: "Home" }], "u1")).toEqual({ registered: 1 });
    expect(db.inserts).toBe(1);
  });

  it("treats a second owner (a restart after a transfer) as fine", async () => {
    const db = fakeDb(() => Object.assign(new Error("dup"), { code: "23505", constraint: "server_members_one_owner" }));
    await expect(registerConfiguredServers(db, [{ id: "home", displayName: "Home" }], "u1")).resolves.toEqual({ registered: 1 });
  });

  it("fails loudly when the bootstrap owner does not exist, instead of reporting ready with no owner", async () => {
    const db = fakeDb(() => Object.assign(new Error("fk"), { code: "23503" }));
    await expect(registerConfiguredServers(db, [{ id: "home", displayName: "Home" }], "missing")).rejects.toThrow(
      /could not seed an owner for server "home"/,
    );
  });
});
