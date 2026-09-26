import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

// ADR-0031 PR 5a: a server reached through an agent has no connection row, so it is found by its connection kind.

const entry = (id: string, services: string): RuntimeServer<string> => ({
  id,
  displayName: `Name ${id}`,
  services,
  workers: [{ start: vi.fn(), stop: vi.fn(async () => undefined) }],
});

/** A database with no connection rows and the given agent servers. */
function agentDb(agents: { publicId: string; displayName: string }[]): Queryable {
  return {
    async query(text) {
      if (text.includes("connection_kind = 'agent'")) {
        return { rows: agents.map((a) => ({ public_id: a.publicId, display_name: a.displayName })) };
      }
      return { rows: [] };
    },
  };
}

const build = () => {
  throw new Error("no connection rows exist in these tests");
};
const buildAgent = ({ publicId, displayName }: { publicId: string; displayName: string }): RuntimeServer<string> => ({ ...entry(publicId, "agent"), displayName });

describe("loadDatabaseServers with agent servers", () => {
  it("builds an agent-backed entry for each server reached through an agent, and the database wins over the config", async () => {
    const config = entry("home", "config");
    const runtime = new ServerRuntime([config]);
    runtime.start();
    const result = await loadDatabaseServers({
      db: agentDb([{ publicId: "friend", displayName: "Friend's factory" }]),
      ring: null,
      runtime,
      operatorUserId: "op",
      build,
      buildAgent,
    });
    expect(result.usingDatabase).toBe(true);
    expect(runtime.list()).toEqual([{ id: "friend", displayName: "Friend's factory" }]);
    expect(runtime.get("friend")).toBe("agent");
    expect(config.workers[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("starts the agent entries with the runtime, like any other", async () => {
    const runtime = new ServerRuntime<string>();
    const built: RuntimeServer<string>[] = [];
    await loadDatabaseServers({
      db: agentDb([{ publicId: "friend", displayName: "F" }]),
      ring: null,
      runtime,
      operatorUserId: "op",
      build,
      buildAgent: (server) => {
        const e = buildAgent(server);
        built.push(e);
        return e;
      },
    });
    expect(built[0]!.workers[0]!.start).not.toHaveBeenCalled();
    runtime.start();
    expect(built[0]!.workers[0]!.start).toHaveBeenCalledTimes(1);
  });

  it("does not seed the operator as owner of a server that is not theirs to own (an agent server has its own owner)", async () => {
    const statements: string[] = [];
    const db: Queryable = {
      async query(text, values) {
        statements.push(text);
        return agentDb([{ publicId: "friend", displayName: "F" }]).query(text, values);
      },
    };
    await loadDatabaseServers({ db, ring: null, runtime: new ServerRuntime<string>(), operatorUserId: "op", build, buildAgent });
    expect(statements.some((text) => text.includes("server_members"))).toBe(false);
  });

  it("changes nothing when there are no connections and no agent servers (the config keeps serving)", async () => {
    const runtime = new ServerRuntime([entry("home", "config")]);
    const result = await loadDatabaseServers({ db: agentDb([]), ring: null, runtime, operatorUserId: "op", build, buildAgent });
    expect(result.usingDatabase).toBe(false);
    expect(runtime.list()).toEqual([{ id: "home", displayName: "Name home" }]);
  });

  it("never looks for agent servers when the caller does not build them", async () => {
    const statements: string[] = [];
    const db: Queryable = {
      async query(text) {
        statements.push(text);
        return { rows: [] };
      },
    };
    await loadDatabaseServers({ db, ring: null, runtime: new ServerRuntime<string>(), operatorUserId: "op", build });
    expect(statements.some((text) => text.includes("connection_kind = 'agent'"))).toBe(false);
  });
});
