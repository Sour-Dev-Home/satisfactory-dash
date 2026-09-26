import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { resolveAllowedAddress } from "./addressGuard.js";
import { ImportError, MAX_LOCAL_SERVERS, importServers } from "./importServers.js";
import type { ImportableServer } from "./importServers.js";

const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
// Most tests use a LAN address, so they run with LAN allowed; the amendment-1 default (loopback only) is tested below.
const LAN_OK = { allowLan: true };

/** An in-memory stand-in for the three statements the import runs, with transaction bookkeeping. */
function fakePool(existingConnections: string[] = []) {
  const connections = new Map<string, unknown[]>(existingConnections.map((id) => [id, []]));
  const serverIds = new Map<string, string>();
  const state = { began: 0, committed: 0, rolledBack: 0, texts: [] as string[] };
  const client = {
    on: () => client,
    removeListener: () => client,
    release: () => undefined,
    async query(text: string, values: unknown[] = []) {
      state.texts.push(text);
      if (text.startsWith("BEGIN")) state.began++;
      if (text.startsWith("COMMIT")) state.committed++;
      if (text.startsWith("ROLLBACK")) state.rolledBack++;
      if (text.includes("INSERT INTO servers.servers ")) {
        const publicId = String(values[0]);
        if (!serverIds.has(publicId)) serverIds.set(publicId, `uuid-${publicId}`);
        return {
          rows: [{ id: serverIds.get(publicId), public_id: publicId, display_name: values[1], hosting_mode: "self", connection_kind: "local" }],
        };
      }
      if (text.includes("INSERT INTO servers.server_connections")) {
        const serverId = String(values[0]);
        if (connections.has(serverId)) return { rows: [] };
        connections.set(serverId, values);
        return { rows: [{ server_id: serverId }] };
      }
      if (text.includes("SELECT 1 FROM servers.server_connections")) {
        return { rows: connections.has(String(values[0])) ? [{ "?column?": 1 }] : [] };
      }
      if (text.includes("count(*)")) return { rows: [{ count: connections.size }] };
      return { rows: [] };
    },
  };
  const pool = { connect: async () => client } as unknown as Parameters<typeof importServers>[0];
  return { pool, connections, state };
}

const configured = (id: string, over: Partial<ImportableServer["config"]> = {}): ImportableServer => ({
  id,
  displayName: `Name ${id}`,
  config: {
    host: "192.168.1.20",
    apiPort: 7777,
    apiToken: `api-token-for-${id}-12345`,
    apiAllowSelfSignedCert: true,
    frmPort: 8080,
    frmToken: "frm-token-12345678",
    requestTimeoutMs: 5000,
    ...over,
  },
});

const resolve = async (host: string) => (host === "localhost" ? "127.0.0.1" : host);

describe("importServers", () => {
  it("imports servers, encrypted, in one committed transaction", async () => {
    const { pool, connections, state } = fakePool();
    const result = await importServers(pool, ring, [configured("a"), configured("b", { host: "localhost", frmToken: undefined })], resolve, LAN_OK);
    expect(result).toEqual({ imported: ["a", "b"], skipped: [], warnings: [] });
    expect(state).toMatchObject({ began: 1, committed: 1, rolledBack: 0 });
    const [, host, pinnedIp, apiPort, frmPort, apiEnc, frmEnc, keyId] = connections.get("uuid-b")!;
    expect([host, pinnedIp, apiPort, frmPort, keyId]).toEqual(["localhost", "127.0.0.1", 7777, 8080, "k1"]);
    expect(frmEnc).toBeNull();
    expect((apiEnc as Buffer).includes(Buffer.from("api-token-for-b"))).toBe(false);
  });

  it("takes the server-management advisory lock first (the create route takes the same one)", async () => {
    const { pool, state } = fakePool();
    await importServers(pool, ring, [configured("a")], resolve, LAN_OK);
    const lockIndex = state.texts.findIndex((text) => text.includes("pg_advisory_xact_lock"));
    const firstInsert = state.texts.findIndex((text) => text.includes("INSERT INTO servers.servers"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(firstInsert);
  });

  it("is idempotent: a server that already has a connection is skipped, not overwritten", async () => {
    const { pool, connections } = fakePool();
    await importServers(pool, ring, [configured("a")], resolve, LAN_OK);
    const before = connections.get("uuid-a");
    const again = await importServers(pool, ring, [configured("a", { apiPort: 9999 })], resolve, LAN_OK);
    expect(again).toEqual({ imported: [], skipped: ["a"], warnings: [] });
    expect(connections.get("uuid-a")).toBe(before);
  });

  it("treats a blank FRM token as no token", async () => {
    const { pool, connections } = fakePool();
    await importServers(pool, ring, [configured("a", { frmToken: "" })], resolve, LAN_OK);
    expect(connections.get("uuid-a")![6]).toBeNull();
  });

  it("refuses a server with no API token, and rolls back what it had done", async () => {
    const { pool, connections, state } = fakePool();
    await expect(importServers(pool, ring, [configured("a"), configured("b", { apiToken: " " })], resolve, LAN_OK)).rejects.toThrow(ImportError);
    expect(state.rolledBack).toBe(1);
    expect(state.committed).toBe(0);
    expect(connections.size).toBe(1); // the fake keeps a's row: the real rollback removes it (see the DB test)
  });

  it("refuses a server that verifies its TLS certificate, because that setting is not stored", async () => {
    const { pool } = fakePool();
    await expect(importServers(pool, ring, [configured("a", { apiAllowSelfSignedCert: false })], resolve, LAN_OK)).rejects.toThrow(/TLS certificate/);
  });

  it("warns (by id only) about a custom request timeout, which is not stored", async () => {
    const { pool } = fakePool();
    const result = await importServers(pool, ring, [configured("a", { requestTimeoutMs: 9000 })], resolve, LAN_OK);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"a"');
    expect(result.warnings[0]).not.toContain("9000");
  });

  it("refuses a host that cannot be resolved to a pinned address", async () => {
    const { pool } = fakePool();
    await expect(importServers(pool, ring, [configured("a")], async () => Promise.reject(new Error("ENOTFOUND")))).rejects.toThrow(/could not be resolved/);
  });

  // ADR-0030 amendment 1: only loopback can be imported until certificate pinning exists (the production default).
  it.each(["192.168.1.20", "10.0.0.5", "::ffff:10.0.0.5"])(
    "refuses a LAN config host (%s) with the pinning message, rolling back, and stores nothing",
    async (host) => {
      const { pool, state } = fakePool();
      const err = await importServers(pool, ring, [configured("home"), configured("lan", { host })], async (h) => h).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImportError);
      expect((err as Error).message).toMatch(/certificate pinning/);
      expect((err as Error).message).not.toContain(host);
      expect(state.committed).toBe(0);
      expect(state.rolledBack).toBe(1);
    },
  );

  it("also refuses when the resolver itself throws the LAN refusal (the real one does), and when it returns a LAN address", async () => {
    const { pool } = fakePool();
    const lanResolver = () => resolveAllowedAddress("192.168.1.20");
    await expect(importServers(pool, ring, [configured("a")], lanResolver)).rejects.toThrow(/certificate pinning/);
    await expect(importServers(pool, ring, [configured("a")], async () => "10.1.2.3")).rejects.toThrow(/certificate pinning/);
    await expect(importServers(pool, ring, [configured("a")], async () => "8.8.8.8")).rejects.toThrow(/loopback or private/);
  });

  it("still imports loopback servers by default (127.0.0.1, ::1, and localhost resolved to loopback)", async () => {
    const { pool } = fakePool();
    const result = await importServers(
      pool,
      ring,
      [configured("a", { host: "127.0.0.1" }), configured("b", { host: "::1" }), configured("c", { host: "localhost" })],
      (host) => resolveAllowedAddress(host, async () => ["::1", "127.0.0.1"]),
    );
    expect(result.imported).toEqual(["a", "b", "c"]);
  });

  it("refuses more than the cap of local servers, rolling back", async () => {
    const { pool, state } = fakePool();
    const many = Array.from({ length: MAX_LOCAL_SERVERS + 1 }, (_, i) => configured(`s${i}`));
    await expect(importServers(pool, ring, many, resolve, LAN_OK)).rejects.toThrow(/limit of 8/);
    expect(state.committed).toBe(0);
  });

  it("no error or result ever carries a token", async () => {
    const { pool } = fakePool();
    const bad = configured("a", { apiAllowSelfSignedCert: false });
    let message = "";
    try {
      await importServers(pool, ring, [bad], resolve, LAN_OK);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain(bad.config.apiToken!);
    expect(message).not.toContain(bad.config.frmToken!);
  });
});
