import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { saveConnection } from "./repositories/connectionRepository.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

const key = randomBytes(32);
const ring = createSecretsKeyring("k1", new Map([["k1", key]]));
const input = { host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678" };

/** Rows as the LIST statement would return them, sealed for real; INSERT INTO server_members answers per `memberOutcome`. */
async function fakeDb(servers: { uuid: string; publicId: string; sealedWith?: typeof ring }[], memberError?: { code: string; constraint?: string }) {
  const rows: unknown[] = [];
  for (const server of servers) {
    let written: unknown[] = [];
    await saveConnection({ query: async (_t, v = []) => { written = v; return { rows: [{}] }; } }, server.sealedWith ?? ring, server.uuid, input);
    const [, host, pinned, apiPort, frmPort, apiEnc, frmEnc, keyId] = written;
    rows.push({
      server_id: server.uuid, public_id: server.publicId, display_name: `Name ${server.publicId}`, connection_kind: "local",
      host, pinned_ip: pinned, api_port: apiPort, frm_port: frmPort, api_token_enc: apiEnc, frm_token_enc: frmEnc, key_id: keyId,
    });
  }
  const members: unknown[][] = [];
  const db: Queryable = {
    async query(text, values = []) {
      if (text.includes("server_members")) {
        members.push(values);
        if (memberError) throw Object.assign(new Error("db"), memberError);
        return { rows: [] };
      }
      return { rows };
    },
  };
  return { db, members };
}

const build = (connection: { publicId: string; displayName: string; apiToken: string }): RuntimeServer<string> => ({
  id: connection.publicId,
  displayName: connection.displayName,
  services: connection.apiToken,
  workers: [{ start: vi.fn(), stop: vi.fn(async () => undefined) }],
});

const configEntry = (id: string): RuntimeServer<string> => ({
  id,
  displayName: "From config",
  services: "config",
  workers: [{ start: vi.fn(), stop: vi.fn(async () => undefined) }],
});

describe("loadDatabaseServers", () => {
  it("changes nothing when the database has no connections (the config keeps serving)", async () => {
    const { db, members } = await fakeDb([]);
    const runtime = new ServerRuntime([configEntry("home")]);
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", build });
    expect(result).toEqual({ usingDatabase: false, loaded: [], unreadable: [] });
    expect(runtime.list()).toEqual([{ id: "home", displayName: "From config" }]);
    expect(members).toEqual([]);
  });

  it("the database wins: config servers are removed (pollers stopped), database servers are added and started", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }, { uuid: "u2", publicId: "alt" }]);
    const fromConfig = configEntry("home");
    const configOnly = configEntry("config-only");
    const runtime = new ServerRuntime([fromConfig, configOnly]);
    runtime.start();
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", build });
    expect(result).toMatchObject({ usingDatabase: true, loaded: ["home", "alt"], unreadable: [] });
    expect(fromConfig.workers[0]!.stop).toHaveBeenCalledTimes(1);
    expect(configOnly.workers[0]!.stop).toHaveBeenCalledTimes(1);
    expect(runtime.list().map((s) => s.id).sort()).toEqual(["alt", "home"]);
    expect(runtime.get("home")).toBe(input.apiToken);
    expect(runtime.list().find((s) => s.id === "home")?.displayName).toBe("Name home");
  });

  it("does not start database servers when the runtime is not running yet", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }]);
    const started: RuntimeServer<string>[] = [];
    const runtime = new ServerRuntime<string>();
    await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", build: (c) => { const s = build(c); started.push(s); return s; } });
    expect(started[0]!.workers[0]!.start).not.toHaveBeenCalled();
    runtime.start();
    expect(started[0]!.workers[0]!.start).toHaveBeenCalledTimes(1);
  });

  it("makes the operator owner of every database server (idempotent: the outcome of a duplicate is fine)", async () => {
    const { db, members } = await fakeDb([{ uuid: "u1", publicId: "home" }]);
    await loadDatabaseServers({ db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", build });
    expect(members[0]).toEqual(["u1", "op", "owner", null]);
    const dup = await fakeDb([{ uuid: "u1", publicId: "home" }], { code: "23505", constraint: "server_members_one_owner" });
    await expect(loadDatabaseServers({ db: dup.db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", build })).resolves.toMatchObject({ usingDatabase: true });
  });

  it("fails loudly when an owner cannot be seeded (unknown server or user)", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }], { code: "23503" });
    await expect(loadDatabaseServers({ db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", build })).rejects.toThrow("could not seed an owner");
  });

  it("reports unreadable rows by public id and key id, and still serves the readable ones", async () => {
    const otherRing = createSecretsKeyring("old", new Map([["old", randomBytes(32)]]));
    const { db } = await fakeDb([{ uuid: "u1", publicId: "good" }, { uuid: "u2", publicId: "stranded", sealedWith: otherRing }]);
    const runtime = new ServerRuntime<string>();
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", build });
    expect(result.loaded).toEqual(["good"]);
    expect(result.unreadable).toEqual([{ serverId: "u2", publicId: "stranded", keyId: "old" }]);
    expect(runtime.has("stranded")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(input.apiToken);
  });

  it("with no keyring and rows present, the database still wins and every row is unreadable", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }]);
    const runtime = new ServerRuntime([configEntry("home")]);
    const result = await loadDatabaseServers({ db, ring: null, runtime, operatorUserId: "op", build });
    expect(result).toMatchObject({ usingDatabase: true, loaded: [] });
    expect(result.unreadable).toHaveLength(1);
    expect(runtime.size).toBe(0);
  });
});
