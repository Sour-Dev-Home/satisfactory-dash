import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { saveConnection } from "./repositories/connectionRepository.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

// Most tests use a LAN address for the stored row, so they run with LAN allowed; the amendment-1 default
// (loopback only, no policy passed) is tested at the end.
const LAN_OK = { allowLan: true };
const key = randomBytes(32);
const ring = createSecretsKeyring("k1", new Map([["k1", key]]));
const input = { host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678" };

/** Rows as the LIST statement would return them, sealed for real; INSERT INTO server_members answers per `memberOutcome`. */
async function fakeDb(servers: { uuid: string; publicId: string; sealedWith?: typeof ring; pinnedIp?: string }[], memberError?: { code: string; constraint?: string }) {
  const rows: unknown[] = [];
  for (const server of servers) {
    let written: unknown[] = [];
    await saveConnection({ query: async (_t, v = []) => { written = v; return { rows: [{}] }; } }, server.sealedWith ?? ring, server.uuid, { ...input, pinnedIp: server.pinnedIp ?? input.pinnedIp });
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
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", policy: LAN_OK, build });
    expect(result).toEqual({ usingDatabase: false, loaded: [], unreadable: [], refused: [] });
    expect(runtime.list()).toEqual([{ id: "home", displayName: "From config" }]);
    expect(members).toEqual([]);
  });

  it("the database wins: config servers are removed (pollers stopped), database servers are added and started", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }, { uuid: "u2", publicId: "alt" }]);
    const fromConfig = configEntry("home");
    const configOnly = configEntry("config-only");
    const runtime = new ServerRuntime([fromConfig, configOnly]);
    runtime.start();
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", policy: LAN_OK, build });
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
    await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", policy: LAN_OK, build: (c) => { const s = build(c); started.push(s); return s; } });
    expect(started[0]!.workers[0]!.start).not.toHaveBeenCalled();
    runtime.start();
    expect(started[0]!.workers[0]!.start).toHaveBeenCalledTimes(1);
  });

  it("makes the operator owner of every database server (idempotent: the outcome of a duplicate is fine)", async () => {
    const { db, members } = await fakeDb([{ uuid: "u1", publicId: "home" }]);
    await loadDatabaseServers({ db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", policy: LAN_OK, build });
    expect(members[0]).toEqual(["u1", "op", "owner", null]);
    const dup = await fakeDb([{ uuid: "u1", publicId: "home" }], { code: "23505", constraint: "server_members_one_owner" });
    await expect(loadDatabaseServers({ db: dup.db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", policy: LAN_OK, build })).resolves.toMatchObject({ usingDatabase: true });
  });

  it("fails loudly when an owner cannot be seeded (unknown server or user)", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }], { code: "23503" });
    await expect(loadDatabaseServers({ db, ring, runtime: new ServerRuntime<string>(), operatorUserId: "op", policy: LAN_OK, build })).rejects.toThrow("could not seed an owner");
  });

  it("reports unreadable rows by public id and key id, and still serves the readable ones", async () => {
    const otherRing = createSecretsKeyring("old", new Map([["old", randomBytes(32)]]));
    const { db } = await fakeDb([{ uuid: "u1", publicId: "good" }, { uuid: "u2", publicId: "stranded", sealedWith: otherRing }]);
    const runtime = new ServerRuntime<string>();
    const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", policy: LAN_OK, build });
    expect(result.loaded).toEqual(["good"]);
    expect(result.unreadable).toEqual([{ serverId: "u2", publicId: "stranded", keyId: "old" }]);
    expect(runtime.has("stranded")).toBe(false);
    expect(JSON.stringify(result)).not.toContain(input.apiToken);
  });

  it.each(["8.8.8.8", "169.254.169.254", "fe80::1", "100.64.0.1", "::ffff:8.8.8.8"])(
    "never serves a stored address that is not loopback or private (%s): refused by public id, not built, no fallback to config",
    async (pinnedIp) => {
      const { db, members } = await fakeDb([{ uuid: "u1", publicId: "good" }, { uuid: "u2", publicId: "tampered", pinnedIp }]);
      const built: string[] = [];
      const runtime = new ServerRuntime([configEntry("tampered")]);
      const result = await loadDatabaseServers({ db, ring, runtime, operatorUserId: "op", policy: LAN_OK, build: (c) => { built.push(c.publicId); return build(c); } });
      expect(result.loaded).toEqual(["good"]);
      expect(result.refused).toEqual([{ serverId: "u2", publicId: "tampered" }]);
      expect(built).toEqual(["good"]);
      expect(runtime.has("tampered")).toBe(false);
      expect(members).toHaveLength(2); // the operator is still made owner of both
      expect(JSON.stringify(result)).not.toContain(pinnedIp);
    },
  );

  it("with no keyring and rows present, the database still wins and every row is unreadable", async () => {
    const { db } = await fakeDb([{ uuid: "u1", publicId: "home" }]);
    const runtime = new ServerRuntime([configEntry("home")]);
    const result = await loadDatabaseServers({ db, ring: null, runtime, operatorUserId: "op", policy: LAN_OK, build });
    expect(result).toMatchObject({ usingDatabase: true, loaded: [] });
    expect(result.unreadable).toHaveLength(1);
    expect(runtime.size).toBe(0);
  });

  // ADR-0030 amendment 1: with the production default (no policy), a stored LAN row is refused at start.
  it.each(["192.168.1.20", "10.0.0.5", "172.16.4.4", "::ffff:10.0.0.5"])(
    "by default a stored LAN row (%s) is refused at start: no server is built, so it gets no pollers; loopback rows are served",
    async (pinnedIp) => {
      const { db } = await fakeDb([{ uuid: "u1", publicId: "local" , pinnedIp: "127.0.0.1" }, { uuid: "u2", publicId: "lan", pinnedIp }]);
      const built: string[] = [];
      const lanWorkers = { start: vi.fn(), stop: vi.fn(async () => undefined) };
      const runtime = new ServerRuntime<string>();
      runtime.start();
      const result = await loadDatabaseServers({
        db, ring, runtime, operatorUserId: "op",
        build: (c) => {
          built.push(c.publicId);
          return { ...build(c), workers: c.publicId === "lan" ? [lanWorkers] : [] };
        },
      });
      expect(result.loaded).toEqual(["local"]);
      expect(result.refused).toEqual([{ serverId: "u2", publicId: "lan" }]);
      expect(built).toEqual(["local"]);
      expect(runtime.has("lan")).toBe(false);
      expect(lanWorkers.start).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(pinnedIp);
    },
  );
});
