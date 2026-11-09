import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { loadDatabaseServers, reconcileDatabaseServers } from "./loadDatabaseServers.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

// ADR-0066: every stored server is reached through the mod and is built as an agent server; a leftover `local` row (a
// backup restored from before the migration that converted them) loads the same way, awaiting the mod. No connection is
// read. The real statements are in loadAgentServersOwner.db.test.ts and localToAgent.db.test.ts.

interface Row {
  publicId: string;
  displayName: string;
  serverId?: string;
}

/** A database holding these live servers. The listing must ask for both kinds, or a leftover `local` row would be lost. */
function fakeDb(servers: Row[], memberError?: { code: string; constraint?: string }) {
  const members: unknown[][] = [];
  const listings: string[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      if (text.includes("server_members")) {
        members.push(values);
        if (memberError) throw Object.assign(new Error("db"), memberError);
        return { rows: [] };
      }
      if (text.includes("FROM servers.servers")) {
        listings.push(text);
        if (!text.includes("connection_kind IN ('agent', 'local')")) throw new Error("the listing must include leftover local rows");
        return { rows: servers.map((s) => ({ id: s.serverId ?? `uuid-${s.publicId}`, public_id: s.publicId, display_name: s.displayName })) };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, members, listings };
}

const entry = (id: string, displayName = `Name ${id}`, services = "agent"): RuntimeServer<string> => ({
  id,
  displayName,
  services,
  workers: [{ start: vi.fn(), stop: vi.fn(async () => undefined) }],
  kind: "agent",
});
const buildAgent = vi.fn(({ publicId, displayName }: { publicId: string; displayName: string }) => entry(publicId, displayName));

describe("loadDatabaseServers (ADR-0066: every server awaits or runs the mod)", () => {
  it("builds an agent entry for each stored server and replaces whatever the runtime held, stopping its workers", async () => {
    const old = entry("old", "Old", "old");
    const runtime = new ServerRuntime([old]);
    runtime.start();
    const { db } = fakeDb([{ publicId: "friend", displayName: "Friend's factory" }, { publicId: "was-local", displayName: "Converted" }]);
    const result = await loadDatabaseServers({ db, runtime, operatorUserId: "op", buildAgent });
    expect(result.loaded).toEqual(["friend", "was-local"]);
    expect(runtime.list()).toEqual([
      { id: "friend", displayName: "Friend's factory" },
      { id: "was-local", displayName: "Converted" },
    ]);
    expect(runtime.describe("was-local")?.kind).toBe("agent");
    expect(old.workers[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("starts the entries with the runtime, like any other", async () => {
    const runtime = new ServerRuntime<string>();
    const { db } = fakeDb([{ publicId: "friend", displayName: "F" }]);
    await loadDatabaseServers({ db, runtime, operatorUserId: "op", buildAgent });
    runtime.start();
    const started = buildAgent.mock.results.at(-1)!.value as RuntimeServer<string>;
    expect(started.workers[0]!.start).toHaveBeenCalledTimes(1);
  });

  it("an empty database is an empty runtime (nothing comes from the environment, #196)", async () => {
    const runtime = new ServerRuntime([entry("stale")]);
    const { db } = fakeDb([]);
    expect(await loadDatabaseServers({ db, runtime, operatorUserId: "op", buildAgent })).toEqual({ loaded: [], ownershipSeeded: [] });
    expect(runtime.list()).toEqual([]);
  });

  it("makes the operator owner of every server by its internal id (#267); a duplicate is fine, an unknown server fails loudly", async () => {
    const { db, members } = fakeDb([{ publicId: "home", displayName: "Home", serverId: "u1" }]);
    await loadDatabaseServers({ db, runtime: new ServerRuntime<string>(), operatorUserId: "op", buildAgent });
    expect(members[0]).toEqual(["u1", "op", "owner", null, "startup_seed"]);
    const dup = fakeDb([{ publicId: "home", displayName: "Home" }], { code: "23505", constraint: "server_members_one_owner" });
    await expect(loadDatabaseServers({ db: dup.db, runtime: new ServerRuntime<string>(), operatorUserId: "op", buildAgent })).resolves.toMatchObject({ loaded: ["home"] });
    const unknown = fakeDb([{ publicId: "home", displayName: "Home" }], { code: "23503" });
    await expect(loadDatabaseServers({ db: unknown.db, runtime: new ServerRuntime<string>(), operatorUserId: "op", buildAgent })).rejects.toThrow("could not seed an owner");
  });
});

describe("reconcileDatabaseServers (ADR-0054 D3)", () => {
  it("changes nothing when the runtime already matches: an agent keeps its in-memory entry", async () => {
    const kept = entry("home", "Home");
    const runtime = new ServerRuntime([kept]);
    const { db } = fakeDb([{ publicId: "home", displayName: "Home" }]);
    expect(await reconcileDatabaseServers({ db, runtime, buildAgent })).toEqual({ added: [], removed: [], renamed: [] });
    expect(runtime.get("home")).toBe(kept.services);
  });

  it("adds a server created on the other task, removes one deleted there, and renames in place", async () => {
    const runtime = new ServerRuntime([entry("gone"), entry("home", "Old name")]);
    runtime.start();
    const { db } = fakeDb([{ publicId: "home", displayName: "New name" }, { publicId: "new", displayName: "New" }]);
    expect(await reconcileDatabaseServers({ db, runtime, buildAgent })).toEqual({ added: ["new"], removed: ["gone"], renamed: ["home"] });
    expect(runtime.list()).toEqual([
      { id: "home", displayName: "New name" },
      { id: "new", displayName: "New" },
    ]);
  });

  it("removes the last server when the database now stores none", async () => {
    const runtime = new ServerRuntime([entry("home")]);
    const { db } = fakeDb([]);
    expect(await reconcileDatabaseServers({ db, runtime, buildAgent })).toEqual({ added: [], removed: ["home"], renamed: [] });
    expect(runtime.list()).toEqual([]);
  });
});
